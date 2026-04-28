# PLAN: SAM3 MVP 오토 라벨링 웹 툴

## 목표
MVP 범위 정의서 기준, 기존 web_app을 SAM 3 + YOLO Guide 기반으로 전면 재구성한다.

## 한 줄 정의
특정 프로젝트 폴더의 이미지 프레임을 웹에서 열고, SAM 3 클릭 기반 segmentation과 수기 라벨 데이터셋으로 학습한 YOLO guide labeling을 병행 활용하여 결과를 YOLO Segmentation 포맷으로 NAS에 저장하는 내부 데모용 웹 라벨링 도구.

## 현황 분석

### 재사용 가능 (유지)
- FastAPI 백엔드 구조 (routers/, services/)
- React + TypeScript + Vite 프론트엔드 구조
- YOLO Segmentation 1.0 export 로직 (`export_service.py`)
- SAM 클릭 보정 로직 (correct.py → SAM 3 API로 이식)

### 교체/제거 대상
- GroundingDINO 완전 제거 (텍스트 프롬프트 기반 워크플로우)
- SAM v1 → SAM 3 (segment-anything-2) 교체
- 업로드 방식 → 폴더 브라우저 방식으로 전환
- 인메모리 state → 프로젝트 폴더 기반 state로 재설계

### 신규 구현
- 프로젝트 폴더 브라우저 API
- YOLO Segmentation 학습 트리거 API
- YOLO guide labeling API (학습된 모델 추론)
- 클래스 선택 UI (사람/강아지/로봇/휠체어 고정)
- 라벨링 모드 선택 UI (SAM 3 / YOLO guide)

### 핵심 설계 결정 (2026-04-27 확정)
**YOLO → SAM3 연결 방식 채택** (2번 방식):
YOLO guide 결과의 bbox를 SAM3 box prompt로 넘겨 초기 mask를 생성하고,
이후 사용자가 클릭으로 mask를 보정할 수 있다.

흐름:
```
[SAM3 모드] 클릭 → SAM3 → mask → 추가 클릭으로 보정
[YOLO guide 모드] YOLO 추론 → bbox 목록 → 사용자 accept
                  → /api/sam/accept-box (bbox → SAM3 box prompt → 초기 mask)
                  → /api/sam/click (동일 obj_id → 클릭 보정)
```

구현 위치:
- `ClickState.initial_box` — YOLO bbox 저장
- `SAM3Service.predict(box=...)` — box + point 혼합 예측
- `POST /api/sam/accept-box` — YOLO bbox → SAM3 초기 mask 생성

---

## Phase 1: 백엔드 기반 재구성 (SAM 3 + 폴더 브라우저)

### 목표
- SAM 3 통합, GroundingDINO 제거, 폴더 기반 이미지 접근

### 작업 목록
1. **SAM 3 서비스 교체** (`services/sam3_service.py`)
   - `sam2` 패키지 (segment-anything-2) 사용
   - `SAM2ImagePredictor` 기반 싱글턴
   - 클릭 좌표(positive point) → mask 반환 API
   - 이전 logit 누적으로 다중 클릭 지원

2. **GroundingDINO 제거**
   - `services/dino_service.py` 삭제
   - `routers/label.py`에서 DINO 의존성 제거
   - label 라우터를 SAM3 클릭 기반으로 재작성

3. **폴더 브라우저 API** (`routers/project.py`)
   - `GET /api/project/folders?root=/path` — 폴더 목록
   - `GET /api/project/images?folder=/path` — 특정 폴더 이미지 목록
   - `GET /api/project/image?path=/path/img.jpg` — 이미지 서빙 (static)
   - 이미지 상태를 폴더 기반으로 인메모리 관리

4. **State 재설계** (`state.py`)
   - `ProjectSession`: 현재 선택된 폴더 + 이미지 목록
   - `FrameState`: 단일 프레임의 현재 라벨 목록 (클래스별 mask/polygon)
   - 다중 사용자: 이미지 경로 단위 락 (파일 기반 `.lock`)

