# SAM3 Auto Labeling — 백엔드 API 문서

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [아키텍처 구조](#2-아키텍처-구조)
3. [전역 상태 (state.py)](#3-전역-상태-statepy)
4. [라우터 엔드포인트](#4-라우터-엔드포인트)
   - [Project 라우터](#41-project-라우터)
   - [SAM Label 라우터](#42-sam-label-라우터)
   - [Export (Save) 라우터](#43-export-save-라우터)
   - [Train 라우터](#44-train-라우터)
   - [Guide 라우터](#45-guide-라우터)
5. [서비스 레이어](#5-서비스-레이어)
6. [실행 방법](#6-실행-방법)

---

## 1. 프로젝트 개요

SAM3 Auto Labeling 백엔드는 **FastAPI** 기반의 REST API 서버입니다. 주요 역할은 다음과 같습니다.

- 서버 파일시스템의 이미지 폴더를 탐색하고 이미지를 제공
- SAM2 (SAM3) 모델을 이용한 클릭 기반 인터랙티브 세그멘테이션
- YOLO 세그멘테이션 모델을 이용한 자동 라벨 가이드 제공
- 생성된 라벨을 YOLO 세그멘테이션 포맷(`.txt`)으로 저장
- SLURM 클러스터를 통한 YOLO 재학습 제출 및 상태 조회

### 기술 스택

| 항목 | 내용 |
|------|------|
| 프레임워크 | FastAPI |
| 세그멘테이션 모델 | SAM2 (`sam2.1_hiera_small`) |
| 객체 탐지 | Ultralytics YOLO (세그멘테이션) |
| 학습 인프라 | SLURM (`sbatch`) |
| CORS | 모든 origin 허용 (내부망 데모) |

### 서버 시작 시 동작 (`startup`)

1. `.env` 파일 로드 (환경변수 설정)
2. SAM3 체크포인트 로드 (`SAM3_CHECKPOINT` 환경변수 또는 기본 경로 `checkpoints/sam2.1_hiera_small.pt`)
3. `YoloService` 초기화 (SLURM 상태 복구)

---

## 2. 아키텍처 구조

```
backend/
├── main.py                  # FastAPI 앱 진입점, 라우터 등록, startup 이벤트
├── state.py                 # 전역 인메모리 세션 상태 정의
├── routers/
│   ├── project.py           # 폴더 탐색, 이미지 목록, 이미지 서빙, 업로드
│   ├── sam_label.py         # SAM3 클릭/박스 세그멘테이션, 객체 관리
│   ├── export.py            # 라벨 저장 (YOLO .txt 포맷)
│   ├── train.py             # YOLO 학습 제출/조회/중지
│   ├── guide.py             # YOLO 추론 기반 라벨 가이드
│   ├── label.py             # (레거시) SAM1 + Grounding DINO 기반 라벨링
│   ├── correct.py           # (레거시) SAM1 기반 마스크 보정
│   └── images.py            # (레거시) UUID 기반 이미지 업로드
└── services/
    ├── sam3_service.py      # SAM2 모델 래퍼 (현재 사용)
    ├── sam_service.py       # SAM1 모델 래퍼 (레거시)
    ├── yolo_service.py      # YOLO 추론 + SLURM 학습 관리
    └── export_service.py    # 마스크 → YOLO 폴리곤 변환 유틸
```

### URL 접두사

모든 API 엔드포인트는 `/api` 접두사를 사용합니다.

```
/api/project/...     ← project 라우터
/api/sam/...         ← sam_label 라우터
/api/save/...        ← export 라우터
/api/train/...       ← train 라우터
/api/guide/...       ← guide 라우터
```

---

## 3. 전역 상태 (state.py)

서버는 프로세스 메모리 내에 세션 상태를 유지합니다. 서버 재시작 시 초기화됩니다.

### 데이터 클래스

#### `ClickState` — 객체 1개의 SAM 클릭 누적 상태

```python
@dataclass
class ClickState:
    class_name: str                      # 클래스명 (예: "사람")
    initial_box: Optional[list[int]]     # YOLO bbox [x1, y1, x2, y2] (픽셀)
    coords: list[list[int]]              # 클릭 좌표 목록 [[x, y], ...]
    labels: list[int]                    # 클릭 레이블 (1=positive, 0=negative)
    prev_logits: Optional[np.ndarray]    # SAM 이전 예측 로짓 (1, 256, 256)
    mask: Optional[np.ndarray]           # 최종 마스크 (H, W) bool
    polygon: Optional[list[float]]       # YOLO 가이드용 normalized flat polygon
```

#### `FrameState` — 이미지 1장의 라벨 상태

```python
@dataclass
class FrameState:
    image_path: str
    image_rgb: Optional[np.ndarray]      # lazy loaded RGB 이미지
    objects: dict[int, ClickState]       # obj_id → ClickState
    next_obj_id: int                     # 다음에 생성될 obj_id
    saved: bool                          # 디스크에 저장됐는지 여부
```

#### `TrainJobState` — 학습 작업 상태 (레거시)

```python
@dataclass
class TrainJobState:
    running: bool
    epoch: int
    total_epochs: int
    metrics: dict
    model_path: str
    error: str
```

### 전역 변수

| 변수 | 타입 | 설명 |
|------|------|------|
| `CLASSES` | `list[str]` | 지원 클래스 목록: `["사람", "강아지", "로봇", "휠체어"]` |
| `CLASS_INDEX` | `dict[str, int]` | 클래스명 → YOLO 클래스 ID 매핑 |
| `current_project_folder` | `str` | 현재 선택된 프로젝트 폴더 경로 |
| `frames` | `dict[str, FrameState]` | 이미지 경로 → FrameState 매핑 |
| `image_list` | `list[str]` | 현재 폴더의 이미지 경로 목록 (순서 유지) |
| `train_job` | `TrainJobState` | 학습 작업 상태 (레거시) |
| `registered_models` | `dict[str, str]` | 등록된 모델 목록 |

---

## 4. 라우터 엔드포인트

### 4.1 Project 라우터

파일: `routers/project.py`

#### 환경변수

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `BASE_PROJECT_DIR` | `/` | 접근 허용 기준 디렉토리 |
| `UPLOAD_DIR` | `../uploads` (상대) | 업로드 파일 저장 디렉토리 |

보안: `_safe_path()` 함수로 `BASE_PROJECT_DIR` 또는 `UPLOAD_DIR` 밖의 경로 접근을 차단합니다 (HTTP 403).

---

#### `GET /api/project/folders`

서버 파일시스템의 하위 폴더 목록을 반환합니다.

**Query Parameters**

| 파라미터 | 필수 | 설명 |
|---------|------|------|
| `root` | 필수 | 탐색할 디렉토리 절대 경로 |

**Response**

```json
{
  "path": "/nas03/1_EV_LABELING",
  "folders": [
    "/nas03/1_EV_LABELING/batch_001",
    "/nas03/1_EV_LABELING/batch_002"
  ]
}
```

---

#### `GET /api/project/images`

지정 폴더의 이미지 목록을 반환하고, 세션 상태(`state.current_project_folder`, `state.image_list`)를 갱신합니다.

지원 확장자: `.jpg`, `.jpeg`, `.png`, `.bmp`, `.webp`

**Query Parameters**

| 파라미터 | 필수 | 설명 |
|---------|------|------|
| `folder` | 필수 | 이미지 폴더 절대 경로 |

**Response**

```json
{
  "folder": "/nas03/1_EV_LABELING/batch_001",
  "images": [
    {
      "path": "/nas03/1_EV_LABELING/batch_001/frame_001.jpg",
      "filename": "frame_001.jpg",
      "saved": true
    }
  ],
  "total": 42
}
```

`saved` 필드는 메모리 상태(`FrameState.saved`) 또는 디스크의 `labels/{stem}.txt` 파일 존재 여부로 결정됩니다.

---

#### `GET /api/project/image`

이미지 파일을 직접 서빙합니다 (`FileResponse`).

**Query Parameters**

| 파라미터 | 필수 | 설명 |
|---------|------|------|
| `path` | 필수 | 이미지 절대 경로 |

**Response**: 이미지 바이너리 (Content-Type 자동)

---

#### `POST /api/project/upload`

이미지 파일을 서버에 업로드합니다.

**Query Parameters**

| 파라미터 | 필수 | 설명 |
|---------|------|------|
| `folder_name` | 필수 | 절대 경로 또는 `UPLOAD_DIR` 하위 폴더명 |

**Request Body**: `multipart/form-data`, `files` 필드에 이미지 파일 1개 이상

**Response**

```json
{
  "folder": "/nas03/1_EV_LABELING/my_folder",
  "uploaded": 5,
  "files": ["img_001.jpg", "img_002.jpg"]
}
```

---

#### `POST /api/project/select`

프로젝트 폴더를 선택하고 세션 상태를 갱신합니다.

**Request Body**

```json
{
  "folder": "/nas03/1_EV_LABELING/batch_001"
}
```

**Response**

```json
{
  "folder": "/nas03/1_EV_LABELING/batch_001",
  "total": 42
}
```

---

### 4.2 SAM Label 라우터

파일: `routers/sam_label.py`

SAM3 (SAM2) 모델을 이용한 인터랙티브 세그멘테이션 API입니다. 각 이미지-객체 조합에 대해 클릭을 누적하여 마스크를 갱신합니다.

---

#### `POST /api/sam/click`

이미지에 클릭 포인트를 추가하고 SAM3 마스크를 갱신합니다.

- `obj_id == -1`이면 새 객체를 생성합니다.
- 기존 `obj_id`를 전달하면 해당 객체에 클릭을 누적합니다.
- `prev_logits`를 이용해 이전 예측을 시드로 점진적으로 마스크를 개선합니다.

**Request Body**

```json
{
  "image_path": "/nas03/.../frame_001.jpg",
  "x": 320,
  "y": 240,
  "label": 1,
  "class_name": "사람",
  "obj_id": -1
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `image_path` | `string` | 이미지 절대 경로 |
| `x`, `y` | `int` | 이미지 픽셀 좌표 |
| `label` | `int` | `1`=positive (포함), `0`=negative (제외) |
| `class_name` | `string` | CLASSES 중 하나 |
| `obj_id` | `int` | `-1`=새 객체, 그 외=기존 객체 ID |

**Response**

```json
{
  "obj_id": 0,
  "class_name": "사람",
  "polygons": [[0.12, 0.23, 0.34, 0.45, ...]],
  "click_count": 1,
  "from_box": false
}
```

`polygons`: normalized flat 좌표 배열의 배열 (YOLO 세그멘테이션 포맷)

**오류**: SAM3 모델 미로드 시 `503 Service Unavailable`

---

#### `POST /api/sam/accept-box`

YOLO bbox를 SAM3 box prompt로 변환하여 초기 마스크를 생성합니다. 이후 `/api/sam/click`으로 같은 `obj_id`에 클릭을 추가해 마스크를 보정할 수 있습니다.

**Request Body**

```json
{
  "image_path": "/nas03/.../frame_001.jpg",
  "class_name": "사람",
  "box": [100, 50, 400, 600]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `box` | `list[int]` | `[x1, y1, x2, y2]` 픽셀 좌표 |

**Response**: `/api/sam/click`과 동일 (`from_box: true`, `click_count: 0`)

---

#### `DELETE /api/sam/object`

특정 객체를 삭제합니다.

**Request Body**

```json
{
  "image_path": "/nas03/.../frame_001.jpg",
  "obj_id": 2
}
```

**Response**

```json
{ "ok": true, "obj_id": 2 }
```

---

#### `GET /api/sam/objects`

이미지의 현재 객체 목록과 저장 상태를 반환합니다.

**Query Parameters**

| 파라미터 | 필수 | 설명 |
|---------|------|------|
| `image_path` | 필수 | 이미지 절대 경로 |

**Response**

```json
{
  "objects": [
    {
      "obj_id": 0,
      "class_name": "사람",
      "polygons": [[0.12, 0.23, ...]],
      "click_count": 3,
      "from_box": false
    }
  ],
  "saved": false
}
```

프레임 데이터가 없으면 `{ "objects": [] }` 반환.

---

#### `DELETE /api/sam/objects`

이미지의 모든 객체를 초기화합니다 (`next_obj_id`도 0으로 리셋).

**Query Parameters**

| 파라미터 | 필수 | 설명 |
|---------|------|------|
| `image_path` | 필수 | 이미지 절대 경로 |

**Response**

```json
{ "ok": true }
```

---

### 4.3 Export (Save) 라우터

파일: `routers/export.py`

라벨을 YOLO 세그멘테이션 포맷(`.txt`)으로 저장합니다.

저장 경로: `{이미지_폴더}/labels/{이미지_stem}.txt`

YOLO `.txt` 파일 포맷 (라인 1개 = 객체 1개):
```
{class_id} {x1} {y1} {x2} {y2} ... {xn} {yn}
```
모든 좌표는 이미지 폭/높이로 정규화된 값입니다.

---

#### `POST /api/save`

현재 이미지의 라벨을 저장합니다. 파일이 이미 존재하면 conflict를 반환합니다.

**Request Body**

```json
{
  "image_path": "/nas03/.../frame_001.jpg",
  "force": false
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `force` | `bool` | `true`이면 기존 파일을 덮어씁니다 |

**Response (성공)**

```json
{
  "ok": true,
  "label_path": "/nas03/.../labels/frame_001.txt",
  "object_count": 3
}
```

**Response (충돌, `force=false`이고 파일이 이미 존재할 때)**

```json
{
  "conflict": true,
  "existing_mtime": 1714320000.0,
  "message": "다른 사용자가 이미 저장했습니다. 덮어쓰시겠습니까?"
}
```

---

#### `POST /api/save/all`

세션에 로드된 모든 프레임의 라벨을 일괄 저장합니다.

**Query Parameters**

| 파라미터 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| `force` | `bool` | `false` | 기존 파일 덮어쓰기 여부 |

**Response**

```json
{
  "saved": 10,
  "skipped": 2,
  "errors": [
    { "path": "/nas03/.../frame_005.jpg", "error": "Permission denied" }
  ]
}
```

---

#### `GET /api/save/status`

이미지의 저장 상태를 조회합니다.

**Query Parameters**

| 파라미터 | 필수 | 설명 |
|---------|------|------|
| `image_path` | 필수 | 이미지 절대 경로 |

**Response**

```json
{
  "saved": true,
  "label_exists": true
}
```

---

### 4.4 Train 라우터

파일: `routers/train.py`

YOLO 세그멘테이션 모델 재학습을 SLURM `sbatch`로 제출하고 상태를 관리합니다.

---

#### `POST /api/train/start`

SLURM에 YOLO 학습 작업을 제출합니다. `scripts/train.sbatch` 템플릿을 사용합니다.

**Request Body**

```json
{
  "epochs": 50,
  "imgsz": 1280,
  "batch": 4,
  "model": ""
}
```

| 필드 | 기본값 | 설명 |
|------|--------|------|
| `epochs` | `50` | 학습 에폭 수 |
| `imgsz` | `1280` | 입력 이미지 크기 |
| `batch` | `4` | 배치 크기 |
| `model` | `""` | 베이스 모델 경로 (미지정 시 `YOLO_BASE_MODEL` 환경변수) |

**Response (성공)**

```json
{ "ok": true, "job_id": "12345" }
```

**Response (이미 실행 중)**

``` 
HTTP 409 Conflict
```

**관련 환경변수**

| 환경변수 | 설명 |
|---------|------|
| `YOLO_BASE_MODEL` | 베이스 모델 (기본: `yolov8n-seg.pt`) |
| `YOLO_DATASET_DIR` | 데이터셋 `data.yaml` 위치 |
| `YOLO_WEIGHTS_DIR` | 학습된 가중치 저장 경로 |
| `YOLO_LOGS_DIR` | SLURM 로그 파일 저장 경로 |

---

#### `GET /api/train/status`

학습 작업의 현재 상태를 조회합니다. SLURM `squeue`를 실시간으로 조회합니다.

**Response**

```json
{
  "running": true,
  "pending": false,
  "job_id": "12345",
  "epoch": 23,
  "total_epochs": 50,
  "metrics": {
    "mAP50": 0.7821,
    "mAP50_95": 0.5432
  },
  "error": "",
  "log_path": "/tmp/yolo_logs/train_12345.out"
}
```

---

#### `POST /api/train/stop`

SLURM `scancel`로 학습 작업을 중지합니다.

**Response**

```json
{ "ok": true }
```

---

#### `POST /api/train/prepare-dataset`

`scripts/prepare_dataset.py`를 실행해 데이터셋 `data.yaml`을 생성합니다.

**Response**

```json
{ "ok": true, "data_yaml": "/nas03/dataset/data.yaml" }
```

---

#### `GET /api/train/models`

저장된 YOLO 모델 목록을 반환합니다. `YOLO_WEIGHTS_DIR` 하위의 `best.pt` 파일을 mtime 역순으로 반환합니다.

**Response**

```json
{
  "models": [
    {
      "name": "20260428_143000",
      "path": "/nas03/models/yolo_seg/20260428_143000/weights/best.pt",
      "size_mb": 22.4,
      "created_at": "2026-04-28 14:30",
      "map50": 0.8123
    }
  ]
}
```

---

### 4.5 Guide 라우터

파일: `routers/guide.py`

학습된 YOLO 모델로 이미지를 추론하여 라벨 가이드를 제공합니다. 추론 결과를 사용자가 검토 후 수동으로 승인하면 `FrameState`에 반영됩니다.

---

#### `POST /api/guide/infer`

단일 이미지에 대해 YOLO 추론을 실행합니다.

**Request Body**

```json
{
  "image_path": "/nas03/.../frame_001.jpg",
  "model_path": "/nas03/models/yolo_seg/20260428/weights/best.pt",
  "conf": 0.3
}
```

**Response**

```json
{
  "objects": [
    {
      "obj_id": 0,
      "class_id": 0,
      "class_name": "사람",
      "confidence": 0.872,
      "bbox": [0.12, 0.15, 0.45, 0.88],
      "polygon": [0.12, 0.15, 0.34, 0.12, ...]
    }
  ]
}
```

`bbox`, `polygon`은 이미지 크기로 정규화된 값입니다.

---

#### `POST /api/guide/infer-all`

폴더 내 모든 이미지에 YOLO 추론을 백그라운드로 실행합니다. IoU 0.7 이상의 중복 객체는 자동으로 skip합니다.

**Request Body**

```json
{
  "folder": "/nas03/.../batch_001",
  "model_path": "/nas03/models/yolo_seg/.../best.pt",
  "conf": 0.3
}
```

**Response**

```json
{ "ok": true }
```

**오류**: 이미 실행 중이면 `HTTP 409 Conflict`

---

#### `GET /api/guide/infer-all/status`

전체 폴더 추론의 진행 상태를 조회합니다.

**Response**

```json
{
  "running": true,
  "progress": 23,
  "total": 100,
  "current_image": "frame_024.jpg",
  "accepted": 45,
  "skipped": 3,
  "error": ""
}
```

---

#### `POST /api/guide/accept`

Guide 추론 결과 중 선택한 객체를 `FrameState`에 추가합니다 (polygon 기반 `ClickState` 생성).

**Request Body**

```json
{
  "image_path": "/nas03/.../frame_001.jpg",
  "objects": [
    { "class_name": "사람", "polygon": [0.12, 0.15, 0.34, 0.12, ...] }
  ]
}
```

**Response**

```json
{
  "ok": true,
  "added": [
    { "obj_id": 5, "class_name": "사람" }
  ]
}
```

---

## 5. 서비스 레이어

### 5.1 SAM3Service (`services/sam3_service.py`)

SAM2 모델 (`sam2.1_hiera_small`) 싱글턴 래퍼입니다.

```python
SAM3Service.get()          # 싱글턴 인스턴스 반환
service.load(checkpoint, model_cfg)  # 모델 로드
service.set_image(key, image_rgb)    # 이미지 임베딩 (캐시)
service.predict(coords, labels, prev_logits, box)  # 마스크 예측
service.is_loaded          # 모델 로드 여부 (property)
```

**주요 동작**:
- `set_image()`는 이미지 key가 바뀌지 않으면 재임베딩을 skip합니다.
- `predict()`는 box와 point를 함께 사용할 수 있습니다. box만 있을 때 (`coords=[]`)는 `multimask_output=True`로 여러 마스크 후보를 반환합니다.
- 스레드 안전을 위해 `_infer_lock` (threading.Lock) 사용.

**사용 라이브러리**: `sam2.build_sam.build_sam2`, `sam2.sam2_image_predictor.SAM2ImagePredictor`

### 5.2 SAMService (`services/sam_service.py`)

SAM1 (segment-anything) 모델 래퍼입니다. 현재 `routers/label.py`, `routers/correct.py`에서 사용하는 레거시 서비스입니다.

```python
service.load(checkpoint)              # 체크포인트에서 vit_b/l/h 자동 판별
service.set_image(image_id, image_rgb)
service.predict_box(box)              # bbox → 마스크
service.predict_points(coords, labels, prev_logits)  # 포인트 → 마스크
```

**사용 라이브러리**: `segment_anything` (Meta SAM1)

### 5.3 YoloService (`services/yolo_service.py`)

YOLO 추론과 SLURM 학습 관리를 담당하는 싱글턴 서비스입니다.

#### 추론 (`infer`)

```python
yolo.infer(image_rgb, model_path, conf) -> list[dict]
```

- `model_path`가 변경될 때만 모델을 재로드합니다 (캐시).
- YOLO 영어 클래스명을 한국어로 변환합니다:

  | YOLO 클래스 | 앱 클래스 |
  |------------|---------|
  | `person` | `사람` |
  | `dog` | `강아지` |
  | `robot` | `로봇` |
  | `wheelchair` | `휠체어` |

- 반환값: `[{ obj_id, class_id, class_name, confidence, bbox, polygon }]`

#### 학습 관리

- `submit_training(epochs, imgsz, batch, model)`: SLURM `sbatch` 제출
- `get_status()`: `squeue`로 SLURM 상태 조회, 로그 파일 파싱으로 epoch/mAP 갱신
- `stop_training()`: `scancel`로 작업 중지
- `list_models()`: `YOLO_WEIGHTS_DIR` 하위 `best.pt` 파일 목록, `results.csv`에서 mAP50 파싱
- `_restore_state()`: 시작 시 `.train_state` 파일로 SLURM job 상태 복구

### 5.4 export_service (`services/export_service.py`)

마스크를 YOLO 세그멘테이션 포맷의 폴리곤으로 변환하는 유틸리티입니다.

#### `mask_to_polygons(mask, w, h)`

```python
def mask_to_polygons(mask: np.ndarray, w: int, h: int) -> list[list[float]]:
```

- 입력: `(H, W)` bool 마스크
- 출력: normalized flat 좌표 배열의 배열 `[[x1, y1, x2, y2, ...], ...]`
- `cv2.findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)` 사용
- 각 contour를 독립된 polygon으로 반환 (구멍 있는 객체 지원)

#### `build_yolo_lines(seg_results, corrections, class_map, w, h)`

보정 상태(corrections)를 반영해 YOLO `.txt` 파일 라인을 생성합니다 (레거시 SAM1 파이프라인용).

---

## 6. 실행 방법

### 환경 설정

```bash
# .env 파일 (backend/ 폴더에 위치)
SAM3_CHECKPOINT=/path/to/checkpoints/sam2.1_hiera_small.pt
SAM3_CONFIG=sam2.1_hiera_s.yaml
BASE_PROJECT_DIR=/nas03
UPLOAD_DIR=/nas03/uploads
LABELING_BASE_DIR=/nas03/1_EV_LABELING
YOLO_DATASET_DIR=/nas03/dataset
YOLO_WEIGHTS_DIR=/nas03/models/yolo_seg
YOLO_LOGS_DIR=/tmp/yolo_logs
YOLO_BASE_MODEL=yolov8n-seg.pt
```

### 서버 실행

```bash
cd /home1/sota/SAM3_based_Auto_Labeling_Tool/web_app/backend

# 의존성 설치
pip install fastapi uvicorn "python-multipart" opencv-python numpy torch
pip install git+https://github.com/facebookresearch/sam2.git
pip install ultralytics

# 개발 서버 실행
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 프로덕션 실행
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
```

> workers=1 권장: SAM3 모델과 YOLO 모델이 GPU 메모리를 공유하므로 멀티 worker는 충돌 가능성이 있습니다.

### API 문서 접근

서버 실행 후 브라우저에서:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
