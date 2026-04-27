import { CLASS_COLORS, ClassName, SamObject } from "../api/client";

interface Props {
  objects: SamObject[];
  selectedObjId: number | null;
  onSelect: (objId: number) => void;
  onDelete: (objId: number) => void;
  onClear: () => void;
  onSave: () => void;
  onNewObject: () => void;
  saving: boolean;
  saved: boolean;
}

export default function Sidebar({
  objects,
  selectedObjId,
  onSelect,
  onDelete,
  onClear,
  onSave,
  onNewObject,
  saving,
  saved,
}: Props) {
  return (
    <div
      style={{
        width: 200,
        background: "#12121f",
        borderRight: "1px solid #2a2a3e",
        display: "flex",
        flexDirection: "column",
        padding: 12,
        gap: 10,
        flexShrink: 0,
      }}
    >
      <div style={{ color: "#aaa", fontSize: 12, fontWeight: 600, letterSpacing: 1 }}>
        OBJECTS ({objects.length})
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {objects.length === 0 && (
          <div style={{ color: "#555", fontSize: 12, textAlign: "center", marginTop: 20 }}>
            캔버스를 클릭해<br />객체를 추가하세요
          </div>
        )}
        {objects.map((obj) => {
          const color = CLASS_COLORS[obj.class_name as ClassName] ?? "#fff";
          const isSelected = obj.obj_id === selectedObjId;
          return (
            <div
              key={obj.obj_id}
              onClick={() => onSelect(obj.obj_id)}
              style={{
                background: isSelected ? "#1e2a3e" : "#1a1a2e",
                border: `1px solid ${isSelected ? color : "#2a2a3e"}`,
                borderRadius: 6,
                padding: "6px 8px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: color,
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1, fontSize: 12, color: "#ddd" }}>
                {obj.class_name}
              </span>
              <span style={{ fontSize: 10, color: "#666" }}>
                {obj.from_box ? "B" : ""}
                {obj.click_count > 0 ? `+${obj.click_count}` : ""}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(obj.obj_id); }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#e57373",
                  cursor: "pointer",
                  fontSize: 16,
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          onClick={onNewObject}
          style={{
            padding: "6px 0",
            background: "#1e3a5f",
            color: "#90caf9",
            border: "1px solid #1565C0",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          + 새 객체
        </button>

        {objects.length > 0 && (
          <button
            onClick={onClear}
            style={{
              padding: "5px 0",
              background: "none",
              color: "#e57373",
              border: "1px solid #c62828",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            전체 초기화
          </button>
        )}

        <button
          onClick={onSave}
          disabled={saving || objects.length === 0}
          style={{
            padding: "8px 0",
            background: saved ? "#1b5e20" : "#2e7d32",
            color: "#a5d6a7",
            border: `1px solid ${saved ? "#2e7d32" : "#43a047"}`,
            borderRadius: 6,
            cursor: saving || objects.length === 0 ? "not-allowed" : "pointer",
            fontWeight: 600,
            fontSize: 13,
            opacity: objects.length === 0 ? 0.4 : 1,
          }}
        >
          {saving ? "저장 중..." : saved ? "✓ 저장됨" : "저장 (Ctrl+S)"}
        </button>
      </div>
    </div>
  );
}
