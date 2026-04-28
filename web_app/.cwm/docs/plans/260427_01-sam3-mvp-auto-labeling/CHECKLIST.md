# CHECKLIST: SAM3 MVP 오토 라벨링 웹 툴

상태: 🟡 진행 중

---

## Phase 1: 백엔드 기반 재구성 ✅ 완료

### 1-1. SAM 3 서비스 구현
- [x] `segment-anything-2` 패키지 설치 (`uv pip install git+https://github.com/facebookresearch/sam2.git`)
- [x] SAM 3 체크포인트 다운로드 (`checkpoints/sam2.1_hiera_small.pt`, 176MB)
- [x] `services/sam3_service.py` 작성 (SAM2ImagePredictor 싱글턴)
- [x] 클릭 좌표(positive point) → mask 반환 구현
- [x] 다중 클릭 누적 (prev_logits 활용) 구현
- [x] **box + point 혼합 predict 지원** (`predict(box=...)`) — YOLO bbox → SAM3 연결

### 1-2. GroundingDINO 제거
- [x] `main.py` 에서 DINOService startup 제거
- [x] `services/dino_service.py` 삭제 (완료)

### 1-3. 폴더 브라우저 API
- [x] `routers/project.py` 생성
- [x] `GET /api/project/folders` 구현
- [x] `GET /api/project/images` 구현
- [x] `GET /api/project/image` 이미지 서빙 구현
- [x] `.env` 에 `BASE_PROJECT_DIR`, `SAM3_CHECKPOINT`, `SAM3_CONFIG` 설정

### 1-4. State 재설계
- [x] `state.py` `FrameState` / `ClickState` 재설계
- [x] `ClickState.initial_box` 추가 (YOLO bbox → SAM3 box prompt 연결)
- [x] `main.py` startup 이벤트 정리

### 1-5. SAM3 라벨링 API (Phase 2에서 분리됨)
- [x] `routers/sam_label.py` 생성
- [x] `POST /api/sam/click` 구현
- [x] `POST /api/sam/accept-box` 구현 (YOLO bbox → SAM3 초기 mask → 클릭 보정 가능)
- [x] `DELETE /api/sam/object` 구현
- [x] `GET /api/sam/objects` 구현

### 1-6. export.py 재구성
- [x] NAS labels/ 폴더 직접 저장 구현
- [x] 충돌 감지 (409 + force 옵션)

**Phase 1 완료 기준**: ✅ 지정 폴더에서 이미지 로드 + SAM3 클릭/박스 → mask 반환 동작 확인

---

## Phase 2: 프론트엔드 재구성 ✅ 완료

### 2-1. 클래스 선택 컴포넌트
- [x] `frontend/src/components/ClassSelector.tsx` 생성
- [x] 고정 클래스 4종 (사람/강아지/로봇/휠체어) UI
- [x] 선택된 클래스 강조 표시

### 2-2. 모드 선택 컴포넌트
- [x] `frontend/src/components/ModeToggle.tsx` 생성
- [x] SAM 3 모드 / YOLO guide 모드 토글 (YOLO guide는 Phase 3 비활성)

### 2-3. 이미지 네비게이션
- [x] `frontend/src/components/ImageNavigator.tsx` 생성
- [x] 이전/다음 프레임 이동 버튼
- [x] 현재 이미지 저장 여부 표시
- [x] 폴더 내 진행률 표시 (n/total)
- [x] 미저장 이동 시 경고 모달

### 2-4. 캔버스 리팩토링
- [x] `LabelCanvas.tsx` SAM 3 클릭 기반으로 리팩토링
- [x] 여러 객체 순차 라벨링 (클래스별 색상 구분)
- [x] 객체별 polygon 오버레이
- [x] 객체 선택/삭제 UI

### 2-5. API 클라이언트 재작성
- [x] `frontend/src/api/client.ts` SAM3 API 전용으로 재작성
- [x] 폴더 브라우저 UI (App.tsx)
- [x] Sidebar 재작성 (객체 목록 + 저장 버튼)

**Phase 2 완료 기준**: ✅ 클래스 선택 후 클릭 → SAM 3 polygon + 이미지 네비게이션 동작

---

## Phase 3: YOLO Guide Labeling ✅ 완료

