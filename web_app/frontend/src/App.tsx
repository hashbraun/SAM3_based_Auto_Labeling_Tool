import { useEffect, useState } from "react";
import { api, DetectionResult, ImageInfo } from "./api/client";
import Uploader from "./components/Uploader";
import LabelCanvas from "./components/LabelCanvas";
import Sidebar from "./components/Sidebar";

interface Point {
  x: number;
  y: number;
  label: 0 | 1;
}

interface ImageMeta {
  w: number;
  h: number;
}

export default function App() {
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [detections, setDetections] = useState<DetectionResult[]>([]);
  const [selectedDetIdx, setSelectedDetIdx] = useState<number | null>(null);
  const [pointsPerDet, setPointsPerDet] = useState<Record<number, Point[]>>({});
  const [imageMeta, setImageMeta] = useState<ImageMeta | null>(null);
  const [textPrompt, setTextPrompt] = useState("person . dog");
  const [labelLoading, setLabelLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ total: 0, done: 0, failed: 0, current: "" });

  useEffect(() => {
    api.listImages().then((list) => {
      if (list.length > 0) setImages(list);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!batchRunning) return;
    const id = setInterval(async () => {
      try {
        const [s, list] = await Promise.all([api.getBatchStatus(), api.listImages()]);
        setBatchProgress({ total: s.total, done: s.done, failed: s.failed, current: s.current });
        setImages(list);
        if (!s.running) {
          setBatchRunning(false);
          setStatusMsg(`배치 완료: ${s.done}개 성공, ${s.failed}개 실패`);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(id);
  }, [batchRunning]);

  const currentImage = images[currentIdx] ?? null;
  const imageUrl = currentImage ? `/api/images/${currentImage.id}/file` : null;
  const currentPoints = selectedDetIdx !== null ? (pointsPerDet[selectedDetIdx] ?? []) : [];

  useEffect(() => {
    if (!imageUrl) { setImageMeta(null); return; }
    const img = new Image();
    img.onload = () => setImageMeta({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    setDetections([]);
    setSelectedDetIdx(null);
    setPointsPerDet({});

    if (!currentImage || currentImage.status === "pending") return;

    api.getLabelResult(currentImage.id)
      .then((r) => setDetections(r.detections))
      .catch(() => {});
  }, [currentImage?.id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleUploaded = (newImages: ImageInfo[]) => {
    setImages((prev) => {
      const existingIds = new Set(prev.map((i) => i.id));
      const fresh = newImages.filter((i) => !existingIds.has(i.id));
      return [...prev, ...fresh];
    });
  };

  const handleStartBatch = async () => {
    try {
      await api.startBatch({ text_prompt: textPrompt, box_threshold: 0.35, text_threshold: 0.25 });
      setBatchRunning(true);
      setBatchProgress({ total: 0, done: 0, failed: 0, current: "" });
      setStatusMsg("배치 라벨링 시작...");
    } catch (e) {
      setStatusMsg(`배치 오류: ${e}`);
    }
  };

  const handleRunLabel = async () => {
    if (!currentImage) return;
    setLabelLoading(true);
    setStatusMsg("라벨링 중...");
    try {
      const result = await api.labelImage(currentImage.id, {
        text_prompt: textPrompt,
        box_threshold: 0.35,
        text_threshold: 0.25,
      });
      setDetections(result.detections);
      setSelectedDetIdx(null);
      setPointsPerDet({});
      setImages((prev) =>
        prev.map((img) =>
          img.id === currentImage.id ? { ...img, status: "labeled" } : img
        )
      );
      setStatusMsg(`완료: ${result.detections.length}개 객체 감지`);
    } catch (e) {
      setStatusMsg(`오류: ${e}`);
    } finally {
      setLabelLoading(false);
    }
  };

  const handleCanvasClick = async (x: number, y: number, label: 0 | 1) => {
    if (!currentImage || selectedDetIdx === null) return;

    setPointsPerDet((prev) => ({
      ...prev,
      [selectedDetIdx]: [...(prev[selectedDetIdx] ?? []), { x, y, label }],
    }));

    try {
      const result = await api.addPoint(currentImage.id, selectedDetIdx, x, y, label);
      setDetections((prev) =>
        prev.map((d) =>
          d.det_idx === result.det_idx ? { ...d, polygons: result.polygons } : d
        )
      );
    } catch (e) {
      setStatusMsg(`수정 오류: ${e}`);
      setPointsPerDet((prev) => ({
        ...prev,
        [selectedDetIdx]: (prev[selectedDetIdx] ?? []).slice(0, -1),
      }));
    }
  };

  const handleDetectionSelect = (detIdx: number) => {
    setSelectedDetIdx((prev) => (prev === detIdx ? null : detIdx));
    setStatusMsg(`${detections.find((d) => d.det_idx === detIdx)?.class_name ?? ""} 선택됨 — 좌클릭(+) 우클릭(−)으로 마스크 수정`);
  };

  const handleDeleteDetection = async (detIdx: number) => {
    if (!currentImage) return;
    try {
      const result = await api.deleteDetection(currentImage.id, detIdx);
      setDetections(result.detections);
      setSelectedDetIdx(null);
      setPointsPerDet({});
      setStatusMsg(`Detection #${detIdx} 삭제됨`);
    } catch (e) {
      setStatusMsg(`삭제 오류: ${e}`);
    }
  };

  const handleReset = async (detIdx: number) => {
    if (!currentImage) return;
    try {
      const result = await api.resetCorrection(currentImage.id, detIdx);
      setDetections((prev) =>
        prev.map((d) =>
          d.det_idx === result.det_idx ? { ...d, polygons: result.polygons } : d
        )
      );
      setPointsPerDet((prev) => { const n = { ...prev }; delete n[detIdx]; return n; });
      setStatusMsg("포인트 초기화 완료");
    } catch (e) {
      setStatusMsg(`초기화 오류: ${e}`);
    }
  };

  const handleSave = async () => {
    try {
      const result = await api.exportAll();
      const list = await api.listImages();
      setImages(list);
      setStatusMsg(`전체 저장 완료 (${result.saved}개 파일)`);
    } catch (e) {
      setStatusMsg(`저장 오류: ${e}`);
    }
  };

  const handleExportZip = () => {
    window.location.href = api.exportZipUrl();
  };

  const goTo = (idx: number) => {
    const clamped = Math.max(0, Math.min(images.length - 1, idx));
    setCurrentIdx(clamped);
  };

  return (
    <div style={{ display: "flex", width: "100vw", minHeight: "100vh", overflow: "hidden" }}>
      <Sidebar
        detections={detections}
        selectedDetIdx={selectedDetIdx}
        pointCount={currentPoints.length}
        onSelect={handleDetectionSelect}
        onReset={handleReset}
        onDelete={handleDeleteDetection}
        onSave={handleSave}
        onExportZip={handleExportZip}
        textPrompt={textPrompt}
        onTextPromptChange={setTextPrompt}
        onRunLabel={handleRunLabel}
        labelLoading={labelLoading}
        onStartBatch={handleStartBatch}
        batchRunning={batchRunning}
        batchProgress={batchProgress}
      />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 16, gap: 12 }}>
        <Uploader onUploaded={handleUploaded} />

        {images.length > 0 && (
          <div style={{ textAlign: "center", fontSize: 14 }}>
            {currentImage?.filename ?? "-"}
            {" "}
            <span style={{ color: statusColor(currentImage?.status) }}>
              [{currentImage?.status ?? ""}]
            </span>
          </div>
        )}

        {imageUrl && imageMeta ? (
          <div style={{ background: "#111", borderRadius: 8, overflow: "hidden", height: "calc(100vh - 260px)", minHeight: 300 }}>
            <LabelCanvas
              imageUrl={imageUrl}
              imageW={imageMeta.w}
              imageH={imageMeta.h}
              detections={detections}
              selectedDetIdx={selectedDetIdx}
              points={currentPoints}
              onCanvasClick={handleCanvasClick}
              onDetectionSelect={handleDetectionSelect}
            />
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#555" }}>
            이미지를 업로드하세요
          </div>
        )}

        {images.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <button onClick={() => goTo(0)} disabled={currentIdx === 0} style={navBtn}>◀◀ 맨앞</button>
            <button onClick={() => goTo(currentIdx - 1)} disabled={currentIdx === 0} style={navBtn}>◀ 이전</button>
            <span style={{ fontSize: 13, color: "#aaa", minWidth: 80, textAlign: "center" }}>
              {currentIdx + 1} / {images.length}
            </span>
            <button onClick={() => goTo(currentIdx + 1)} disabled={currentIdx >= images.length - 1} style={navBtn}>다음 ▶</button>
            <button onClick={() => goTo(images.length - 1)} disabled={currentIdx >= images.length - 1} style={navBtn}>맨뒤 ▶▶</button>
          </div>
        )}

        {statusMsg && (
          <div style={{ fontSize: 12, color: "#aaa", padding: "4px 8px", background: "#16213e", borderRadius: 4 }}>
            {statusMsg}
          </div>
        )}
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  padding: "6px 16px",
  background: "#1e3a5f",
  color: "#e0e0e0",
  border: "1px solid #444",
  borderRadius: 6,
  cursor: "pointer",
};

function statusColor(status?: string): string {
  if (status === "done") return "#66bb6a";
  if (status === "labeled") return "#ffa726";
  return "#78909c";
}
