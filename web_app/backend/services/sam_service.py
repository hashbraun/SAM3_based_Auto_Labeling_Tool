import numpy as np
import torch
from segment_anything import sam_model_registry, SamPredictor


class SAMService:
    _instance: "SAMService | None" = None

    def __init__(self) -> None:
        self.predictor: SamPredictor | None = None
        self._current_image_id: str | None = None

    @classmethod
    def get(cls) -> "SAMService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def load(self, checkpoint: str) -> None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model_type = "vit_b" if "vit_b" in checkpoint else "vit_l" if "vit_l" in checkpoint else "vit_h"
        sam = sam_model_registry[model_type](checkpoint=checkpoint)
        sam.to(device)
        self.predictor = SamPredictor(sam)
        print(f"SAM loaded on {device}")

    def set_image(self, image_id: str, image_rgb: np.ndarray) -> None:
        if self._current_image_id != image_id:
            self.predictor.set_image(image_rgb)
            self._current_image_id = image_id

    def predict_box(self, box: np.ndarray) -> tuple:
        """box: (1, 4) array [x1, y1, x2, y2]"""
        masks, scores, logits = self.predictor.predict(
            box=box,
            multimask_output=True,
        )
        return masks, scores, logits

    def predict_points(
        self,
        coords: list[list[int]],
        labels: list[int],
        prev_logits: np.ndarray | None = None,
    ) -> tuple:
        """coords: [[x, y], ...], labels: [1 or 0, ...]"""
        # When mask_input is provided, multimask_output must be False (SAM requirement)
        masks, scores, logits = self.predictor.predict(
            point_coords=np.array(coords),
            point_labels=np.array(labels),
            mask_input=prev_logits,
            multimask_output=prev_logits is None,
        )
        return masks, scores, logits
