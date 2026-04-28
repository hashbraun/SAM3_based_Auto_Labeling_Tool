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
    p.add_argument("--batch", type=int, default=4)
    p.add_argument("--weights-dir", required=True)
    p.add_argument("--run-name", default="")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        print("ERROR: ultralytics가 설치되지 않았습니다. pip install ultralytics")
        sys.exit(1)

    run_name = args.run_name or datetime.now().strftime("%Y%m%d_%H%M%S")
    weights_dir = Path(args.weights_dir)
    weights_dir.mkdir(parents=True, exist_ok=True)

    print(f"[YOLO Train] model={args.model}, epochs={args.epochs}, imgsz={args.imgsz}, batch={args.batch}")
    print(f"[YOLO Train] data={args.data}")
    print(f"[YOLO Train] output={weights_dir}/{run_name}")

    model = YOLO(args.model)
    model.train(
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

    best_pt = weights_dir / run_name / "weights" / "best.pt"
    print(f"[YOLO Train] 완료: {best_pt}")


if __name__ == "__main__":
    main()
