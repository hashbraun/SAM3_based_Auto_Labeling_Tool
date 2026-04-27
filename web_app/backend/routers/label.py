import threading
import traceback
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import state
from services.sam_service import SAMService
from services.dino_service import DINOService
from services.export_service import mask_to_polygons

router = APIRouter()


class LabelRequest(BaseModel):
    text_prompt: str = "person . dog"
    box_threshold: float = 0.35
    text_threshold: float = 0.25


def _build_class_map(text_prompt: str) -> dict[str, int]:
    classes = [c.strip() for c in text_prompt.split(".") if c.strip()]
    return {cls: idx for idx, cls in enumerate(classes)}


def _run_label(image_id: str, req: LabelRequest) -> dict:
    img = state.images.get(image_id)
    if img is None:
        raise HTTPException(status_code=404, detail="Image not found")

    # Lazy load pixel data if not yet in memory
    if img.image_rgb is None:
        import cv2
        loaded = cv2.imread(img.image_path)
        if loaded is None:
            raise HTTPException(status_code=500, detail="Failed to read image file")
        img.image_rgb = cv2.cvtColor(loaded, cv2.COLOR_BGR2RGB)

    dino = DINOService.get()
    sam = SAMService.get()

    detections = dino.detect(img.image_path, req.text_prompt, req.box_threshold, req.text_threshold)
    if not detections:
        img.status = "labeled"
        img.detections = []
        img.seg_results = []
        return {"detections": []}

    sam.set_image(image_id, img.image_rgb)
    h, w = img.image_rgb.shape[:2]

    seg_results = []
    for det in detections:
        x1, y1, x2, y2 = det["bbox"]
        box = np.array([[x1, y1, x2, y2]])
        masks, scores, logits = sam.predict_box(box)
        best = int(np.argmax(scores))
        seg_results.append({
            "class": det["class"],
            "mask": masks[best],
            "mask_logits": logits[best][np.newaxis],  # (1, 256, 256)
        })

    img.detections = detections
    img.seg_results = seg_results
    img.class_map = _build_class_map(req.text_prompt)
    img.corrections = {}
    img.status = "labeled"

    response_detections = []
    for idx, (det, seg) in enumerate(zip(detections, seg_results)):
        polygons = mask_to_polygons(seg["mask"], w, h)
        response_detections.append({
            "det_idx": idx,
            "class_name": det["class"],
            "bbox": det["bbox"],
            "polygons": polygons,
        })

    return {"detections": response_detections}


def _run_batch(req: LabelRequest) -> None:
    pending = [iid for iid in state.image_order
               if state.images.get(iid) and state.images[iid].status == "pending"]
    state.batch_job.total = len(pending)
    state.batch_job.done = 0
    state.batch_job.failed = 0
    for iid in pending:
        img = state.images.get(iid)
        if img:
            state.batch_job.current_filename = img.filename
        try:
            _run_label(iid, req)
            state.batch_job.done += 1
        except Exception:
            traceback.print_exc()
            state.batch_job.failed += 1
    state.batch_job.running = False
    state.batch_job.current_filename = ""


@router.post("/label/batch")
def start_batch(req: LabelRequest):
    if state.batch_job.running:
        raise HTTPException(status_code=409, detail="Batch job already running")
    state.batch_job.running = True
    state.batch_job.total = 0
    state.batch_job.done = 0
    state.batch_job.failed = 0
    state.batch_job.current_filename = ""
    threading.Thread(target=_run_batch, args=(req,), daemon=True).start()
    return {"ok": True}


@router.get("/label/batch")
def get_batch_status():
    job = state.batch_job
    return {
        "running": job.running,
        "total": job.total,
        "done": job.done,
        "failed": job.failed,
        "current": job.current_filename,
    }


@router.post("/label/{image_id}")
def label_image(image_id: str, req: LabelRequest):
    try:
        return _run_label(image_id, req)
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/label/{image_id}/{det_idx}")
def delete_detection(image_id: str, det_idx: int):
    import cv2
    img = state.images.get(image_id)
    if img is None:
        raise HTTPException(status_code=404, detail="Image not found")
    if det_idx >= len(img.seg_results):
        raise HTTPException(status_code=400, detail="det_idx out of range")

    img.detections.pop(det_idx)
    img.seg_results.pop(det_idx)
    img.corrections.pop(det_idx, None)

    # det_idx 재정렬: 삭제된 인덱스보다 큰 키를 -1씩 당김
    updated_corrections = {}
    for k, v in img.corrections.items():
        if k > det_idx:
            updated_corrections[k - 1] = v
        else:
            updated_corrections[k] = v
    img.corrections = updated_corrections

    if img.image_rgb is None:
        loaded = cv2.imread(img.image_path)
        if loaded is None:
            raise HTTPException(status_code=500, detail="Failed to read image file")
        img.image_rgb = cv2.cvtColor(loaded, cv2.COLOR_BGR2RGB)

    h, w = img.image_rgb.shape[:2]
    detections = []
    for idx, (det, seg) in enumerate(zip(img.detections, img.seg_results)):
        corr = img.corrections.get(idx)
        mask = corr.mask if (corr and corr.mask is not None) else seg["mask"]
        polygons = mask_to_polygons(mask, w, h)
        detections.append({
            "det_idx": idx,
            "class_name": det["class"],
            "bbox": det["bbox"],
            "polygons": polygons,
        })

    return {"detections": detections}


@router.get("/label/{image_id}")
def get_label(image_id: str):
    """Return current polygons for an already-labeled image."""
    img = state.images.get(image_id)
    if img is None:
        raise HTTPException(status_code=404, detail="Image not found")
    if img.status == "pending":
        raise HTTPException(status_code=400, detail="Image not labeled yet")

    h, w = img.image_rgb.shape[:2]
    detections = []
    for idx, (det, seg) in enumerate(zip(img.detections, img.seg_results)):
        corr = img.corrections.get(idx)
        mask = corr.mask if (corr and corr.mask is not None) else seg["mask"]
        polygons = mask_to_polygons(mask, w, h)
        detections.append({
            "det_idx": idx,
            "class_name": det["class"],
            "bbox": det["bbox"],
            "polygons": polygons,
        })

    return {"detections": detections}
