# SAM3 Auto Labeling — 프론트엔드 개발 가이드

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [컴포넌트 구조](#2-컴포넌트-구조)
3. [컴포넌트 상세](#3-컴포넌트-상세)
   - [App.tsx — 루트 컴포넌트](#31-apptsx--루트-컴포넌트)
   - [LabelCanvas.tsx — 캔버스 라벨링](#32-labelcanvastsx--캔버스-라벨링)
   - [Sidebar.tsx — 객체 목록 패널](#33-sidebartsx--객체-목록-패널)
   - [ImageNavigator.tsx — 이미지 탐색](#34-imagenavigator-tsx--이미지-탐색)
   - [ClassSelector.tsx — 클래스 선택](#35-classselectortsx--클래스-선택)
   - [ModeToggle.tsx — 라벨링 모드 전환](#36-modetoggletsx--라벨링-모드-전환)
   - [GuidePanel.tsx — YOLO Guide 패널](#37-guidepaneltsx--yolo-guide-패널)
   - [ImageStrip.tsx / Uploader.tsx — 폐기 컴포넌트](#38-imagestrips--uploadertsx--폐기-컴포넌트)
4. [API 클라이언트 (client.ts)](#4-api-클라이언트-clientts)
5. [빌드 및 개발 서버 실행](#5-빌드-및-개발-서버-실행)

---

## 1. 프로젝트 개요

SAM3 Auto Labeling 프론트엔드는 **React 18 + TypeScript + Vite** 기반의 단일 페이지 애플리케이션(SPA)입니다.

### 기술 스택

| 항목 | 내용 |
|------|------|
| 프레임워크 | React 18 |
| 언어 | TypeScript |
| 빌드 도구 | Vite |
| 스타일링 | Inline CSS (CSS-in-JS 없음, 외부 UI 라이브러리 없음) |
| API 통신 | Fetch API (래퍼 함수 사용) |
| Canvas 렌더링 | HTML5 Canvas 2D API |

### 주요 기능

- 서버 파일시스템 폴더 탐색 및 PC에서 이미지 업로드
- HTML5 Canvas 위에서 클릭으로 SAM3 인터랙티브 세그멘테이션
- 좌클릭(positive) / 우클릭(negative) 포인트로 마스크 점진적 개선
- 학습된 YOLO 모델로 라벨 가이드 자동 제안 (현재 이미지 / 전체 폴더)
- YOLO 재학습 제출 및 진행 상태 모니터링 (SLURM)
- YOLO 세그멘테이션 포맷 `.txt`로 저장 (단건 / 전체)

### 화면 구성 (라벨링 모드)

```
┌────────────────────────────────────────────────────────┬──────────┐
│ [← 폴더변경] [클래스 선택] [모드 토글] [전체 저장]     │         │
├────────────────────────────────────────────────────────┤ Guide   │
│             ImageNavigator (이미지 탐색 바)             │ Panel   │
├──────────┬─────────────────────────────────────────────┤ (YOLO   │
│          │                                             │ Guide   │
│ Sidebar  │          LabelCanvas                        │ 모드일  │
│ (객체    │          (캔버스 영역)                       │ 때만    │
│  목록)   │                                             │ 표시)   │
│          │                                             │         │
│          │                                             │         │
│          ├─────────────────────────────────────────────┤         │
│          │ 상태 메시지                                  │         │
└──────────┴─────────────────────────────────────────────┴─────────┘
```

---

## 2. 컴포넌트 구조

```
src/
├── App.tsx                      # 루트 컴포넌트 — 전역 상태 관리, 화면 라우팅
├── api/
│   └── client.ts                # API 클라이언트, 타입 정의, 상수
└── components/
    ├── LabelCanvas.tsx          # Canvas 기반 이미지+마스크 렌더링, 클릭 처리
    ├── Sidebar.tsx              # 객체 목록 패널, 저장/삭제/초기화 버튼
    ├── ImageNavigator.tsx       # 이미지 이전/다음 탐색 컨트롤
    ├── ClassSelector.tsx        # 클래스 선택 버튼 그룹
    ├── ModeToggle.tsx           # SAM3 / YOLO Guide 모드 전환
    ├── GuidePanel.tsx           # YOLO 추론 가이드 + 재학습 패널
    ├── ImageStrip.tsx           # (폐기) deprecated
    └── Uploader.tsx             # (폐기) deprecated
```

### 컴포넌트 계층

```
App
├── 폴더 탐색 화면 (projectFolder === null)
│   ├── 탭: 서버 폴더 / 내 PC 업로드
│   └── 폴더 브라우저 (인라인)
└── 라벨링 화면 (projectFolder 선택 후)
    ├── Sidebar
    ├── 메인 영역
    │   ├── 툴바 (ClassSelector, ModeToggle, 전체저장 버튼)
    │   ├── ImageNavigator
    │   └── LabelCanvas
    └── GuidePanel (mode === "yolo_guide" 일 때만)
```

---

## 3. 컴포넌트 상세

### 3.1 App.tsx — 루트 컴포넌트

애플리케이션의 모든 전역 상태를 관리하는 루트 컴포넌트입니다. 별도의 상태 관리 라이브러리 없이 `useState`와 `useEffect`만 사용합니다.

#### 상태 목록

| 상태 변수 | 타입 | 설명 |
|----------|------|------|
| `folderInput` | `string` | 폴더 탐색 입력창 값 |
| `subFolders` | `string[]` | 탐색된 하위 폴더 목록 |
| `projectFolder` | `string \| null` | 선택된 프로젝트 폴더 경로 |
| `images` | `ImageEntry[]` | 현재 폴더의 이미지 목록 |
| `currentIdx` | `number` | 현재 이미지 인덱스 |
| `imageMeta` | `{ w, h } \| null` | 현재 이미지 원본 크기 |
| `objects` | `SamObject[]` | 현재 이미지의 세그멘테이션 객체 목록 |
| `selectedObjId` | `number \| null` | 선택된 객체 ID |
| `clickPoints` | `ClickPoint[]` | 클릭 포인트 (optimistic 렌더링용) |
| `selectedClass` | `ClassName` | 현재 선택된 클래스 |
| `mode` | `LabelMode` | 라벨링 모드 (`"sam"` \| `"yolo_guide"`) |
| `saving` | `boolean` | 저장 중 여부 |
| `saved` | `boolean` | 현재 이미지 저장 완료 여부 |
| `savingAll` | `boolean` | 전체 저장 중 여부 |

#### 주요 핸들러

| 핸들러 | 설명 |
|--------|------|
| `handleFolderBrowse()` | 서버 폴더 탐색 API 호출 |
| `handleSelectFolder(folder)` | 폴더 선택 → 이미지 목록 로드 |
| `handleNavigate(idx)` | 이미지 이동 |
| `handleCanvasClick(x, y, label)` | SAM3 클릭 → `api.samClick()` 호출, optimistic 업데이트 |
| `handleObjectSelect(objId)` | 객체 선택/해제 |
| `handleDelete(objId)` | 객체 삭제 |
| `handleClear()` | 전체 객체 초기화 (confirm 대화상자) |
| `handleSave()` | 현재 이미지 저장, conflict 시 confirm 대화상자 |
| `handleSaveAll()` | 모든 이미지 저장 후 목록 갱신 |
| `handleNewObject()` | 새 객체 생성 준비 (obj_id 초기화) |
| `handleGuideAccept(guideObjects)` | Guide 결과 승인 → 객체 목록 갱신 |
| `handleUpload(e)` | PC에서 이미지 업로드 |

#### 키보드 단축키

| 단축키 | 동작 |
|--------|------|
| `Ctrl + S` | 현재 이미지 저장 |
| `ArrowRight` | 다음 이미지 |
| `ArrowLeft` | 이전 이미지 |
| `F` / `f` | 새 객체 생성 준비 |

#### useEffect

| effect | 트리거 | 동작 |
|--------|--------|------|
| 이미지 크기 로드 | `imageUrl` 변경 | `new Image()`로 원본 크기(`imageMeta`) 조회 |
| 객체 로드 | `currentImage.path` 변경 | `api.getObjects()` 호출, 상태 초기화 |
| 키보드 이벤트 | 매 렌더 | `keydown` 이벤트 등록/해제 |

#### 화면 분기

- `projectFolder === null`: 폴더 탐색 화면 렌더링 (탭: 서버 폴더 / 내 PC 업로드)
- `projectFolder !== null`: 라벨링 메인 화면 렌더링

---

### 3.2 LabelCanvas.tsx — 캔버스 라벨링

HTML5 Canvas 위에 이미지와 세그멘테이션 폴리곤을 렌더링하고 클릭 이벤트를 처리하는 핵심 컴포넌트입니다.

#### Props 인터페이스

```typescript
interface Props {
  imageUrl: string;          // 이미지 API URL
  imageW: number;            // 원본 이미지 폭 (픽셀)
  imageH: number;            // 원본 이미지 높이 (픽셀)
  objects: SamObject[];      // 렌더링할 객체 목록
  selectedObjId: number | null; // 선택된 객체 ID (강조 표시)
  clickPoints: ClickPoint[];    // 클릭 포인트 (optimistic 렌더링)
  onCanvasClick: (x: number, y: number, label: 0 | 1) => void;
  onObjectSelect: (objId: number) => void;
}
```

#### 주요 기능

**레이아웃 계산**

- `ResizeObserver`로 컨테이너 크기를 실시간 추적합니다.
- `scale = Math.min(containerW / imageW, containerH / imageH)`: 이미지 종횡비를 유지하면서 캔버스에 맞춥니다.
- `offsetX`, `offsetY`로 이미지를 캔버스 중앙에 배치합니다.

**좌표 변환**

```typescript
// 정규화 좌표 → 캔버스 픽셀
toCanvas(nx, ny) => [offsetX + nx * drawW, offsetY + ny * drawH]

// 캔버스 픽셀 → 이미지 픽셀
toImagePixel(cx, cy) => [
  Math.round(((cx - offsetX) / drawW) * imageW),
  Math.round(((cy - offsetY) / drawH) * imageH)
]
```

**렌더링 순서** (useEffect — 의존성: imageUrl, objects, selectedObjId, clickPoints, 크기)

1. 캔버스 초기화 (`clearRect`)
2. 배경 (#111) 채우기
3. 이미지 그리기 (`drawImage`)
4. 객체별 폴리곤 그리기:
   - 선택된 객체: 불투명도 45%, 선 두께 2.5px
   - 비선택 객체: 불투명도 25%, 선 두께 1.5px
   - 클래스별 색상 (`CLASS_COLORS`) 적용
   - 폴리곤 무게중심에 클래스명 텍스트 표시
5. 클릭 포인트 그리기:
   - positive (label=1): 초록 (#00e676), "+" 텍스트
   - negative (label=0): 빨강 (#ff1744), "−" 텍스트

**클릭 처리** (`handleMouseDown`)

1. 클릭 좌표를 캔버스 → 정규화 좌표로 변환
2. `hitTest()`로 클릭한 위치의 객체 탐색 (ray casting 알고리즘)
3. 객체 위 클릭 → `onObjectSelect()` 호출 (객체 선택)
4. 빈 영역 클릭 → 이미지 픽셀 좌표로 변환 후 `onCanvasClick()` 호출
5. 우클릭 → label=0 (negative), 좌클릭 → label=1 (positive)

**히트 테스트**

```typescript
function pointInPolygon(nx, ny, poly): boolean
// Ray casting 알고리즘으로 정규화 좌표가 폴리곤 내부에 있는지 판별
```

---

### 3.3 Sidebar.tsx — 객체 목록 패널

현재 이미지의 객체 목록을 보여주고 저장/삭제/초기화 작업을 수행하는 좌측 고정 패널입니다.

#### Props 인터페이스

```typescript
interface Props {
  objects: SamObject[];
  selectedObjId: number | null;
  onSelect: (objId: number) => void;
  onDelete: (objId: number) => void;
  onClear: () => void;
  onSave: () => void;
  onNewObject: () => void;
  saving: boolean;    // 저장 중 여부 (버튼 비활성화)
  saved: boolean;     // 저장 완료 여부 (버튼 색상 변경)
}
```

#### 주요 기능

- 객체 목록을 클래스 색상 점과 함께 표시
- 선택된 객체는 테두리 색상으로 강조
- 각 객체 항목에 `B` (box에서 생성), `+N` (클릭 횟수) 배지 표시
- `×` 버튼으로 개별 객체 삭제 (이벤트 버블링 차단: `e.stopPropagation()`)
- 하단 버튼:
  - `+ 새 객체`: 새 객체 생성 준비
  - `전체 초기화`: 객체가 1개 이상일 때만 표시
  - `저장 (Ctrl+S)` / `저장 중...` / `✓ 저장됨`: 상태에 따라 텍스트/색상 변경

---

### 3.4 ImageNavigator.tsx — 이미지 탐색

이미지 목록을 이전/다음으로 탐색하는 네비게이션 컨트롤입니다.

#### Props 인터페이스

```typescript
interface Props {
  images: ImageEntry[];
  currentIdx: number;
  onNavigate: (idx: number) => void;
  unsaved: boolean;    // 미저장 객체 존재 여부
}
```

#### 주요 기능

- `◀◀` / `◀` / `▶` / `▶▶` 버튼으로 첫/이전/다음/마지막 이미지 이동
- 현재 이미지 파일명 표시
- 저장 상태 배지:
  - `●미저장` (주황, `unsaved=true`일 때)
  - `✓저장됨` (초록, 저장 완료 시)
- `unsaved=true` 상태에서 이동 시 `window.confirm()` 대화상자로 경고
- 현재 위치 표시: `{currentIdx + 1} / {total}`

---

### 3.5 ClassSelector.tsx — 클래스 선택

라벨링할 클래스를 선택하는 버튼 그룹 컴포넌트입니다.

#### Props 인터페이스

```typescript
interface Props {
  selected: ClassName;
  onChange: (cls: ClassName) => void;
}
```

#### 주요 기능

- `CLASSES` 배열(`["사람", "강아지", "로봇", "휠체어"]`)을 순회해 버튼 렌더링
- 선택된 클래스: 배경색 = 클래스 색상, 글자색 = 검정
- 비선택 클래스: 배경색 = 어두운 배경, 글자색 = 클래스 색상 (테두리만 색상)
- `CLASS_COLORS` 매핑으로 클래스별 고정 색상 적용:

  | 클래스 | 색상 |
  |--------|------|
  | 사람 | `#4FC3F7` (밝은 파랑) |
  | 강아지 | `#81C784` (초록) |
  | 로봇 | `#FFB74D` (주황) |
  | 휠체어 | `#CE93D8` (보라) |

---

### 3.6 ModeToggle.tsx — 라벨링 모드 전환

SAM3 수동 라벨링 모드와 YOLO Guide 모드를 전환하는 토글 버튼 컴포넌트입니다.

#### 타입

```typescript
export type LabelMode = "sam" | "yolo_guide";
```

#### Props 인터페이스

```typescript
interface Props {
  mode: LabelMode;
  onChange: (mode: LabelMode) => void;
  yoloAvailable?: boolean;   // false이면 YOLO Guide 버튼 비활성화
}
```

#### 주요 기능

- `SAM3` 버튼: 클릭 기반 SAM3 세그멘테이션 모드
- `YOLO Guide` 버튼: `yoloAvailable=false`이면 `cursor: "not-allowed"`, `opacity: 0.5`로 비활성화
- `yoloAvailable=false`일 때 tooltip: `"Phase 3에서 활성화"`
- 활성 모드 버튼은 강조 색상으로 표시

---

### 3.7 GuidePanel.tsx — YOLO Guide 패널

YOLO 모드에서 오른쪽에 표시되는 패널입니다. 학습된 YOLO 모델로 추론하고, 재학습을 관리합니다.

#### Props 인터페이스

```typescript
interface Props {
  imagePath: string;          // 현재 이미지 경로
  folder: string;             // 현재 프로젝트 폴더
  onAccept: (objects: GuideObject[]) => void;  // 선택 객체 승인 콜백
  onBatchDone?: () => void;   // 전체 폴더 추론 완료 콜백
}
```

#### 상태 목록

| 상태 변수 | 타입 | 설명 |
|----------|------|------|
| `models` | `ModelInfo[]` | 사용 가능한 YOLO 모델 목록 |
| `selectedModel` | `string` | 선택된 모델 경로 |
| `conf` | `number` | confidence threshold (0.05–0.95) |
| `inferring` | `boolean` | 단건 추론 중 여부 |
| `guideObjects` | `GuideObject[]` | 추론 결과 객체 목록 |
| `accepted` | `Set<number>` | 승인 선택된 객체 인덱스 집합 |
| `trainStatus` | `TrainStatus \| null` | 학습 상태 |
| `trainOpen` | `boolean` | 재학습 섹션 접힘/펼침 |
| `batchStatus` | `BatchStatus \| null` | 전체 폴더 추론 상태 |

#### 주요 기능

**설정 섹션**
- 모델 선택 `<select>`: 모델명과 mAP50 표시
- Confidence 슬라이더: 0.05–0.95 범위, 0.05 단위

**현재 이미지 Guide**
- `Guide 실행` 버튼 → `api.guideInfer()` 호출
- 추론 완료 시 결과 객체 목록 표시, 전체 체크박스로 사전 선택
- 체크박스로 개별 객체 승인/취소 선택
- `선택 적용` 버튼 → 선택된 객체를 `onAccept()` 콜백으로 전달

**전체 폴더 Guide**
- `전체 Guide 실행` → `api.guideInferAll()` 호출 (백그라운드 비동기 처리)
- 1.5초 간격으로 `api.getInferAllStatus()` 폴링
- 진행률 바 (progress / total)
- 완료 시 `onBatchDone?.()` 콜백 호출

**YOLO 재학습 (접힘 가능)**
- Epochs, Image Size, Batch 파라미터 입력
- `학습 시작 (sbatch)` → `api.startTraining()` 호출
- 15초 간격으로 학습 상태 폴링
- 학습 중일 때 에폭 진행률 바 + mAP50 표시
- `학습 중지` 버튼 → `api.stopTraining()` 호출

---

### 3.8 ImageStrip.tsx / Uploader.tsx — 폐기 컴포넌트

두 컴포넌트 모두 현재 폐기(deprecated) 상태이며 `null`만 반환합니다.

- `ImageStrip`: `ImageNavigator`로 대체됨
- `Uploader`: `App.tsx` 내 인라인 폴더 브라우저로 대체됨

---

## 4. API 클라이언트 (client.ts)

파일: `src/api/client.ts`

모든 백엔드 통신을 담당하는 중앙 API 클라이언트 모듈입니다.

### 타입 정의

```typescript
export const CLASSES = ["사람", "강아지", "로봇", "휠체어"] as const;
export type ClassName = (typeof CLASSES)[number];

export const CLASS_COLORS: Record<ClassName, string> = {
  사람: "#4FC3F7",
  강아지: "#81C784",
  로봇: "#FFB74D",
  휠체어: "#CE93D8",
};
```

```typescript
export interface ImageEntry {
  path: string;        // 서버 절대 경로
  filename: string;    // 파일명
  saved: boolean;      // 저장 여부
}

export interface SamObject {
  obj_id: number;
  class_name: ClassName;
  polygons: number[][];  // normalized flat 좌표 배열의 배열
  click_count: number;
  from_box: boolean;     // YOLO bbox에서 생성된 객체 여부
}

export interface GuideObject {
  obj_id: number;
  class_id: number;
  class_name: string;
  confidence: number;
  bbox: number[];      // [x1, y1, x2, y2] normalized
  polygon: number[];   // normalized flat 폴리곤
}

export interface TrainStatus {
  running: boolean;
  pending: boolean;
  job_id: string;
  epoch: number;
  total_epochs: number;
  metrics: { mAP50?: number; mAP50_95?: number };
  error: string;
  log_path: string;
}
```

### 기본 요청 함수

```typescript
async function request<T>(url: string, init?: RequestInit): Promise<T>
```

- `BASE = "/api"` 접두사 자동 적용
- 응답 상태가 `ok`가 아니면 응답 텍스트를 Error 메시지로 throw

### API 함수 목록

| 함수 | Method | URL | 설명 |
|------|--------|-----|------|
| `api.listFolders(root)` | GET | `/project/folders` | 하위 폴더 목록 조회 |
| `api.listImages(folder)` | GET | `/project/images` | 이미지 목록 조회 |
| `api.imageUrl(imagePath)` | — | `/project/image?path=...` | 이미지 URL 생성 (fetch 아님) |
| `api.samClick(imagePath, x, y, label, className, objId)` | POST | `/sam/click` | SAM3 클릭 |
| `api.getObjects(imagePath)` | GET | `/sam/objects` | 객체 목록 조회 |
| `api.deleteObject(imagePath, objId)` | DELETE | `/sam/object` | 객체 삭제 |
| `api.clearObjects(imagePath)` | DELETE | `/sam/objects` | 전체 객체 초기화 |
| `api.saveLabel(imagePath, force)` | POST | `/save` | 라벨 저장 |
| `api.saveAll(force)` | POST | `/save/all` | 전체 라벨 저장 |
| `api.startTraining(params)` | POST | `/train/start` | 학습 시작 |
| `api.getTrainStatus()` | GET | `/train/status` | 학습 상태 조회 |
| `api.stopTraining()` | POST | `/train/stop` | 학습 중지 |
| `api.listModels()` | GET | `/train/models` | 모델 목록 조회 |
| `api.guideInfer(imagePath, modelPath, conf)` | POST | `/guide/infer` | 단건 YOLO 추론 |
| `api.guideInferAll(folder, modelPath, conf)` | POST | `/guide/infer-all` | 전체 폴더 YOLO 추론 |
| `api.getInferAllStatus()` | GET | `/guide/infer-all/status` | 전체 추론 상태 조회 |
| `api.guideAccept(imagePath, objects)` | POST | `/guide/accept` | Guide 객체 승인 |
| `api.uploadImages(folderName, files)` | POST | `/project/upload` | 이미지 업로드 |

### 사용 예시

```typescript
// 폴더 탐색
const { folders } = await api.listFolders("/nas03/1_EV_LABELING");

// 이미지 목록 로드
const { images, total } = await api.listImages("/nas03/.../batch_001");

// 이미지 URL 생성 (직접 <img src> 또는 Canvas에 사용)
const url = api.imageUrl("/nas03/.../frame_001.jpg");

// SAM3 클릭
const result: SamObject = await api.samClick(
  "/nas03/.../frame_001.jpg",
  320, 240,   // 픽셀 좌표
  1,          // positive
  "사람",
  -1          // 새 객체
);

// 저장
const res = await api.saveLabel("/nas03/.../frame_001.jpg", false);
if (res.conflict) {
  // 덮어쓰기 확인 후 force=true로 재호출
  await api.saveLabel("/nas03/.../frame_001.jpg", true);
}
```

---

## 5. 빌드 및 개발 서버 실행

### 사전 요구사항

- Node.js 18 이상
- npm 또는 yarn

### 의존성 설치

```bash
cd /home1/sota/SAM3_based_Auto_Labeling_Tool/web_app/frontend
npm install
```

### 개발 서버 실행

```bash
npm run dev
```

기본적으로 `http://localhost:5173`에서 실행됩니다.

#### API 프록시 설정

Vite 개발 서버에서 백엔드(`:8000`)로 API 요청을 프록시하려면 `vite.config.ts`에 다음 설정을 추가합니다:

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
```

### 프로덕션 빌드

```bash
npm run build
```

`dist/` 디렉토리에 정적 파일이 생성됩니다.

#### FastAPI에서 정적 파일 서빙

```python
from fastapi.staticfiles import StaticFiles
app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")
```

### 타입 검사

```bash
npm run tsc --noEmit   # 타입 에러만 확인 (빌드 없이)
```

### 디렉토리 구조

```
frontend/
├── src/
│   ├── App.tsx
│   ├── api/
│   │   └── client.ts
│   └── components/
│       ├── LabelCanvas.tsx
│       ├── Sidebar.tsx
│       ├── ImageNavigator.tsx
│       ├── ClassSelector.tsx
│       ├── ModeToggle.tsx
│       ├── GuidePanel.tsx
│       ├── ImageStrip.tsx    (deprecated)
│       └── Uploader.tsx      (deprecated)
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```
