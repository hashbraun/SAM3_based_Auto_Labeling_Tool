"""SLURM에서 실행되는 YOLO 학습 스크립트."""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True)
    p.add_argument("--model", default="yolov8n-seg.pt")
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--imgsz", type=int, default=1280)
    p.add_argument("--batch", type=int, default=8)
    p.add_argument("--weights-dir", required=True)
    p.add_argument("--run-name", default="")
    p.add_argument("--tag", default="")
    p.add_argument("--freeze", type=int, default=0)
    return p.parse_args()


def main() -> None:
    args = parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        print("ERROR: ultralytics가 설치되지 않았습니다. pip install ultralytics")
        sys.exit(1)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    suffix = f"_{args.tag}" if args.tag else ""
    run_name = args.run_name or f"{ts}{suffix}"
    weights_dir = Path(args.weights_dir)
    weights_dir.mkdir(parents=True, exist_ok=True)

    print(f"[YOLO Train] model={args.model}, epochs={args.epochs}, imgsz={args.imgsz}, batch={args.batch}, freeze={args.freeze}")
    print(f"[YOLO Train] data={args.data}")
    print(f"[YOLO Train] output={weights_dir}/{run_name}")

    train_kwargs: dict = dict(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=0,
        project=str(weights_dir),
        name=run_name,
        save_period=10,
        exist_ok=True,
        verbose=True,
    )
    if args.freeze > 0:
        train_kwargs["freeze"] = args.freeze
        train_kwargs["hsv_h"] = 0.015
        train_kwargs["hsv_s"] = 0.7
        train_kwargs["hsv_v"] = 0.4
        train_kwargs["scale"] = 0.5
        train_kwargs["translate"] = 0.1
        train_kwargs["copy_paste"] = 0.3
        train_kwargs["mixup"] = 0.15

    model = YOLO(args.model)
    model.train(**train_kwargs)

    best_pt = weights_dir / run_name / "weights" / "best.pt"
    print(f"[YOLO Train] 완료: {best_pt}")


if __name__ == "__main__":
    main()
