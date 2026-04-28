# SAM3 Auto Labeling Tool - 백엔드 코드 리뷰 보고서

- 리뷰 일자: 2026-04-28
- 리뷰어: QA 에이전트 (Claude Sonnet 4.6)
- 대상 경로: `web_app/backend/`
- 검토 파일 수: 16개
- 발견 이슈: 21건 (Critical 5 / Major 9 / Minor 7)

---

## 1. 버그 / 잠재적 오류

### [Critical] `state.py`에 존재하지 않는 클래스·변수를 참조하는 구버전 라우터 3개

- **파일**: `routers/correct.py:6`, `routers/images.py:37,43,44`, `routers/label.py:86–111`
- **문제**: `correct.py`는 `from state import CorrectionState`를 호출하고, `images.py`와 `label.py`는 `state.ImageState`, `state.images`, `state.image_order`, `state.batch_job`를 참조한다. 이 식별자들은 현재 `state.py`에 정의되어 있지 않다. 현재 `state.py`는 `FrameState` / `ClickState` 기반 구조만 정의한다.
- **영향**: 세 라우터(`correct`, `images`, `label`)가 `main.py`에 등록되어 있지 않아 런타임에서 즉시 크래시는 발생하지 않는다. 그러나 향후 이 라우터를 등록하거나 다른 코드에서 임포트하는 순간 `ImportError` / `AttributeError`가 발생한다. 또한 `label.py`의 `DINOService`도 `services/` 디렉터리에 존재하지 않아(`dino_service.py` 없음) 임포트 자체가 실패한다.
- **근거**: 두 개의 완전히 다른 상태 모델(`state.frames` 기반 vs `state.images` 기반)이 코드베이스에 혼재하고 있다. 이는 리팩터링 도중 구버전 코드가 정리되지 않은 상태로 남겨진 것으로 판단된다.

---

### [Critical] `YoloService.infer()`의 Lock 범위 오류 — Race Condition

- **파일**: `services/yolo_service.py:206–211`
- **문제**: `_infer_lock`은 모델 교체 여부 판단 및 교체(`YOLO()` 로드)까지만 보호하고, 실제 예측 호출(`self._infer_model.predict(...)`)은 lock 밖에서 실행된다.

  ```python
  with self._infer_lock:          # 모델 교체만 보호
      if self._infer_model_path != model_path:
          self._infer_model = YOLO(model_path)
          self._infer_model_path = model_path
  results = self._infer_model.predict(...)  # lock 밖 — 위험
  ```

- **영향**: `guide/infer-all` 배치 추론(스레드 A)이 진행되는 도중 다른 요청(스레드 B)이 다른 모델로 교체하면, 스레드 A의 `predict()` 호출이 스레드 B가 로드한 모델로 실행된다. 잘못된 세그멘테이션 결과가 저장된다.
- **근거**: 단일 책임 원칙상 lock은 공유 리소스(`self._infer_model`) 접근 전체를 보호해야 한다.

---

### [Critical] `SAM3Service.set_image()`의 TOCTOU Race Condition

- **파일**: `services/sam3_service.py:37–41`
- **문제**: `_current_image_key` 비교가 lock 밖에서 이루어진다.

  ```python
  def set_image(self, image_key: str, image_rgb: np.ndarray) -> None:
      if self._current_image_key == image_key:   # lock 밖 — 비교 직후 다른 스레드가 키를 바꿀 수 있음
          return
      with self._infer_lock:
          self._predictor.set_image(image_rgb)
          self._current_image_key = image_key
  ```

- **영향**: 스레드 A(key=img1)와 스레드 B(key=img2)가 거의 동시에 진입할 경우, 두 `set_image` 호출이 모두 실행된다. 이후 스레드 A의 `predict()`가 img2로 세팅된 상태에서 동작해 잘못된 마스크를 반환한다.

---

### [Critical] `routers/images.py:35` — `cv2.imread` 실패 시 None으로 `cvtColor` 호출

- **파일**: `routers/images.py:35`
- **문제**: 파일 업로드 직후 `cv2.imread(str(dest))`의 반환값을 None 체크 없이 `cv2.cvtColor`에 전달한다.

  ```python
  image_rgb = cv2.cvtColor(cv2.imread(str(dest)), cv2.COLOR_BGR2RGB)
  ```

