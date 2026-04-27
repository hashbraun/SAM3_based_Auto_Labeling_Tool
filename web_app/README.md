# SAM Interactive Labeling Web App

## 실행 방법

### 백엔드
```bash
cd web_app/backend
cp .env.example .env  # 필요시 경로 수정
uv sync
uv run uvicorn main:app --reload --port 8000
```

### 프론트엔드
```bash
cd web_app/frontend
npm install
npm run dev  # http://localhost:5173
```

## 사용 방법

1. 이미지 드래그&드롭 업로드
2. 텍스트 프롬프트 입력 (예: `person . dog . car`)
3. **오토 라벨링 실행** 클릭
4. 좌측 객체 목록에서 수정할 객체 선택
5. 캔버스에서 클릭으로 마스크 보정
   - **좌클릭**: 포함 포인트 (+)
   - **우클릭**: 제외 포인트 (−)
6. **저장** → YOLO .txt 파일 생성
7. **전체 ZIP 다운로드** → images/ + labels/ + classes.txt
