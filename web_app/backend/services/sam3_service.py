from __future__ import annotations

import threading
from pathlib import Path
from typing import Optional

import numpy as np
import torch
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor


class SAM3Service:
    _instance: Optional["SAM3Service"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._predictor: Optional[SAM2ImagePredictor] = None
        self._current_image_key: Optional[str] = None
        self._infer_lock = threading.Lock()

    @classmethod
    def get(cls) -> "SAM3Service":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def load(self, checkpoint: str, model_cfg: str = "configs/sam2.1/sam2.1_hiera_s.yaml") -> None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = build_sam2(model_cfg, checkpoint, device=device)
        self._predictor = SAM2ImagePredictor(model)
        print(f"SAM3 loaded: {Path(checkpoint).name} on {device}")

    def set_image(self, image_key: str, image_rgb: np.ndarray) -> None:
        if self._current_image_key == image_key:
            return
        with self._infer_lock:
            self._predictor.set_image(image_rgb)
            self._current_image_key = image_key

    def predict(
        self,
        coords: list[list[int]],
        labels: list[int],
        prev_logits: Optional[np.ndarray] = None,
        box: Optional[list[int]] = None,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """box=[x1,y1,x2,y2] 와 point 를 함께 넘길 수 있다. box만 있으면 coords=[] 로 호출."""
        with self._infer_lock:
            point_coords = np.array(coords, dtype=np.float32) if coords else None
            point_labels = np.array(labels, dtype=np.int32) if labels else None
            box_arr = np.array(box, dtype=np.float32) if box else None
            masks, scores, logits = self._predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                box=box_arr,
                mask_input=prev_logits,
                multimask_output=len(coords) == 0,  # box-only일 때만 멀티마스크
            )
            return masks, scores, logits

    @property
    def is_loaded(self) -> bool:
        return self._predictor is not None