- **영향**: 업로드된 파일이 손상되거나 지원하지 않는 포맷이면 `cv2.imread`가 `None`을 반환하고, `cvtColor`가 `cv2.error: (-215) !_src.empty()`를 발생시켜 500 에러가 반환된다. 파일은 디스크에 저장됐으나 상태에 등록되지 않아 고아 파일이 된다.

---

### [Critical] `routers/label.py:192` — `image_rgb`가 None인 상태에서 `.shape` 접근

- **파일**: `routers/label.py:192`
- **문제**: `get_label()` 함수에서 `img.image_rgb.shape[:2]`에 None 가드가 없다. `status == "labeled"`인 이미지라도 메모리에서 gc되거나 서버 재시작 후 `image_rgb`가 `None`일 수 있다.

  ```python
  h, w = img.image_rgb.shape[:2]   # None이면 AttributeError
  ```

- **참고**: 이 파일 자체가 구버전(`state.images` 기반)이므로 현재는 도달 불가능하지만, 활성화 시 즉시 버그가 된다.

---

### [Major] `routers/label.py:150–159` — Detection 삭제 후 Correction 재인덱싱 로직 버그

- **파일**: `routers/label.py:148–159`
- **문제**: `img.corrections.pop(det_idx, None)`으로 해당 인덱스의 correction을 먼저 제거한 뒤, 동일한 `img.corrections`를 순회하면서 재인덱싱을 수행한다. `pop` 이후 `for k, v in img.corrections.items():`를 돌므로 이미 삭제된 키는 재인덱싱 대상에서 빠진다. 로직 자체는 결과적으로 올바르나, `pop`과 루프 사이의 의도가 불분명해 향후 수정 시 오류를 유발하기 쉽다. 더 중요한 문제는 `img.seg_results` 및 `img.detections`는 리스트(`list.pop`)인데 `img.corrections`는 dict로 인덱싱되어 있어, 동시 수정 중인 corrections의 키가 seg_results 인덱스와 불일치할 수 있다.

---

### [Major] `guide.py:107–118` — `try-finally`에서 `del img_rgb` 후 `detections` 변수 접근

- **파일**: `routers/guide.py:107–118`
- **문제**: 예외 발생 시 흐름이 `except Exception: continue` → `finally: del img_rgb`이므로 `detections` 미정의 상태에서 `for det in detections` 라인은 실행되지 않아 실제 NameError는 발생하지 않는다. 그러나 `finally`가 정상 흐름과 예외 흐름 양쪽에서 `del img_rgb`를 실행하기 때문에, 정상 경로에서도 `img_rgb`가 삭제된다. 이후 코드에서 `img_rgb`를 사용하지 않으므로 현재는 문제없으나, 코드를 확장할 때 매우 혼란스러운 구조다. `continue`가 `finally` 이후로 전달되는 동작 방식을 이해하지 못한 코드 패턴이다.

---

### [Major] `services/yolo_service.py:255–259` — `squeue` 실행 시 예외 처리 누락

- **파일**: `services/yolo_service.py:255–259`
- **문제**: `_refresh_slurm_status()`에서 `subprocess.run(["squeue", ...])` 호출에 `try/except`가 없다. SLURM이 설치되지 않은 환경이나 PATH에 `squeue`가 없으면 `FileNotFoundError`가 발생한다. 이 함수는 `get_status()` API 요청 및 백그라운드 poll 스레드에서 주기적으로 호출되므로, 서버가 반복적으로 500 에러를 반환하거나 poll 스레드가 죽는다.

---

### [Major] `services/yolo_service.py:125–128` — `sbatch` 실패 시 `CalledProcessError` 미처리

- **파일**: `services/yolo_service.py:125–128`
- **문제**: `subprocess.run(["sbatch", ...], check=True)`는 sbatch 실패 시 `subprocess.CalledProcessError`를 발생시킨다. 이 예외는 `submit_training()` 호출자인 `routers/train.py:start_training()`에서 `RuntimeError`만 catch하므로 처리되지 않고 500 Internal Server Error로 변환된다. sbatch 실패 원인(권한, 파티션 없음 등)이 클라이언트에 노출되지 않는다.

---

### [Major] `routers/project.py:95` — `folder_name`에 대한 경로 조작 미검증

