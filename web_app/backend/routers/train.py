from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.yolo_service import YoloService

router = APIRouter()


class TrainRequest(BaseModel):
    epochs: int = 50
    imgsz: int = 1280
    batch: int = 4
    model: str = ""


@router.post("/train/start")
def start_training(req: TrainRequest):
    try:
        job_id = YoloService.get().submit_training(
            epochs=req.epochs,
            imgsz=req.imgsz,
            batch=req.batch,
            model=req.model,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"ok": True, "job_id": job_id}


@router.get("/train/status")
def get_status():
    return YoloService.get().get_status()


@router.post("/train/stop")
def stop_training():
    YoloService.get().stop_training()
    return {"ok": True}


@router.post("/train/prepare-dataset")
def prepare_dataset():
    try:
        data_yaml = YoloService.get().prepare_dataset()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True, "data_yaml": str(data_yaml)}


@router.get("/train/models")
def list_models():
    return {"models": YoloService.get().list_models()}
