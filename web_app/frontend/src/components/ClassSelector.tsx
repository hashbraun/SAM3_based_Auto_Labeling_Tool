import { CLASSES, CLASS_COLORS, ClassName } from "../api/client";

interface Props {
  selected: ClassName;
  onChange: (cls: ClassName) => void;
}

export default function ClassSelector({ selected, onChange }: Props) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ fontSize: 12, color: "#aaa", marginRight: 4 }}>클래스:</span>
      {CLASSES.map((cls) => {
        const color = CLASS_COLORS[cls];
        const isSelected = cls === selected;
        return (
          <button
            key={cls}
            onClick={() => onChange(cls)}
            style={{
              padding: "4px 12px",
              background: isSelected ? color : "#1e1e2e",
              color: isSelected ? "#000" : color,
              border: `2px solid ${color}`,
              borderRadius: 16,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: isSelected ? 700 : 400,
              transition: "all 0.15s",
            }}
          >
            {cls}
          </button>
        );
      })}
    </div>
  );
}