- **파일**: `routers/project.py:95`
- **문제**: `upload_images()` 엔드포인트에서 사용자가 제공한 `folder_name`을 `_safe_path()` 검증 없이 직접 `UPLOAD_DIR / folder_name`으로 결합한다.

  ```python
  target = UPLOAD_DIR / folder_name   # folder_name = "../../etc" 가능
  target.mkdir(parents=True, exist_ok=True)
  ```

  `Path("/home1/sota/uploads") / "../etc"`는 `/home1/sota/etc`로 해석된다. 같은 라우터의 `list_folders`, `list_images`, `serve_image`, `select_project`는 `_safe_path()`를 사용하나 `upload_images`만 누락되어 있다.

---

### [Major] `routers/export.py:44–47` — 라벨 저장 경로에 대한 경로 조작 미검증

- **파일**: `routers/export.py:44–47`
- **문제**: `body.image_path`를 `_safe_path()` 검증 없이 직접 `Path(body.image_path)`로 변환하여 레이블 파일 경로를 결정한다. 클라이언트가 `image_path`에 임의의 절대경로를 전달하면 시스템 어디에든 `.txt` 파일을 쓸 수 있다.

---

### [Major] `routers/sam_label.py` 전체 — 경로 조작 미검증

- **파일**: `routers/sam_label.py:20`, `63`, `105`
- **문제**: `image_path`를 Request body에서 직접 받아 `cv2.imread(image_path)` 및 `SAM3Service.set_image(image_path, ...)` 로 전달한다. `_safe_path()` 검증이 없으므로 서버 파일시스템의 임의 경로에 있는 이미지를 읽어 메모리에 올릴 수 있다. 이는 정보 누출 및 의도치 않은 리소스 사용으로 이어진다.

---

### [Major] `routers/guide.py` — `image_path`, `folder`, `model_path` 미검증

- **파일**: `routers/guide.py:171`, `185`, `217`
- **문제**: `guide_infer()`, `guide_infer_all()`, `guide_accept()`에서 `req.image_path`, `req.folder`, `req.model_path`를 `_safe_path()` 없이 직접 사용한다. 임의 경로의 YOLO 모델 파일 로드 및 임의 폴더의 이미지 일괄 처리가 가능하다.

---

## 2. 코드 품질

### [Minor] `export.py`의 `_build_yolo_lines`와 `export_service.py`의 `build_yolo_lines` 이중 정의

- **파일**: `routers/export.py:15`, `services/export_service.py:21`
- **문제**: 두 함수 모두 mask → YOLO polygon 라인 변환을 수행하지만 입력 데이터 구조가 다르다. `export.py`는 `FrameState`/`ClickState` 기반, `export_service.py`는 `seg_results`/`corrections` dict 기반이다. 이는 두 상태 모델의 분열을 반영하며 장기적으로 유지 불가능하다. 상태 모델을 하나로 통일한 후 서비스 계층의 함수를 단일화해야 한다.

---

### [Minor] `main.py:31` — 폐지된 `@app.on_event("startup")` 사용

- **파일**: `main.py:31`
- **문제**: FastAPI 0.93+ 에서 `@app.on_event("startup")`은 deprecated이고 `lifespan` 컨텍스트 매니저로 교체가 권장된다. 현재는 동작하지만 향후 버전 업그레이드 시 경고 또는 제거될 수 있다.

---

### [Minor] `routers/images.py:13` — `UPLOAD_DIR`이 상대경로

- **파일**: `routers/images.py:13`
- **문제**: `UPLOAD_DIR = Path("uploads")`는 FastAPI 서버의 실행 디렉터리에 따라 달라진다. `uvicorn`을 어느 디렉터리에서 실행하느냐에 따라 업로드 경로가 달라진다. `project.py`는 환경변수로 절대경로를 지정하는 반면 `images.py`는 하드코딩된 상대경로를 사용해 일관성이 없다.

---

### [Minor] `routers/export.py:50` — 함수 내부에서 `import time`

- **파일**: `routers/export.py:50`
- **문제**: `save_label()` 함수 내부에서 `import time`을 수행한다. Python은 모듈 캐싱으로 인해 성능에 큰 영향은 없으나, 표준적이지 않은 패턴으로 가독성을 저해한다. 파일 상단에 위치해야 한다.

---

### [Minor] `scripts/train_yolo.py:45` — GPU device 하드코딩

