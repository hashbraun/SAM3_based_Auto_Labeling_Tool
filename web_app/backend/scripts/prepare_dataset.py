"""
EV_LABELING 데이터를 YOLO 표준 구조로 심볼릭링크 생성.

구조:
  {YOLO_DATASET_DIR}/
    images/train/ -> NAS 원본 이미지
    images/val/   -> NAS 원본 이미지
    labels/train/ -> NAS 원본 라벨
    labels/val/   -> NAS 원본 라벨
    data.yaml
"""
from __future__ import annotations

import os
import random
import sys
from pathlib import Path


CLASSES = {0: "person", 1: "dog"}
CAMERAS = ["center", "corner"]


def _collect_sequences(base_dir: Path) -> list[tuple[str, Path]]:
    """(cam_seq_key, seq_path) 목록 반환."""
    seqs = []
    for cam in CAMERAS:
        cam_dir = base_dir / cam
        if not cam_dir.exists():
            continue
        for seq_dir in sorted(cam_dir.iterdir()):
            if seq_dir.is_dir() and not seq_dir.name.startswith("@"):
                seqs.append((f"{cam}/{seq_dir.name}", seq_dir))
    return seqs


def _link(src: Path, dst: Path) -> None:
    if dst.exists() or dst.is_symlink():
        return
    dst.symlink_to(src)


def prepare(
    labeling_base: Path,
    dataset_dir: Path,
    val_ratio: float = 0.2,
    seed: int = 42,
) -> Path:
    seqs = _collect_sequences(labeling_base)
    if not seqs:
        raise RuntimeError(f"시퀀스 없음: {labeling_base}")

    random.seed(seed)
    random.shuffle(seqs)
    split = int(len(seqs) * (1 - val_ratio))
    train_seqs = seqs[:split]
    val_seqs = seqs[split:]

    for split_name, split_seqs in [("train", train_seqs), ("val", val_seqs)]:
        img_out = dataset_dir / "images" / split_name
        lbl_out = dataset_dir / "labels" / split_name
        img_out.mkdir(parents=True, exist_ok=True)
        lbl_out.mkdir(parents=True, exist_ok=True)

        for _, seq_dir in split_seqs:
            lbl_src_dir = seq_dir / "labels" / "train"
            for img in sorted(seq_dir.glob("*.jpg")):
                lbl = lbl_src_dir / (img.stem + ".txt")
                if not lbl.exists():
                    continue
                _link(img, img_out / img.name)
                _link(lbl, lbl_out / lbl.name)

    data_yaml = dataset_dir / "data.yaml"
    names_str = "\n".join(f"  {k}: {v}" for k, v in CLASSES.items())
    data_yaml.write_text(
        f"path: {dataset_dir}\n"
        f"train: images/train\n"
        f"val: images/val\n"
        f"nc: {len(CLASSES)}\n"
        f"names:\n{names_str}\n"
    )

    n_train = sum(1 for _ in (dataset_dir / "images" / "train").iterdir())
    n_val = sum(1 for _ in (dataset_dir / "images" / "val").iterdir())
    print(f"데이터셋 준비 완료: train={n_train}, val={n_val}")
    print(f"data.yaml: {data_yaml}")
    return data_yaml


if __name__ == "__main__":
    base = Path(os.environ.get("LABELING_BASE_DIR", "/nas03/1_EV_LABELING"))
    dst = Path(os.environ.get("YOLO_DATASET_DIR", "/home1/sota/SAM3_based_Auto_Labeling_Tool/datasets/ev_labeling"))
    prepare(base, dst)
