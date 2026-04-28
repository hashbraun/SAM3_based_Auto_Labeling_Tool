#!/bin/bash
#SBATCH --job-name=yolo_seg_train
#SBATCH --nodelist=gpu-106
#SBATCH --gres=gpu:1
#SBATCH --cpus-per-task=4
#SBATCH --mem=16G
#SBATCH --time=0
#SBATCH --output={LOG_DIR}/train_%j.out
#SBATCH --error={LOG_DIR}/train_%j.err

set -e

BACKEND_DIR=/home1/sota/SAM3_based_Auto_Labeling_Tool/web_app/backend
PYTHON=$BACKEND_DIR/.venv/bin/python

echo "[SBATCH] Job ID: $SLURM_JOB_ID, Node: $SLURMD_NODENAME"
echo "[SBATCH] Start: $(date)"

cd "$BACKEND_DIR"

$PYTHON scripts/train_yolo.py \
    --data {DATA_YAML} \
    --model {MODEL} \
    --epochs {EPOCHS} \
    --imgsz {IMGSZ} \
    --batch {BATCH} \
    --weights-dir {WEIGHTS_DIR} \
    --run-name {RUN_NAME}

echo "[SBATCH] Done: $(date)"