- **파일**: `scripts/train_yolo.py:45`
- **문제**: `device=0`으로 GPU 인덱스가 하드코딩되어 있다. 멀티GPU 환경 또는 CPU 전용 환경에서 유연성이 없다. `--device` 인수로 외부화하거나 `"cuda:0" if torch.cuda.is_available() else "cpu"`로 처리해야 한다.

---

### [Minor] `routers/train.py:11–15` — `TrainRequest` 입력 검증 누락

- **파일**: `routers/train.py:11–15`
- **문제**: `epochs`, `imgsz`, `batch`에 범위 제한이 없다. `epochs=0`, `batch=-1`, `imgsz=99999` 등의 비정상 값이 그대로 sbatch로 전달된다. Pydantic의 `Field(ge=1, le=1000)` 등으로 제한해야 한다.

---

### [Minor] `scripts/prepare_dataset.py:71` — 시퀀스 간 이미지 파일명 충돌 시 심볼릭 링크 묵살

- **파일**: `scripts/prepare_dataset.py:37–40`, `71`
- **문제**: `_link()` 함수는 `dst.exists()` 또는 `dst.is_symlink()`이면 아무 작업도 하지 않고 반환한다. 서로 다른 시퀀스에 동일한 파일명(`000001.jpg` 등)이 존재할 경우, 먼저 처리된 시퀀스의 파일이 남고 나중 시퀀스의 파일이 무시된다. 경고 출력도 없다.

---

## 3. 성능

### [Major] `services/yolo_service.py:211` — 추론 호출이 Lock 외부에서 실행되어 직렬화 실패

- 이미 Critical 섹션의 Race Condition 항목에서 기술. 성능 측면에서도 lock 범위가 최소화되지 않아 모델 로드만 직렬화되고 추론은 병렬 실행을 시도하나 PyTorch 내부에서 예측 불가능하게 직렬화될 수 있다.

---

### [Minor] `routers/project.py:59–64` — `list_images()`에서 이미지 수만큼 파일시스템 I/O 반복

- **파일**: `routers/project.py:59–72`
- **문제**: `_is_saved()` 함수가 이미지마다 `Path(...).exists()`를 호출한다. 이미지가 1,000개면 1,000번의 `stat()` 시스템 콜이 발생한다. `os.scandir(label_dir)` 혹은 `set()` 캐싱으로 한 번에 처리할 수 있다.

---

### [Minor] `services/yolo_service.py:280` — 대용량 로그 파일을 전체 로드

- **파일**: `services/yolo_service.py:280`
- **문제**: `_parse_log()`에서 `log_path.read_text()`로 로그 전체를 메모리에 올린다. 장기 학습 시 수백 MB 로그가 발생하면 매 poll 주기(15초)마다 대용량 파일을 읽게 된다. 파일 끝부분 N줄만 읽도록 개선해야 한다.

---

## 4. 아키텍처

### [Critical] 두 개의 상호 비호환 상태 모델 공존

- **관련 파일**: `state.py`, `routers/correct.py`, `routers/images.py`, `routers/label.py` (구버전) vs `routers/sam_label.py`, `routers/export.py`, `routers/guide.py`, `routers/project.py` (현행)
- **문제**: 코드베이스에 두 개의 완전히 다른 이미지 상태 관리 체계가 공존한다.
  - **현행 시스템**: `state.frames: dict[str, FrameState]` — 이미지 절대경로를 키로 사용, SAM3 클릭 기반 라벨링 워크플로우
  - **구버전 시스템**: `state.images: dict[str, ImageState]` — UUID를 키로 사용, DINO+SAM1 기반 라벨링 워크플로우 (현재 `state.py`에 미정의)
  
  `main.py`는 구버전 라우터 3개(`correct`, `images`, `label`)를 등록하지 않아 사실상 dead code이지만, 파일이 존재하고 임포트를 시도하면 즉시 실패한다.

---

### [Major] `SAMService` (`sam_service.py`) — Thread Safety 부재

- **파일**: `services/sam_service.py`
- **문제**: `SAMService`는 `SAM3Service`와 달리 `_lock`이나 `_infer_lock`이 없다. `label.py`의 `_run_batch()`는 백그라운드 스레드에서 `SAMService.get().set_image()` 및 `predict_*()` 를 호출한다. 동시에 단일 이미지 라벨링 요청이 들어오면 `set_image` 경쟁이 발생한다.

---

### [Minor] `routers/guide.py` — 배치 상태를 전역 변수(`_batch_status`)로 관리

