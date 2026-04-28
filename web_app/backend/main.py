import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import export
from routers.guide import router as guide_router
from routers.project import router as project_router
from routers.sam_label import router as sam_label_router
from routers.train import router as train_router
from services.sam3_service import SAM3Service
from services.yolo_service import YoloService

app = FastAPI(title="SAM3 Auto Labeling")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 내부망 데모: 모든 origin 허용
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(project_router, prefix="/api")
app.include_router(sam_label_router, prefix="/api")
app.include_router(export.router, prefix="/api")
app.include_router(train_router, prefix="/api")
app.include_router(guide_router, prefix="/api")


@app.on_event("startup")
async def startup() -> None:
    _load_env()

    sam_checkpoint = os.environ.get(
        "SAM3_CHECKPOINT",
        str(Path(__file__).parent.parent.parent / "checkpoints" / "sam2.1_hiera_small.pt"),
    )
    sam_cfg = os.environ.get("SAM3_CONFIG", "sam2.1_hiera_s.yaml")

    if Path(sam_checkpoint).exists():
        SAM3Service.get().load(sam_checkpoint, sam_cfg)
    else:
        print(f"[WARN] SAM3 checkpoint not found: {sam_checkpoint}")

    YoloService.get()  # SLURM 상태 복구


def _load_env() -> None:
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())
