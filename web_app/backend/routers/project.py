from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel

import state

router = APIRouter()

ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
BASE_PROJECT_DIR = os.environ.get("BASE_PROJECT_DIR", "/")
UPLOAD_DIR = Path(os.environ.get(
    "UPLOAD_DIR",
    str(Path(__file__).parent.parent.parent.parent / "uploads")
))


def _safe_path(path: str) -> Path:
    resolved = Path(path).resolve()
    base = Path(BASE_PROJECT_DIR).resolve()
    upload = UPLOAD_DIR.resolve()
    if not (str(resolved).startswith(str(base)) or str(resolved).startswith(str(upload))):
        raise HTTPException(status_code=403, detail="Access denied: path outside allowed directories")
    return resolved


@router.get("/project/folders")
def list_folders(root: str = Query(..., description="폴더 경로")):
    p = _safe_path(root)
    if not p.exists() or not p.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")
    folders = sorted(
        [str(d) for d in p.iterdir() if d.is_dir() and not d.name.startswith(".")],
        key=lambda x: x.lower(),
    )
    return {"path": str(p), "folders": folders}


@router.get("/project/images")
def list_images(folder: str = Query(..., description="이미지 폴더 경로")):
    p = _safe_path(folder)
    if not p.exists() or not p.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    images = sorted(
        [str(f) for f in p.iterdir() if f.suffix.lower() in ALLOWED_IMAGE_EXTS],
        key=lambda x: x.lower(),
    )

    # 세션 업데이트
    state.current_project_folder = str(p)
    state.image_list = images
    # 새 폴더 로드 시 기존 FrameState 중 이 폴더에 없는 것은 유지 (다른 세션 보존)

    def _is_saved(img: str) -> bool:
        frame = state.frames.get(img)
        if frame and frame.saved:
            return True
        lf = Path(img).parent / "labels" / f"{Path(img).stem}.txt"
        return lf.exists()

    return {
        "folder": str(p),
        "images": [
            {
                "path": img,
                "filename": Path(img).name,
                "saved": _is_saved(img),
            }
            for img in images
        ],
        "total": len(images),
    }


@router.get("/project/image")
def serve_image(path: str = Query(..., description="이미지 절대 경로")):
    p = _safe_path(path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    if p.suffix.lower() not in ALLOWED_IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="Not an image file")
    return FileResponse(str(p))


@router.post("/project/upload")
async def upload_images(
    folder_name: str = Query(..., description="절대 경로 또는 uploads/ 하위 폴더명"),
    files: list[UploadFile] = File(...),
):
    raw = folder_name.strip()
    target = _safe_path(raw if raw.startswith("/") else str(UPLOAD_DIR / raw))
    target.mkdir(parents=True, exist_ok=True)

    saved = []
    for f in files:
        if Path(f.filename).suffix.lower() not in ALLOWED_IMAGE_EXTS:
            continue
        dest = target / Path(f.filename).name
        dest.write_bytes(await f.read())
        saved.append(f.filename)

    return {"folder": str(target), "uploaded": len(saved), "files": saved}


class SetFolderRequest(BaseModel):
    folder: str


@router.post("/project/select")
def select_project(body: SetFolderRequest):
    p = _safe_path(body.folder)
    if not p.exists() or not p.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")
    state.current_project_folder = str(p)
    state.image_list = sorted(
        [str(f) for f in p.iterdir() if f.suffix.lower() in ALLOWED_IMAGE_EXTS],
        key=lambda x: x.lower(),
    )
    return {"folder": str(p), "total": len(state.image_list)}
