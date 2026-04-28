from __future__ import annotations

import os
import re
import subprocess
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np

# YOLO 학습 시 영어 클래스명 → 앱 한국어 클래스명 매핑
_YOLO_NAME_MAP: dict[str, str] = {
    "person": "사람",
    "dog": "강아지",
    "robot": "로봇",
    "wheelchair": "휠체어",
}


@dataclass
class TrainStatus:
    running: bool = False
    pending: bool = False
    job_id: str = ""
    epoch: int = 0
    total_epochs: int = 0
    metrics: dict = field(default_factory=dict)
    error: str = ""
    log_path: str = ""


@dataclass
class ModelInfo:
    name: str
    path: str
    size_mb: float
    created_at: str
    map50: float = 0.0


@dataclass
class GuideObject:
    class_id: int
    class_name: str
    confidence: float
    bbox: list[float]       # [x1, y1, x2, y2] normalized
    polygon: list[float]    # [x1, y1, x2, y2, ...] normalized


class YoloService:
    _instance: Optional["YoloService"] = None
    _lock = threading.Lock()

    _EPOCH_RE = re.compile(r"\s+(\d+)/(\d+)\s+[\d.]+G")
    _MAP_RE = re.compile(r"all\s+\d+\s+\d+\s+([\d.]+)\s+([\d.]+)")

    def __init__(self) -> None:
        self._status = TrainStatus()
        self._poll_thread: Optional[threading.Thread] = None
        self._state_file = Path(__file__).parent.parent / ".train_state"
        self._infer_model = None
        self._infer_model_path: str = ""
        self._infer_lock = threading.Lock()
        self._restore_state()

    @classmethod
    def get(cls) -> "YoloService":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    # ── 데이터셋 준비 ──────────────────────────────────────────────────────

    def prepare_dataset(self) -> Path:
        from scripts.prepare_dataset import prepare
        base = Path(os.environ.get("LABELING_BASE_DIR", "/nas03/1_EV_LABELING"))
        dst = Path(os.environ.get("YOLO_DATASET_DIR", ""))
        if not dst:
            raise RuntimeError("YOLO_DATASET_DIR 환경변수 미설정")
        return prepare(base, dst)

    # ── 학습 제출 ─────────────────────────────────────────────────────────

    def submit_training(
        self,
        epochs: int = 50,
        imgsz: int = 1280,
        batch: int = 4,
        model: str = "",
    ) -> str:
        if self._status.running or self._status.pending:
            raise RuntimeError(f"이미 실행 중 (job_id={self._status.job_id})")

        data_yaml = self._ensure_dataset()
        model = model or os.environ.get("YOLO_BASE_MODEL", "yolov8n-seg.pt")
        weights_dir = os.environ.get("YOLO_WEIGHTS_DIR", "/nas03/models/yolo_seg")
        log_dir = os.environ.get("YOLO_LOGS_DIR", "/tmp/yolo_logs")
        Path(log_dir).mkdir(parents=True, exist_ok=True)

        run_name = datetime.now().strftime("%Y%m%d_%H%M%S")
        sbatch_tmpl = Path(__file__).parent.parent / "scripts" / "train.sbatch"
        sbatch_content = sbatch_tmpl.read_text()

        for k, v in {
            "{LOG_DIR}": log_dir,
            "{DATA_YAML}": str(data_yaml),
            "{MODEL}": model,
            "{EPOCHS}": str(epochs),
            "{IMGSZ}": str(imgsz),
            "{BATCH}": str(batch),
            "{WEIGHTS_DIR}": weights_dir,
            "{RUN_NAME}": run_name,
        }.items():
            sbatch_content = sbatch_content.replace(k, v)

        tmp_sbatch = Path(log_dir) / f"train_{run_name}.sbatch"
        tmp_sbatch.write_text(sbatch_content)

        try:
            result = subprocess.run(
                ["sbatch", str(tmp_sbatch)],
                capture_output=True, text=True, check=True,
            )
        except FileNotFoundError:
            raise RuntimeError("sbatch 명령어를 찾을 수 없습니다. SLURM이 설치되어 있는지 확인하세요.")
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"sbatch 실패: {e.stderr.strip()}")
        # "Submitted batch job 12345"
        job_id = result.stdout.strip().split()[-1]

        log_path = str(Path(log_dir) / f"train_{job_id}.out")
        self._status = TrainStatus(
            pending=True, job_id=job_id,
            total_epochs=epochs, log_path=log_path,
        )
        self._save_state(job_id, epochs, log_path, run_name)
        self._start_poll()
        return job_id

    # ── 상태 조회 ─────────────────────────────────────────────────────────

    def get_status(self) -> dict:
        self._refresh_slurm_status()
        return {
            "running": self._status.running,
            "pending": self._status.pending,
            "job_id": self._status.job_id,
            "epoch": self._status.epoch,
            "total_epochs": self._status.total_epochs,
            "metrics": self._status.metrics,
            "error": self._status.error,
            "log_path": self._status.log_path,
        }

    def stop_training(self) -> None:
        if self._status.job_id:
            subprocess.run(["scancel", self._status.job_id], check=False)
        self._status = TrainStatus()
        self._state_file.unlink(missing_ok=True)

    # ── 모델 목록 ─────────────────────────────────────────────────────────

    def list_models(self) -> list[dict]:
        weights_dir = Path(os.environ.get("YOLO_WEIGHTS_DIR", "/nas03/models/yolo_seg"))
        if not weights_dir.exists():
            return []

        models = []
        for pt in sorted(weights_dir.rglob("best.pt"), key=lambda p: p.stat().st_mtime, reverse=True):
            info = ModelInfo(
                name=pt.parent.parent.name,
                path=str(pt),
                size_mb=round(pt.stat().st_size / 1e6, 1),
                created_at=datetime.fromtimestamp(pt.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
            )
            # results.csv에서 mAP 파싱
            csv = pt.parent.parent / "results.csv"
            if csv.exists():
                lines = csv.read_text().strip().splitlines()
                if len(lines) > 1:
                    headers = [h.strip() for h in lines[0].split(",")]
                    vals = lines[-1].split(",")
                    try:
                        idx = headers.index("metrics/mAP50(B)")
                        info.map50 = round(float(vals[idx]), 4)
                    except (ValueError, IndexError):
                        pass
            models.append({
                "name": info.name,
                "path": info.path,
                "size_mb": info.size_mb,
                "created_at": info.created_at,
                "map50": info.map50,
            })
        return models

    # ── Guide 추론 ────────────────────────────────────────────────────────

    def infer(self, image: np.ndarray, model_path: str, conf: float = 0.3) -> list[dict]:
        try:
            from ultralytics import YOLO
        except ImportError:
            raise RuntimeError("ultralytics 미설치: pip install ultralytics")

        with self._infer_lock:
            if self._infer_model_path != model_path:
                self._infer_model = YOLO(model_path)
                self._infer_model_path = model_path
            results = self._infer_model.predict(
                image, conf=conf, iou=0.45, imgsz=1280, verbose=False
            )

        h, w = image.shape[:2]
        objects = []
        r = results[0]
        if r.masks is None:
            return objects

        for i, (box, mask_xy, cls, score) in enumerate(zip(
            r.boxes.xyxyn.tolist(),
            r.masks.xyn,
            r.boxes.cls.tolist(),
            r.boxes.conf.tolist(),
        )):
            class_id = int(cls)
            raw_name = r.names.get(class_id, str(class_id))
            class_name = _YOLO_NAME_MAP.get(raw_name, raw_name)
            polygon = mask_xy.flatten().tolist()
            objects.append({
                "obj_id": i,
                "class_id": class_id,
                "class_name": class_name,
                "confidence": round(score, 3),
                "bbox": [round(v, 6) for v in box],
                "polygon": [round(v, 6) for v in polygon],
            })
        return objects

    # ── 내부 헬퍼 ─────────────────────────────────────────────────────────

    def _ensure_dataset(self) -> Path:
        dst = Path(os.environ.get("YOLO_DATASET_DIR", ""))
        data_yaml = dst / "data.yaml"
        if not data_yaml.exists():
            data_yaml = self.prepare_dataset()
        return data_yaml

    def _refresh_slurm_status(self) -> None:
        job_id = self._status.job_id
        if not job_id:
            return

        try:
            result = subprocess.run(
                ["squeue", "-j", job_id, "--noheader", "-o", "%T"],
                capture_output=True, text=True,
            )
        except FileNotFoundError:
            return
        slurm_state = result.stdout.strip().upper()

        if slurm_state == "RUNNING":
            self._status.running = True
            self._status.pending = False
            self._parse_log()
        elif slurm_state == "PENDING":
            self._status.pending = True
            self._status.running = False
        else:
            # COMPLETED / FAILED / CANCELLED or no output
            was_running = self._status.running or self._status.pending
            self._status.running = False
            self._status.pending = False
            if was_running:
                self._parse_log()  # 마지막 epoch 갱신

    def _parse_log(self) -> None:
        log_path = Path(self._status.log_path)
        if not log_path.exists():
            return
        text = log_path.read_text(errors="replace")

        for m in self._EPOCH_RE.finditer(text):
            self._status.epoch = int(m.group(1))
            self._status.total_epochs = max(self._status.total_epochs, int(m.group(2)))

        for m in self._MAP_RE.finditer(text):
            self._status.metrics = {
                "mAP50": round(float(m.group(1)), 4),
                "mAP50_95": round(float(m.group(2)), 4),
            }

    def _start_poll(self) -> None:
        if self._poll_thread and self._poll_thread.is_alive():
            return
        self._poll_thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._poll_thread.start()

    def _poll_loop(self) -> None:
        while self._status.running or self._status.pending:
            time.sleep(15)
            self._refresh_slurm_status()

    def _save_state(self, job_id: str, epochs: int, log_path: str, run_name: str) -> None:
        self._state_file.write_text(
            f"{job_id}\n{epochs}\n{log_path}\n{run_name}\n"
        )

    def _restore_state(self) -> None:
        if not self._state_file.exists():
            return
        lines = self._state_file.read_text().strip().splitlines()
        if len(lines) < 3:
            return
        job_id, epochs, log_path = lines[0], lines[1], lines[2]
        self._status = TrainStatus(
            job_id=job_id,
            total_epochs=int(epochs),
            log_path=log_path,
        )
        self._refresh_slurm_status()
        if self._status.running or self._status.pending:
            self._start_poll()