- **파일**: `routers/guide.py:32`, `78`
- **문제**: `_batch_status`가 모듈 레벨 전역 변수로 존재한다. FastAPI 다중 워커(Gunicorn + multiple workers) 환경에서는 각 워커가 독립적인 메모리를 가지므로 상태가 공유되지 않는다. 단일 워커에서도 `global _batch_status` 선언이 불필요하다(재할당 없이 필드만 수정하므로). 전체적으로 애플리케이션 상태는 `state.py`에 중앙 집중화해야 한다.

---

## 5. 보안

이미 버그/잠재적 오류 섹션에서 다룬 경로 조작 취약점들을 요약한다.

| 엔드포인트 | 파일 | 미검증 입력 | 위험 |
|---|---|---|---|
| `POST /project/upload` | `project.py:95` | `folder_name` | UPLOAD_DIR 외부 디렉터리 생성 |
| `POST /save` | `export.py:44` | `image_path` | 임의 경로에 `.txt` 파일 쓰기 |
| `POST /sam/click` | `sam_label.py:63` | `image_path` | 임의 파일 읽기 |
| `POST /sam/accept-box` | `sam_label.py:105` | `image_path` | 임의 파일 읽기 |
| `POST /guide/infer` | `guide.py:171` | `image_path`, `model_path` | 임의 파일 읽기 및 모델 로드 |
| `POST /guide/infer-all` | `guide.py:185` | `folder`, `model_path` | 임의 폴더 일괄 처리 |

`project.py`에 구현된 `_safe_path()` 함수를 공통 유틸리티로 분리하여 모든 경로 입력에 적용해야 한다.

---

## 종합 개선 우선순위 Top 5

### 1순위 — 구버전 dead code 정리 또는 상태 모델 통일 (Critical)

`routers/correct.py`, `routers/images.py`, `routers/label.py` 세 파일은 현재 `state.py`와 호환되지 않으며 `main.py`에도 등록되어 있지 않다. 이 파일들이 현행 시스템으로 통합될 계획이 있다면 `state.py`에 `ImageState`, `CorrectionState`, `batch_job`, `images`, `image_order`를 추가하거나, 계획이 없다면 삭제해야 한다. 두 상태 모델의 공존은 모든 다른 문제의 근본 원인이다.

### 2순위 — 경로 조작(Path Traversal) 취약점 전수 차단 (Critical)

`project.py`의 `_safe_path()` 함수를 `utils/path_guard.py` 같은 공통 모듈로 이동하고, `export.py`, `sam_label.py`, `guide.py`, `project.py:upload_images`에서 모든 외부 경로 입력에 적용한다. 허용 디렉터리 목록(`BASE_PROJECT_DIR`, `UPLOAD_DIR`)을 환경변수로 명확히 선언하고 검증을 일관되게 수행해야 한다.

### 3순위 — YoloService와 SAM3Service의 Race Condition 수정 (Critical)

`YoloService.infer()`의 `self._infer_model.predict()` 호출을 `_infer_lock` 내부로 이동한다. `SAM3Service.set_image()`의 키 비교를 lock 내부로 이동한다. `SAMService`(구버전 SAM1)에도 lock을 추가한다. 이 세 가지는 동시 요청 시 잘못된 라벨이 생성되는 데이터 무결성 문제이다.

### 4순위 — `images.py` 업로드의 None 가드 및 고아 파일 처리 (Critical)

`cv2.imread()` 결과를 None 체크 후 `cvtColor`를 호출하도록 수정하고, 실패 시 디스크에 저장된 파일을 정리(unlink)해야 한다. 업로드 엔드포인트는 실패 파일에 대해 명시적인 에러 항목을 응답에 포함해야 한다.

### 5순위 — SLURM 명령어 예외 처리 강화 (Major)

`_refresh_slurm_status()`의 `squeue` 호출과 `submit_training()`의 `sbatch` 호출을 `try/except (FileNotFoundError, subprocess.CalledProcessError)`로 감싼다. SLURM 미설치 환경에서 서버가 기동은 되되 학습 관련 기능은 명확한 에러 메시지와 함께 비활성화되어야 한다. `TrainRequest`에 Pydantic Field 제약(`ge=1` 등)을 추가하여 비정상 파라미터가 SLURM에 전달되지 않도록 막는다.
