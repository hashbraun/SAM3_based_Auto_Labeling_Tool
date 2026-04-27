import { ImageInfo } from "../api/client";

interface Props {
  images: ImageInfo[];
  currentIdx: number;
  onSelect: (idx: number) => void;
}

const statusColor = (status: string) => {
  if (status === "done") return "#66bb6a";
  if (status === "labeled") return "#ffa726";
  return "#78909c";
};

export default function ImageStrip({ images, currentIdx, onSelect }: Props) {
  return (
    <div
      style={{
        width: 160,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        background: "#0a2040",
        borderRight: "1px solid #1e3a5f",
        flexShrink: 0,
      }}
    >
      {images.length === 0 && (
        <div style={{ padding: 12, color: "#555", fontSize: 12, textAlign: "center" }}>
          이미지 없음
        </div>
      )}
      {images.map((img, idx) => {
        const isSelected = idx === currentIdx;
        return (
          <div
            key={img.id}
            onClick={() => onSelect(idx)}
            style={{
              padding: 6,
              cursor: "pointer",
              borderBottom: "1px solid #1e3a5f",
              outline: isSelected ? "2px solid #64b5f6" : "2px solid transparent",
              outlineOffset: -2,
              background: isSelected ? "#1e3a5f" : "transparent",
            }}
          >
            <img
              src={`/api/images/${img.id}/file`}
              alt={img.filename}
              style={{
                width: "100%",
                height: 110,
                objectFit: "cover",
                borderRadius: 3,
                display: "block",
              }}
            />
            <div
              style={{
                fontSize: 10,
                color: "#aaa",
                marginTop: 4,
                wordBreak: "break-all",
                lineHeight: 1.3,
              }}
            >
              {img.filename}
            </div>
            <div
              style={{
                height: 3,
                background: statusColor(img.status),
                borderRadius: 2,
                marginTop: 3,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