### 완료 기준
- 지정 폴더에서 이미지 목록 로드 가능
- SAM 3로 클릭 → mask 반환 동작
- GroundingDINO 의존성 코드 제거 완료

---

## Phase 2: 핵심 라벨링 워크플로우 (클래스 선택 + 모드 전환)

### 목표
- 클래스 선택, 라벨링 모드, 이미지 네비게이션 UI 구현

### 작업 목록
1. **SAM 3 클릭 라벨링 API** (`routers/sam_label.py`)
   - `POST /api/sam/click` — `{image_path, x, y, class_name}` → polygon
   - 다중 클릭 누적 (같은 객체에 대해 클릭 추가)
   - `DELETE /api/sam/object/{obj_id}` — 객체 삭제

2. **클래스 선택 컴포넌트** (`frontend/src/components/ClassSelector.tsx`)
   - 고정 클래스 4종: 사람, 강아지, 로봇, 휠체어
   - 선택된 클래스 하이라이트

3. **모드 선택 컴포넌트** (`frontend/src/components/ModeToggle.tsx`)
   - SAM 3 모드 / YOLO guide 모드 토글
   - SAM 3: 캔버스 클릭 → segmentation
   - YOLO guide: 가이드 라벨 로드 버튼

4. **이미지 네비게이션** (`frontend/src/components/ImageNavigator.tsx`)
   - 이전/다음 프레임 이동
   - 현재 이미지 저장 여부 표시 (저장됨 / 미저장)
   - 폴더 내 진행률 표시 (n/total)

5. **캔버스 리팩토링** (`LabelCanvas.tsx`)
   - 클릭 → SAM 3 API 호출 (양클릭 제거, 단순화)
   - 여러 객체 순차 라벨링 (클래스별 색상 구분)
   - 객체별 polygon 오버레이

### 완료 기준
- 클래스 선택 후 캔버스 클릭 → SAM 3 polygon 표시
- 동일 이미지에서 여러 객체 순차 라벨링 가능
- 이전/다음 이미지 이동 가능

---

## Phase 3: YOLO Guide Labeling (학습 + 추론)

### 목표
- 수기 라벨 데이터셋 기반 YOLO Seg 학습 및 가이드 라벨 생성

### 작업 목록
1. **YOLO 학습 서비스** (`services/yolo_service.py`)
   - `ultralytics` 패키지 사용 (`YOLO` 클래스)
   - 학습 데이터 경로(NAS) + 에폭 수 → 학습 실행
   - 학습 job을 백그라운드 스레드로 실행
   - 학습 진행 상태 폴링 API

2. **학습 API** (`routers/train.py`)
   - `POST /api/train/start` — `{dataset_path, epochs, model_name}` → job_id
   - `GET /api/train/status` — 진행 상태 (running/done/failed, epoch, metrics)
   - `GET /api/train/models` — 등록된 모델 목록

3. **YOLO Guide 추론 API** (`routers/guide.py`)
   - `POST /api/guide/infer` — `{image_path, model_path, conf_threshold}` → detections
   - 반환: 클래스별 polygon 목록 (confidence 포함)
   - 사용자가 개별 객체 accept/reject 가능

4. **Guide Label UI** (`frontend/src/components/GuidePanel.tsx`)
   - 모델 선택 드롭다운 + confidence threshold 슬라이더
   - "Guide 실행" 버튼 → 결과 오버레이
   - 객체별 체크박스 (accept/reject)
   - Accept된 것만 최종 라벨에 포함

### 완료 기준
- 수기 라벨 데이터셋 경로 지정 후 학습 실행 가능
- 학습 완료 후 YOLO 모델로 guide label 생성 가능
- Guide label에서 원하는 객체만 선택하여 라벨에 추가 가능

---

## Phase 4: 저장 정책 및 다중 사용자

### 목표
- NAS 경로 저장, 단일 프레임 저장 버튼, 충돌 기초 처리

