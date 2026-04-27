export type LabelMode = "sam" | "yolo_guide";

interface Props {
  mode: LabelMode;
  onChange: (mode: LabelMode) => void;
  yoloAvailable?: boolean;
}

export default function ModeToggle({ mode, onChange, yoloAvailable = false }: Props) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <span style={{ fontSize: 12, color: "#aaa", marginRight: 4 }}>모드:</span>
      <button
        onClick={() => onChange("sam")}
        style={{
          padding: "4px 12px",
          background: mode === "sam" ? "#1565C0" : "#1e1e2e",
          color: mode === "sam" ? "#fff" : "#78909c",
          border: "2px solid #1565C0",
          borderRadius: "16px 0 0 16px",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: mode === "sam" ? 700 : 400,
        }}
      >
        SAM3
      </button>
      <button
        onClick={() => yoloAvailable && onChange("yolo_guide")}
        title={yoloAvailable ? undefined : "Phase 3에서 활성화"}
        style={{
          padding: "4px 12px",
          background: mode === "yolo_guide" ? "#4CAF50" : "#1e1e2e",
          color: mode === "yolo_guide" ? "#fff" : yoloAvailable ? "#78909c" : "#444",
          border: "2px solid #4CAF50",
          borderRadius: "0 16px 16px 0",
          cursor: yoloAvailable ? "pointer" : "not-allowed",
          fontSize: 12,
          opacity: yoloAvailable ? 1 : 0.5,
        }}
      >
        YOLO Guide
      </button>
    </div>
  );
}
