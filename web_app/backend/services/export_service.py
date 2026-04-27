import cv2
import numpy as np


def mask_to_polygons(mask: np.ndarray, w: int, h: int) -> list[list[float]]:
    """Convert binary mask to normalized polygon coordinates for YOLO seg format."""
    mask_uint8 = mask.astype(np.uint8) * 255
    contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polygons = []
    for contour in contours:
        polygon = contour.reshape(-1, 2)
        normalized: list[float] = []
        for x, y in polygon:
            normalized.append(round(float(x) / w, 6))
            normalized.append(round(float(y) / h, 6))
        if normalized:
            polygons.append(normalized)
    return polygons


def build_yolo_lines(
    seg_results: list[dict],
    corrections: dict,
    class_map: dict[str, int],
    w: int,
    h: int,
) -> list[str]:
    lines: list[str] = []
    for idx, seg in enumerate(seg_results):
        class_name = seg["class"]
        class_id = class_map.get(class_name)
        if class_id is None:
            continue

        # Use corrected mask if available, else original
        if idx in corrections and corrections[idx].mask is not None:
            mask = corrections[idx].mask
        else:
            mask = seg["mask"]

        polygons = mask_to_polygons(mask, w, h)
        for poly in polygons:
            if poly:
                lines.append(f"{class_id} " + " ".join(map(str, poly)))
    return lines