### 작업 목록
1. **NAS 경로 저장** (`routers/export.py` 리팩토링)
   - `POST /api/save/{image_path_encoded}` — 현재 프레임 라벨을 NAS labels/ 폴더에 저장
   - 저장 경로: `{project_folder}/labels/{stem}.txt` (Ultralytics YOLO 1.0 포맷)
   - 저장 전 기존 파일 존재 시 경고 응답 (`409 Conflict` + `?force=true` 옵션)

2. **다중 사용자 충돌 처리**
   - 동일 파일 동시 저장 시: 선저장 우선 (파일 수정 시각 비교)
   - 경고 메시지 UI 표시 ("다른 사용자가 이미 저장했습니다. 덮어쓰시겠습니까?")

3. **저장 상태 표시** (`frontend/src/components/SaveButton.tsx`)
   - 저장됨 / 미저장 / 저장 중 상태 표시
   - 이미지 이동 시 미저장 경고 모달

### 완료 기준
- 저장 버튼 → NAS labels/ 폴더에 .txt 파일 생성
- 동일 파일 중복 저장 시 경고 처리
- 저장 후 다음 이미지로 이동 가능

---

## Phase 5: 통합 검증 및 MVP 완료 기준 체크

### MVP 완료 기준 (정의서 §7 기준)
- [ ] 웹에서 특정 프로젝트 폴더의 이미지 프레임을 불러올 수 있다
- [ ] 수기 라벨 데이터셋으로 YOLO Segmentation 모델 학습 수행 및 저장 가능
- [ ] SAM 3 또는 YOLO guide labeling으로 segmentation 결과 생성 가능
- [ ] 생성 결과가 화면에서 시각적으로 확인된다
- [ ] 결과를 YOLO Segmentation 1.0 포맷으로 저장하고 지정 경로에 생성
- [ ] 최소 2인 이상 접속 내부 데모 수행 가능

---

## 기술 스택

| 항목 | 선택 | 이유 |
|------|------|------|
| 백엔드 | FastAPI (기존 유지) | 기존 코드 재활용 |
| SAM | segment-anything-2 (SAM 3) | MVP 명시 요구사항 |
| YOLO | ultralytics >= 8.0 | YOLO Seg 학습/추론 |
| 프론트엔드 | React + TypeScript + Vite (기존 유지) | 기존 코드 재활용 |
| 상태 관리 | 인메모리 (파일 락으로 충돌 방지) | MVP 수준 |
| 저장 | NAS 파일시스템 직접 접근 | MVP 요구사항 |

## 제외 범위 (MVP 정의서 §2.2)
- Polygon 수동 수정 (브러시/vertex 편집)
- Bbox 라벨링
- 영상 단위 일괄 처리

---

## Phase 5 이후: 개선 학습 계획 (2026-04-27 확정)

### 배경
- 현재 데이터가 단일 환경(동일 장소/카메라)으로만 구성 → val mAP가 과대 평가될 수 있음
- 범용 성능 확보를 위해 현재 학습(job 20573) 완료 후 개선 학습 진행 예정

### 개선 학습 설정
```json
{
  "epochs": 50,
  "imgsz": 1280,
  "batch": 16,
  "model": "yolov8s-seg.pt",
  "freeze": 10,
  "hsv_h": 0.05,
  "hsv_s": 0.9,
  "hsv_v": 0.6,
  "degrees": 10,
  "scale": 0.7,
  "mixup": 0.15,
  "copy_paste": 0.3
}
```

### 전략
- **Backbone Freeze (`freeze=10`)**: COCO 사전학습 범용 feature 유지, detection head만 파인튜닝
- **Augmentation 강화**: 색상/밝기/크기 다양화로 단일 환경 오버피팅 완화
- 현재 학습 가중치(`runs/20260427_152606/weights/best.pt`)는 별도 보존됨 (덮어쓰지 않음)

### 장기 옵션 (데이터 수집 후)
- COCO person/dog 데이터 믹스 → 완전히 다른 환경 이미지로 범용성 강화
- SAM2 Video Predictor 도입 → 시퀀스 첫 프레임 클릭 1회로 전체 전파
- 주기적 자동 재학습
- 통계 대시보드 / 작업 이력 관리