### 3-1. YOLO 학습 서비스
- [x] `services/yolo_service.py` 생성
- [x] sbatch 방식 YOLO Seg 학습 제출 구현
- [x] squeue + 로그 파싱으로 학습 상태 추적 (epoch, metrics)
- [x] `scripts/train_yolo.py` 학습 스크립트 생성
- [x] `scripts/train.sbatch` SLURM 배치 스크립트 생성
- [x] `scripts/prepare_dataset.py` 심볼릭링크 데이터셋 구성

### 3-2. 학습 API
- [x] `routers/train.py` 생성
- [x] `POST /api/train/start` 구현
- [x] `GET /api/train/status` 구현
- [x] `GET /api/train/models` 구현
- [x] `POST /api/train/stop` 구현
- [x] `POST /api/train/prepare-dataset` 구현

### 3-3. YOLO Guide 추론 API
- [x] `routers/guide.py` 생성
- [x] `POST /api/guide/infer` 구현 (confidence threshold 필터링)
- [x] `POST /api/guide/accept` 구현 (polygon → FrameState 저장)

### 3-4. Guide Label UI
- [x] `frontend/src/components/GuidePanel.tsx` 생성
- [x] 모델 선택 드롭다운 (mAP50 표시)
- [x] confidence threshold 슬라이더
- [x] "Guide 실행" 버튼 + 결과 목록
- [x] 객체별 accept/reject 체크박스
- [x] 학습 시작/중지 + epoch 진행바 UI
- [x] YOLO Guide 모드 활성화 (ModeToggle)

### 변경사항 (Phase 3 추가 설계)
- class 0=사람, class 1=강아지 (로봇/휠체어 데이터 수집 후 추가)
- 학습: sbatch gpu-106, 모델 저장 /nas03/models/yolo_seg/
- 데이터셋: /nas03/1_EV_LABELING → 심볼릭링크 → datasets/ev_labeling/
- ⚠️ ultralytics 미설치: `pip install ultralytics` 필요

**Phase 3 완료 기준**: ✅ 학습 실행 + guide label 생성 + accept/reject 동작

---

## Phase 4: 저장 정책 및 다중 사용자 ✅ 완료

### 4-1. NAS 경로 저장
- [x] `routers/export.py` 구현 (Phase 1에서 완료)
- [x] `POST /api/save` NAS labels/ 폴더 저장 구현
- [x] 기존 파일 존재 시 conflict 응답 + force 옵션 처리

### 4-2. 다중 사용자 충돌 처리
- [x] 파일 mtime 기반 충돌 감지 (`export.py:49-56`)
- [x] 충돌 경고 UI — `window.confirm` + 덮어쓰기 (`App.tsx:188-199`)

### 4-3. 저장 상태 표시
- [x] 저장됨 / 미저장 / 저장 중 상태 표시 (`Sidebar.tsx:135-151`)

**Phase 4 완료 기준**: ✅ NAS 저장 + 충돌 경고 동작

---

## Phase 5: 통합 검증 ✅ 완료

### MVP 완료 기준 (정의서 §7)
- [x] 웹에서 특정 프로젝트 폴더의 이미지 프레임을 불러올 수 있다
- [x] 수기 라벨 데이터셋으로 YOLO Seg 학습 수행 및 모델 저장 가능 (epoch 28, mAP50=0.9317)
- [x] SAM 3 또는 YOLO guide로 segmentation 결과 생성 가능
- [x] 생성 결과가 화면에서 시각적으로 확인된다
- [x] 결과를 YOLO Seg 1.0 포맷으로 저장 및 지정 경로 생성 (labels/stem.txt)
- [ ] 최소 2인 이상 접속 내부 데모 수행 가능 (CORS=* 설정 완료, 실제 2인 데모 미진행)

### 추가 검증
- [x] 구현되면 좋음 항목 체크 (모델 선택/threshold, 방향키 네비, F키 새 객체)
- [x] CORS 설정 확인 (allow_origins=["*"], 내부망 전체 허용)
- [ ] 백엔드/프론트엔드 실행 방법 문서 정리

### 버그 수정 (Phase 5 중 발견)
- [x] mAP50 컬럼 인덱스 버그 수정 (vals[6]→header 파싱, train/sem_loss→metrics/mAP50(B))
- [x] saved 상태 디스크 체크 추가 (서버 재시작 후에도 정확한 저장 상태 표시)
