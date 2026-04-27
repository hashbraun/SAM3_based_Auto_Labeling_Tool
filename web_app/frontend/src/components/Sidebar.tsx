import { DetectionResult } from "../api/client";

interface BatchProgress {
  total: number;
  done: number;
  failed: number;
  current: string;
}

interface Props {
  detections: DetectionResult[];
  selectedDetIdx: number | null;
  pointCount: number;
  onSelect: (idx: number) => void;
  onReset: (idx: number) => void;
  onDelete: (idx: number) => void;
  onSave: () => void;
  onExportZip: () => void;
  textPrompt: string;
  onTextPromptChange: (v: string) => void;
  onRunLabel: () => void;
  labelLoading: boolean;
  onStartBatch: () => void;
  batchRunning: boolean;
  batchProgress: BatchProgress;
}

const COLORS = ["#64c8ff", "#64ff96", "#ffb464", "#dc64ff", "#ff6482"];

export default function Sidebar({
  detections,
  selectedDetIdx,
  pointCount,
  onSelect,
  onReset,
  onDelete,
  onSave,
  onExportZip,
  textPrompt,
  onTextPromptChange,
  onRunLabel,
  labelLoading,
  onStartBatch,
  batchRunning,
  batchProgress,
}: Props) {
  const s = (style: React.CSSProperties): React.CSSProperties => style;

  return (
    <div style={s({ display: "flex", flexDirection: "column", gap: 16, padding: 16, width: 260, background: "#0f3460", minHeight: "100vh" })}>
      <h3 style={{ color: "#64b5f6", margin: 0 }}>라벨링 설정</h3>

      <div>
        <label style={{ fontSize: 12, color: "#aaa" }}>텍스트 프롬프트</label>
        <input
          value={textPrompt}
          onChange={(e) => onTextPromptChange(e.target.value)}
          placeholder="person . dog"
          style={s({ width: "100%", marginTop: 4, padding: "6px 8px", background: "#16213e", border: "1px solid #444", borderRadius: 4, color: "#e0e0e0", fontSize: 13 })}
        />
        <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>클래스를 ". "로 구분</div>
      </div>

      <button
        onClick={onRunLabel}
        disabled={labelLoading || batchRunning}
        style={s({ padding: "8px 0", background: labelLoading ? "#555" : "#1976d2", color: "#fff", border: "none", borderRadius: 6, cursor: labelLoading ? "not-allowed" : "pointer", fontWeight: 600 })}
      >
        {labelLoading ? "처리 중..." : "현재 이미지 라벨링"}
      </button>

      <button
        onClick={onStartBatch}
        disabled={batchRunning || labelLoading}
        style={s({ padding: "8px 0", background: batchRunning ? "#555" : "#0288d1", color: "#fff", border: "none", borderRadius: 6, cursor: batchRunning ? "not-allowed" : "pointer", fontWeight: 600 })}
      >
        {batchRunning ? "배치 진행 중..." : "전체 이미지 라벨링"}
      </button>

      {batchRunning && (
        <div style={s({ fontSize: 12, color: "#aaa", background: "#16213e", borderRadius: 4, padding: "6px 8px" })}>
          <div>{batchProgress.done} / {batchProgress.total} 완료 {batchProgress.failed > 0 ? `(실패 ${batchProgress.failed})` : ""}</div>
          {batchProgress.current && <div style={{ color: "#888", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{batchProgress.current}</div>}
        </div>
      )}

      <hr style={{ borderColor: "#333" }} />

      <h4 style={{ margin: 0, color: "#aaa", fontSize: 13 }}>감지된 객체 ({detections.length})</h4>

      {detections.length === 0 && (
        <div style={{ fontSize: 12, color: "#666" }}>없음</div>
      )}

      {detections.map((det) => {
        const color = COLORS[det.det_idx % COLORS.length];
        const isSelected = det.det_idx === selectedDetIdx;
        return (
          <div
            key={det.det_idx}
            onClick={() => onSelect(det.det_idx)}
            style={s({
              padding: "8px 10px",
              borderRadius: 6,
              border: `2px solid ${isSelected ? color : "#333"}`,
              background: isSelected ? "#1e3a5f" : "#16213e",
              cursor: "pointer",
            })}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: color, display: "inline-block", flexShrink: 0 }} />
              <span style={{ fontWeight: 600, fontSize: 13 }}>{det.class_name}</span>
              <span style={{ fontSize: 11, color: "#888", marginLeft: "auto" }}>#{det.det_idx}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(det.det_idx); }}
                title="삭제"
                style={s({ padding: "1px 6px", fontSize: 13, background: "transparent", color: "#ef5350", border: "1px solid #ef5350", borderRadius: 4, cursor: "pointer", lineHeight: 1 })}
              >
                ✕
              </button>
            </div>
            {isSelected && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#aaa" }}>
                <div>포인트: {pointCount}개</div>
                <div style={{ marginTop: 4, fontSize: 11, color: "#888" }}>
                  좌클릭 + (포함) / 우클릭 − (제외)
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onReset(det.det_idx); }}
                  style={s({ marginTop: 6, padding: "3px 10px", fontSize: 11, background: "#b71c1c", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" })}
                >
                  포인트 초기화
                </button>
              </div>
            )}
          </div>
        );
      })}

      <hr style={{ borderColor: "#333" }} />

      <button
        onClick={onSave}
        style={s({ padding: "8px 0", background: "#2e7d32", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 })}
      >
        저장 (YOLO .txt)
      </button>

      <button
        onClick={onExportZip}
        style={s({ padding: "8px 0", background: "#6a1b9a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 })}
      >
        전체 ZIP 다운로드
      </button>
    </div>
  );
}
