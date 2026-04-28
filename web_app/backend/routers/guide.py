from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import state
from state import ClickState, FrameState
from services.yolo_service import YoloService

router = APIRouter()

_BATCH_IOU_THRESH = 0.7


@dataclass
class BatchInferStatus:
    running: bool = False
    progress: int = 0
    total: int = 0
    current_image: str = ""
    accepted: int = 0
    skipped: int = 0
    error: str = ""


_batch_status = BatchInferStatus()
_batch_lock = threading.Lock()


# ── 헬퍼 ──────────────────────────────────────────────────────────────────────

def _polygon_bbox(polygon: list[float]) -> list[float]:
    xs = polygon[0::2]
    ys = polygon[1::2]
    return [min(xs), min(ys), max(xs), max(ys)]


def _mask_bbox(mask: np.ndarray) -> list[float]:
    h, w = mask.shape
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return [0.0, 0.0, 1.0, 1.0]
    return [xs.min() / w, ys.min() / h, xs.max() / w, ys.max() / h]


def _iou(a: list[float], b: list[float]) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    union = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter
    return inter / union if union > 0 else 0.0


def _is_duplicate(frame: FrameState, class_name: str, bbox: list[float]) -> bool:
    for obj in frame.objects.values():
        if obj.class_name != class_name:
            continue
        if obj.polygon:
            obj_bbox = _polygon_bbox(obj.polygon)
        elif obj.mask is not None:
            obj_bbox = _mask_bbox(obj.mask)
        else:
            continue
        if _iou(bbox, obj_bbox) >= _BATCH_IOU_THRESH:
            return True
    return False


def _run_batch_infer(folder: str, model_path: str, conf: float) -> None:
    global _batch_status

    images = sorted(
        p for ext in ("*.jpg", "*.jpeg", "*.png")
        for p in Path(folder).glob(ext)
    )

    with _batch_lock:
        _batch_status.total = len(images)
        _batch_status.progress = 0
        _batch_status.accepted = 0
        _batch_status.skipped = 0
        _batch_status.error = ""

    yolo = YoloService.get()

    try:
        for i, img_path in enumerate(images):
            img_str = str(img_path)
            with _batch_lock:
                _batch_status.current_image = img_path.name
                _batch_status.progress = i

            img = cv2.imread(img_str)
            if img is None:
                continue
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            del img

            try:
                detections = yolo.infer(img_rgb, model_path, conf)
            except Exception:
                continue
            finally:
                del img_rgb

            if img_str not in state.frames:
                state.frames[img_str] = FrameState(image_path=img_str)
            frame = state.frames[img_str]

            for det in detections:
                if det["class_name"] not in state.CLASSES:
                    continue
                if _is_duplicate(frame, det["class_name"], det["bbox"]):
                    with _batch_lock:
                        _batch_status.skipped += 1
                    continue
                obj_id = frame.next_obj_id
                frame.next_obj_id += 1
                frame.objects[obj_id] = ClickState(
                    class_name=det["class_name"],
                    polygon=det["polygon"],
                )
                frame.saved = False
                with _batch_lock:
                    _batch_status.accepted += 1

    except Exception as e:
        with _batch_lock:
            _batch_status.error = str(e)
    finally:
        with _batch_lock:
            _batch_status.progress = len(images)
            _batch_status.running = False
            _batch_status.current_image = ""


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

class InferRequest(BaseModel):
    image_path: str
    model_path: str
    conf: float = 0.3


class InferAllRequest(BaseModel):
    folder: str
    model_path: str
    conf: float = 0.3


class AcceptedObject(BaseModel):
    class_name: str
    polygon: list[float]


class AcceptGuideRequest(BaseModel):
    image_path: str
    objects: list[AcceptedObject]


@router.post("/guide/infer")
def guide_infer(req: InferRequest):
    img = cv2.imread(req.image_path)
    if img is None:
        raise HTTPException(status_code=404, detail=f"이미지 없음: {req.image_path}")
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    try:
        objects = YoloService.get().infer(img_rgb, req.model_path, req.conf)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"objects": objects}


@router.post("/guide/infer-all")
def guide_infer_all(req: InferAllRequest):
    global _batch_status
    if not Path(req.folder).is_dir():
        raise HTTPException(status_code=404, detail=f"폴더 없음: {req.folder}")
    with _batch_lock:
        if _batch_status.running:
            raise HTTPException(status_code=409, detail="이미 실행 중입니다.")
        _batch_status.running = True

    threading.Thread(
        target=_run_batch_infer,
        args=(req.folder, req.model_path, req.conf),
        daemon=True,
    ).start()

    return {"ok": True}


@router.get("/guide/infer-all/status")
def guide_infer_all_status():
    with _batch_lock:
        return {
            "running": _batch_status.running,
            "progress": _batch_status.progress,
            "total": _batch_status.total,
            "current_image": _batch_status.current_image,
            "accepted": _batch_status.accepted,
            "skipped": _batch_status.skipped,
            "error": _batch_status.error,
        }


@router.post("/guide/accept")
def guide_accept(req: AcceptGuideRequest):
    if req.image_path not in state.frames:
        state.frames[req.image_path] = FrameState(image_path=req.image_path)
    frame = state.frames[req.image_path]

    added = []
    for obj_req in req.objects:
        if obj_req.class_name not in state.CLASSES:
            continue
        obj_id = frame.next_obj_id
        frame.next_obj_id += 1
        frame.objects[obj_id] = ClickState(
            class_name=obj_req.class_name,
            polygon=obj_req.polygon,
        )
        added.append({"obj_id": obj_id, "class_name": obj_req.class_name})

    frame.saved = False
    return {"ok": True, "added": added}
