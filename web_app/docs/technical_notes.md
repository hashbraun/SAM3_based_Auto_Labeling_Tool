# 기술 노트 (Technical Notes)

코드 분석 중 발견한 주요 사항을 기록합니다.

---

## 1. 레거시 파이프라인 (비활성 상태)

- **파일**: `routers/label.py`, `routers/correct.py`, `services/sam_service.py`
- **모델**: SAM1 + Grounding DINO 기반
- **상태**: `main.py`에 라우터 미등록 → 현재 실질적으로 비활성화
- **현재 사용 중**: `routers/sam_label.py` + `services/sam3_service.py` (SAM2 기반, 클릭 누적 세그멘테이션)
- **권고**: 혼란을 방지하기 위해 레거시 파일을 `legacy/` 하위 디렉토리로 이동하거나 삭제 검토 필요

---

## 2. 저장 충돌 감지 로직

- **엔드포인트**: `POST /api/save`
- **동작**: 디스크에 파일이 이미 존재하고 `force=false`이면 `{ conflict: true, mtime: <기존 파일 수정시각> }` 반환
- **프론트엔드 처리**: 응답에 `conflict: true`가 포함되면 `window.confirm()`으로 덮어쓰기 여부를 사용자에게 확인 후 재요청
- **주의**: 다중 사용자 환경에서는 mtime 비교만으로 충돌을 완전히 방지할 수 없음 (현재 단일 사용자 로컬 툴 전제)

---

## 3. Optimistic Update (LabelCanvas)

- **위치**: `frontend/src/components/LabelCanvas.tsx`
- **동작**: 사용자가 클릭한 포인트를 API 응답 대기 없이 즉시 화면에 렌더링
- **롤백**: API 호출 실패 시 마지막 포인트를 자동으로 제거
- **이점**: 클릭 응답성 향상 (SAM 추론 지연 시에도 UI가 즉각 반응)
- **주의**: API 실패가 잦을 경우 포인트 깜빡임 현상이 발생할 수 있음

---

## 4. YOLO Guide 중복 탐지 방지

- **엔드포인트**: `POST /api/guide/infer-all`
- **동작**: 배치 추론 시 기존 객체와 IoU ≥ 0.7인 탐지 결과는 자동 skip
- **목적**: 동일 영역에 대한 중복 라벨 생성 방지

---

*최초 작성: 2026-04-28*
