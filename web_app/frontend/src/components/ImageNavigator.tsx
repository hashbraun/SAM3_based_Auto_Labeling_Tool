import { ImageEntry } from "../api/client";

interface Props {
  images: ImageEntry[];
  currentIdx: number;
  onNavigate: (idx: number) => void;
  unsaved: boolean;
}

const btn: React.CSSProperties = {
  padding: "4px 10px",
  background: "#1e3a5f",
  color: "#e0e0e0",
  border: "1px solid #444",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
};

const btnDisabled: React.CSSProperties = {
  ...btn,
  opacity: 0.35,
  cursor: "default",
};

export default function ImageNavigator({ images, currentIdx, onNavigate, unsaved }: Props) {
  const total = images.length;
  const current = images[currentIdx];
  const atStart = currentIdx === 0;
  const atEnd = currentIdx >= total - 1;

  const navigate = (idx: number) => {
    if (unsaved) {
      if (!window.confirm("저장하지 않은 라벨이 있습니다. 이동하시겠습니까?")) return;
    }
    onNavigate(idx);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      <button style={atStart ? btnDisabled : btn} disabled={atStart} onClick={() => navigate(0)}>
        ◀◀
      </button>
      <button style={atStart ? btnDisabled : btn} disabled={atStart} onClick={() => navigate(currentIdx - 1)}>
        ◀
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 200, justifyContent: "center" }}>
        <span style={{ color: "#ddd", fontWeight: 500 }}>
          {current?.filename ?? "-"}
        </span>
        {unsaved && (
          <span style={{ color: "#ff7043", fontSize: 11, fontWeight: 700 }}>●미저장</span>
        )}
        {!unsaved && current && (
          <span style={{ color: "#66bb6a", fontSize: 11 }}>
            {current.saved ? "✓저장됨" : ""}
          </span>
        )}
      </div>

      <span style={{ color: "#888", fontSize: 12, minWidth: 60, textAlign: "center" }}>
        {total > 0 ? `${currentIdx + 1} / ${total}` : "0 / 0"}
      </span>

      <button style={atEnd ? btnDisabled : btn} disabled={atEnd} onClick={() => navigate(currentIdx + 1)}>
        ▶
      </button>
      <button style={atEnd ? btnDisabled : btn} disabled={atEnd} onClick={() => navigate(total - 1)}>
        ▶▶
      </button>
    </div>
  );
}
