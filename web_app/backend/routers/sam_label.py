from __future__ import annotations

import cv2
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import state
from state import ClickState, FrameState
from services.sam3_service import SAM3Service
from services.export_service import mask_to_polygons

router = APIRouter()


def _get_or_load_frame(image_path: str) -> FrameState:
    if image_path not in state.frames:
        state.frames[image_path] = FrameState(image_path=image_path)
    frame = state.frames[image_path]
    if frame.image_rgb is None:
        loaded = cv2.imread(image_path)
        if loaded is None:
            raise HTTPException(status_code=500, detail=f"Cannot read image: {image_path}")
        frame.image_rgb = cv2.cvtColor(loaded, cv2.COLOR_BGR2RGB)
    return frame


def _run_sam(sam: SAM3Service, obj: ClickState) -> tuple:
    """ClickState의 box + coords + prev_logits 를 조합해 SAM3 예측 실행."""
    return sam.predict(
        coords=obj.coords,
        labels=obj.labels,
        prev_logits=obj.prev_logits,
        box=obj.initial_box,
    )


class ClickRequest(BaseModel):
    image_path: str
    x: int
    y: int
    label: int = 1      # 1=positive, 0=negative
    class_name: str
    obj_id: int = -1    # -1 = 새 객체 생성


class AcceptBoxRequest(BaseModel):
    """YOLO 탐지 결과의 bbox를 SAM3 box prompt로 변환해 초기 mask 생성."""
    image_path: str
    class_name: str
    box: list[int]      # [x1, y1, x2, y2] 픽셀 좌표


class DeleteObjectRequest(BaseModel):
    image_path: str
    obj_id: int


@router.post("/sam/click")
def sam_click(body: ClickRequest):
    if body.class_name not in state.CLASSES:
        raise HTTPException(status_code=400, detail=f"Unknown class: {body.class_name}")

    frame = _get_or_load_frame(body.image_path)
    h, w = frame.image_rgb.shape[:2]

    sam = SAM3Service.get()
    if not sam.is_loaded:
        raise HTTPException(status_code=503, detail="SAM3 model not loaded")

    sam.set_image(body.image_path, frame.image_rgb)

    if body.obj_id == -1 or body.obj_id not in frame.objects:
        obj_id = frame.next_obj_id
        frame.next_obj_id += 1
        frame.objects[obj_id] = ClickState(class_name=body.class_name)
    else:
        obj_id = body.obj_id

    obj = frame.objects[obj_id]
    obj.coords.append([body.x, body.y])
    obj.labels.append(body.label)

    masks, scores, logits = _run_sam(sam, obj)
    best = int(scores.argmax())
    obj.mask = masks[best]
    obj.prev_logits = logits[best][None]

    frame.saved = False
    return {
        "obj_id": obj_id,
        "class_name": obj.class_name,
        "polygons": mask_to_polygons(obj.mask, w, h),
        "click_count": len(obj.coords),
        "from_box": obj.initial_box is not None,
    }


@router.post("/sam/accept-box")
def accept_box(body: AcceptBoxRequest):
    """YOLO bbox를 SAM3 box prompt로 넘겨 초기 mask를 생성한다.
    이후 /sam/click 으로 같은 obj_id에 클릭을 추가해 보정 가능."""
    if body.class_name not in state.CLASSES:
        raise HTTPException(status_code=400, detail=f"Unknown class: {body.class_name}")

    frame = _get_or_load_frame(body.image_path)
    h, w = frame.image_rgb.shape[:2]

    sam = SAM3Service.get()
    if not sam.is_loaded:
        raise HTTPException(status_code=503, detail="SAM3 model not loaded")

    sam.set_image(body.image_path, frame.image_rgb)

    obj_id = frame.next_obj_id
    frame.next_obj_id += 1
    obj = ClickState(class_name=body.class_name, initial_box=body.box)
    frame.objects[obj_id] = obj

    # box만으로 첫 예측 (클릭 없음)
    masks, scores, logits = _run_sam(sam, obj)
    best = int(scores.argmax())
    obj.mask = masks[best]
    obj.prev_logits = logits[best][None]

    frame.saved = False
    return {
        "obj_id": obj_id,
        "class_name": obj.class_name,
        "polygons": mask_to_polygons(obj.mask, w, h),
        "click_count": 0,
        "from_box": True,
    }


@router.delete("/sam/object")
def delete_object(body: DeleteObjectRequest):
    frame = state.frames.get(body.image_path)
    if frame is None:
        raise HTTPException(status_code=404, detail="Frame not found")
    frame.objects.pop(body.obj_id, None)
    frame.saved = False
    return {"ok": True, "obj_id": body.obj_id}


@router.get("/sam/objects")
def get_objects(image_path: str):
    frame = state.frames.get(image_path)
    if frame is None:
        return {"objects": []}

    if frame.image_rgb is None:
        loaded = cv2.imread(image_path)
        if loaded is None:
            return {"objects": []}
        frame.image_rgb = cv2.cvtColor(loaded, cv2.COLOR_BGR2RGB)

    h, w = frame.image_rgb.shape[:2]
    objects = []
    for obj_id, obj in frame.objects.items():
        if obj.mask is None:
            continue
        objects.append({
            "obj_id": obj_id,
            "class_name": obj.class_name,
            "polygons": mask_to_polygons(obj.mask, w, h),
            "click_count": len(obj.coords),
            "from_box": obj.initial_box is not None,
        })

    return {"objects": objects, "saved": frame.saved}


@router.delete("/sam/objects")
def clear_objects(image_path: str):
    frame = state.frames.get(image_path)
    if frame:
        frame.objects.clear()
        frame.next_obj_id = 0
        frame.saved = False
    return {"ok": True}
