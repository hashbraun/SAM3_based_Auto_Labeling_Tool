import { useRef, useState } from "react";
import { api, ImageInfo } from "../api/client";

interface Props {
  onUploaded: (images: ImageInfo[]) => void;
}

export default function Uploader({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    try {
      const result = await api.uploadImages(Array.from(files));
      onUploaded(result);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        border: `2px dashed ${dragging ? "#64b5f6" : "#555"}`,
        borderRadius: 8,
        padding: "24px 16px",
        textAlign: "center",
        cursor: "pointer",
        background: dragging ? "#1e3a5f" : "#16213e",
        transition: "all 0.2s",
      }}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => upload(e.target.files)}
      />
      {loading ? "업로드 중..." : "이미지를 드래그하거나 클릭해서 업로드"}
    </div>
  );
}
