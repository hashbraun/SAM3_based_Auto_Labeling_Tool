import uuid
import shutil
from pathlib import Path

import cv2
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

import state

router = APIRouter()

UPLOAD_DIR = Path("uploads")
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


@router.post("/upload")
async def upload_images(files: list[UploadFile] = File(...)):
    results = []
    for file in files:
        suffix = Path(file.filename).suffix.lower()
        if suffix not in ALLOWED_EXTENSIONS:
            continue

        image_id = str(uuid.uuid4())
        dest = UPLOAD_DIR / f"{image_id}{suffix}"
        with dest.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        # 원본 파일명 보존
        (UPLOAD_DIR / f"{image_id}.json").write_text(
            __import__("json").dumps({"original_filename": file.filename})
        )

        image_rgb = cv2.cvtColor(cv2.imread(str(dest)), cv2.COLOR_BGR2RGB)

        img_state = state.ImageState(
            image_id=image_id,
            filename=file.filename,
            image_path=str(dest),
            image_rgb=image_rgb,
        )
        state.images[image_id] = img_state
        state.image_order.append(image_id)
        results.append({"id": image_id, "filename": file.filename, "status": "pending"})

    return results


@router.get("/images")
def list_images():
    return [
        {
            "id": iid,
            "filename": state.images[iid].filename,
            "status": state.images[iid].status,
        }
        for iid in state.image_order
        if iid in state.images
    ]


@router.get("/images/{image_id}/file")
def get_image_file(image_id: str):
    img = state.images.get(image_id)
    if img is None:
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(img.image_path)


@router.delete("/images/{image_id}")
def delete_image(image_id: str):
    if image_id not in state.images:
        raise HTTPException(status_code=404, detail="Image not found")
    img = state.images.pop(image_id)
    if image_id in state.image_order:
        state.image_order.remove(image_id)
    Path(img.image_path).unlink(missing_ok=True)
    return {"ok": True}
