import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import state
from state import CorrectionState
from services.sam_service import SAMService
from services.export_service import mask_to_polygons

router = APIRouter()


class PointRequest(BaseModel):
    x: int
    y: int
    label: int  # 1 = positive, 0 = negative


@router.post("/correct/{image_id}/{det_idx}")
def add_point(image_id: str, det_idx: int, body: PointRequest):
    img = state.images.get(image_id)
    if img is None:
        raise HTTPException(status_code=404, detail="Image not found")
    if det_idx >= len(img.seg_results):
        raise HTTPException(status_code=400, detail="det_idx out of range")

    sam = SAMService.get()
    sam.set_image(image_id, img.image_rgb)

    # Get or init correction state for this detection
    if det_idx not in img.corrections:
        # Seed prev_logits from initial bbox prediction logits
        init_logits = img.seg_results[det_idx].get("mask_logits")
        img.corrections[det_idx] = CorrectionState(prev_logits=init_logits)

    corr = img.corrections[det_idx]
    corr.coords.append([body.x, body.y])
    corr.labels.append(body.label)

    masks, scores, logits = sam.predict_points(
        corr.coords,
        corr.labels,
        corr.prev_logits,
    )
    best = int(np.argmax(scores))
    corr.mask = masks[best]
    corr.prev_logits = logits[best][np.newaxis]  # (1, 256, 256)

    h, w = img.image_rgb.shape[:2]
    polygons = mask_to_polygons(corr.mask, w, h)

    return {
        "det_idx": det_idx,
        "polygons": polygons,
        "point_count": len(corr.coords),
    }


@router.delete("/correct/{image_id}/{det_idx}")
def reset_correction(image_id: str, det_idx: int):
    img = state.images.get(image_id)
    if img is None:
        raise HTTPException(status_code=404, detail="Image not found")
    if det_idx >= len(img.seg_results):
        raise HTTPException(status_code=400, detail="det_idx out of range")

    img.corrections.pop(det_idx, None)

    # Return original mask polygons
    h, w = img.image_rgb.shape[:2]
    seg = img.seg_results[det_idx]
    polygons = mask_to_polygons(seg["mask"], w, h)
    return {"det_idx": det_idx, "polygons": polygons, "point_count": 0}
