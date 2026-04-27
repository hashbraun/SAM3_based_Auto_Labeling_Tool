# CONTEXT: SAM3 MVP 오토 라벨링 웹 툴

## 프로젝트 배경

- 2026.03 MVP 범위 정의서 기준 인턴 과제
- 기존 `web_app/`(GroundingDINO + SAM v1)을 SAM 3 + YOLO Guide 기반으로 재구성
- 대상 클래스: 사람, 강아지, 로봇, 휠체어 (고정)
- 타깃: 내부 데모 수준, 여러 명 동시 접속

## 핵심 결정 사항

### SAM 3 선택 이유
- MVP 정의서에 "SAM 3 클릭 기반 segmentation"으로 명시
- `segment-anything-2` 패키지: `SAM2ImagePredictor` 사용
- 현재 `sam_vit_b_01ec64.pth`는 SAM v1 — 새 체크포인트 필요 (sam2_hiera_tiny 또는 sam2_hiera_base_plus)

### GroundingDINO 제거
- MVP 워크플로우에서 텍스트 프롬프트 방식 제외
- 사용자가 클래스를 직접 선택하고 SAM 3로 클릭 → mask 생성

### YOLO Guide 방식
- ultralytics YOLO Segmentation 모델을 수기 라벨로 학습
- 학습 후 새 프레임에 대해 추론 → guide label 제공
- 사용자가 accept/reject로 최종 라벨 결정

### 폴더 브라우저 방식
- 기존: 드래그&드롭 업로드 → uploads/ 저장
- MVP: NAS의 특정 프로젝트 폴더를 직접 탐색
- 이미지 원본을 복사하지 않고 서빙 (StaticFiles mount)

### 저장 위치
- `{project_folder}/labels/{image_stem}.txt` — YOLO 1.0 포맷
- `{model_folder}/weights/` — YOLO 학습 결과

## 재사용 파일 목록

| 파일 | 재사용 여부 | 비고 |
|------|------------|------|
| `services/export_service.py` | ✅ 유지 | YOLO 1.0 포맷 export 로직 |
| `services/sam_service.py` | ❌ 교체 | SAM v1 → SAM 3 |
| `services/dino_service.py` | ❌ 삭제 | GroundingDINO 제거 |
| `routers/correct.py` | 🔄 이식 | SAM 3 다중 클릭 누적 로직으로 통합 |
| `routers/label.py` | ❌ 교체 | SAM 3 기반으로 재작성 |
| `routers/export.py` | 🔄 수정 | NAS 경로 저장으로 수정 |
| `routers/images.py` | ❌ 교체 | 폴더 브라우저 API로 교체 |
| `state.py` | 🔄 재설계 | 프로젝트 폴더 기반 state |
| `main.py` | 🔄 수정 | SAM 3 startup, DINO 제거 |
| `frontend/src/components/LabelCanvas.tsx` | 🔄 수정 | SAM 3 클릭 기반으로 단순화 |
| `frontend/src/components/Sidebar.tsx` | 🔄 수정 | 클래스 선택 + 모드 전환으로 교체 |
| `frontend/src/components/Uploader.tsx` | ❌ 교체 | 폴더 브라우저로 교체 |

## 환경 제약

- conda 환경에서 실행 (uv run 대신 직접 실행)
- `segment-anything-2`: pip install sam2 (Facebook Research)
- SAM 3 체크포인트: 별도 다운로드 필요
- ultralytics: pip install ultralytics
- 백엔드 포트: 8000 / 프론트엔드 포트: 5173

## 주의 사항

- SAM 3는 GPU 권장 (CPU도 동작하나 느림)
- YOLO 학습은 백그라운드 스레드로 실행 (FastAPI 블로킹 방지)
- 동일 이미지 동시 편집 충돌: 파일 수정 시각 기반 선저장 우선 처리
- NAS 경로 접근 권한: .env에서 BASE_PROJECT_DIR 설정으로 제한
