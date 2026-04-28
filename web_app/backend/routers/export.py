from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import state
from state import CLASS_INDEX
from services.export_service import mask_to_polygons

router = APIRouter()


def _build_yolo_lines(frame: state.FrameState) -> list[str]:
    if frame.image_rgb is None:
        return []
    h, w = frame.image_rgb.shape[:2]
    lines: list[str] = []
    for obj in frame.objects.values():
        class_id = CLASS_INDEX.get(obj.class_name)
        if class_id is None:
            continue
        if obj.mask is not None:
            for poly in mask_to_polygons(obj.mask, w, h):
                if poly:
                    lines.append(f"{class_id} " + " ".join(map(str, poly)))
        elif obj.polygon:
            lines.append(f"{class_id} " + " ".join(map(str, obj.polygon)))
    return lines


class SaveRequest(BaseModel):
    image_path: str
    force: bool = False


@router.post("/save")
def save_label(body: SaveRequest):
    frame = state.frames.get(body.image_path)
    if frame is None or frame.image_rgb is None:
        raise HTTPException(status_code=404, detail="Frame not loaded")

    image_path = Path(body.image_path)
    label_dir = image_path.parent / "labels"
    label_dir.mkdir(parents=True, exist_ok=True)
    label_file = label_dir / f"{image_path.stem}.txt"

    if label_file.exists() and not body.force:
        import time
        mtime = label_file.stat().st_mtime
        return {
            "conflict": True,
            "existing_mtime": mtime,
            "message": "다른 사용자가 이미 저장했습니다. 덮어쓰시겠습니까?",
        }

    lines = _build_yolo_lines(frame)
    label_file.write_text("\n".join(lines))
    frame.saved = True

    return {"ok": True, "label_path": str(label_file), "object_count": len(lines)}


@router.post("/save/all")
def save_all_labels(force: bool = False):
    saved, skipped, errors = [], [], []
    for img_path, frame in state.frames.items():
        if not frame.objects:
            continue
        lines = _build_yolo_lines(frame)
        if not lines:
            continue
        label_dir = Path(img_path).parent / "labels"
        label_dir.mkdir(parents=True, exist_ok=True)
        label_file = label_dir / f"{Path(img_path).stem}.txt"
        if label_file.exists() and not force:
            skipped.append(img_path)
            continue
        try:
            label_file.write_text("\n".join(lines))
            frame.saved = True
            saved.append(img_path)
        except Exception as e:
            errors.append({"path": img_path, "error": str(e)})
    return {"saved": len(saved), "skipped": len(skipped), "errors": errors}


@router.get("/save/status")
def save_status(image_path: str = Query(...)):
    frame = state.frames.get(image_path)
    saved = frame.saved if frame else False
    label_path = Path(image_path)
    label_file = label_path.parent / "labels" / f"{label_path.stem}.txt"
    return {"saved": saved, "label_exists": label_file.exists()}
