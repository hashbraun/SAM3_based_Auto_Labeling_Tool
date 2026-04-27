from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np

CLASSES = ["사람", "강아지", "로봇", "휠체어"]
CLASS_INDEX = {cls: idx for idx, cls in enumerate(CLASSES)}


@dataclass
class ClickState:
    """SAM3 누적 클릭 상태 (객체 1개)"""
    class_name: str
    initial_box: Optional[list[int]] = None                 # YOLO bbox [x1,y1,x2,y2] (픽셀)
    coords: list[list[int]] = field(default_factory=list)  # [[x, y], ...]
    labels: list[int] = field(default_factory=list)         # 1=positive, 0=negative
    prev_logits: Optional[np.ndarray] = None                # (1, 256, 256)
    mask: Optional[np.ndarray] = None                       # (H, W) bool


@dataclass
class FrameState:
    """단일 이미지 프레임 라벨 상태"""
    image_path: str
    image_rgb: Optional[np.ndarray] = None  # lazy loaded
    objects: dict[int, ClickState] = field(default_factory=dict)  # obj_id → ClickState
    next_obj_id: int = 0
    saved: bool = False


@dataclass
class TrainJobState:
    running: bool = False
    epoch: int = 0
    total_epochs: int = 0
    metrics: dict = field(default_factory=dict)
    model_path: str = ""
    error: str = ""


# --- Global in-memory session state ---

# 현재 선택된 프로젝트 폴더
current_project_folder: str = ""

# image_path → FrameState
frames: dict[str, FrameState] = {}

# 현재 폴더의 이미지 경로 목록 (순서 유지)
image_list: list[str] = []

# 학습 job 상태
train_job: TrainJobState = TrainJobState()

# 등록된 모델 목록: {model_name: model_path}
registered_models: dict[str, str] = {}
