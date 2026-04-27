import { useEffect, useState } from "react";
import {
  api,
  CLASSES,
  ClassName,
  ImageEntry,
  SamObject,
} from "./api/client";
import ClassSelector from "./components/ClassSelector";
import ImageNavigator from "./components/ImageNavigator";
import LabelCanvas from "./components/LabelCanvas";
import ModeToggle, { LabelMode } from "./components/ModeToggle";
import Sidebar from "./components/Sidebar";

interface ClickPoint {
  x: number;
  y: number;
  label: 0 | 1;
}

interface ImageMeta {
  w: number;
  h: number;
}

export default function App() {
  // Folder browser state
  const [folderInput, setFolderInput] = useState("/nas03");
  const [subFolders, setSubFolders] = useState<string[]>([]);
  const [folderError, setFolderError] = useState("");

  // Project state
  const [projectFolder, setProjectFolder] = useState<string | null>(null);
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [imageMeta, setImageMeta] = useState<ImageMeta | null>(null);

  // Labeling state
  const [objects, setObjects] = useState<SamObject[]>([]);
  const [selectedObjId, setSelectedObjId] = useState<number | null>(null);
  const [clickPoints, setClickPoints] = useState<ClickPoint[]>([]);
  const [selectedClass, setSelectedClass] = useState<ClassName>(CLASSES[0]);
  const [mode, setMode] = useState<LabelMode>("sam");

  // UI state
  const [statusMsg, setStatusMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const unsaved = objects.length > 0 && !saved;

  const currentImage = images[currentIdx] ?? null;
  const imageUrl = currentImage ? api.imageUrl(currentImage.path) : null;

  // Load image dimensions
  useEffect(() => {
    if (!imageUrl) { setImageMeta(null); return; }
    const img = new Image();
    img.onload = () => setImageMeta({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = imageUrl;
  }, [imageUrl]);

  // Load objects when image changes
  useEffect(() => {
    if (!currentImage) { setObjects([]); setSaved(false); setClickPoints([]); setSelectedObjId(null); return; }
    api.getObjects(currentImage.path)
      .then((r) => {
        setObjects(r.objects);
        setSaved(r.saved);
        setClickPoints([]);
        setSelectedObjId(null);
      })
      .catch(() => { setObjects([]); setSaved(false); });
  }, [currentImage?.path]);

  // Ctrl+S to save
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") { e.preventDefault(); handleSave(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const handleFolderBrowse = async () => {
    setFolderError("");
    try {
      const result = await api.listFolders(folderInput);
      setSubFolders(result.folders);
    } catch {
      setFolderError("폴더를 열 수 없습니다.");
      setSubFolders([]);
    }
  };

  const handleSelectFolder = async (folder: string) => {
    setLoading(true);
    try {
      const result = await api.listImages(folder);
      setProjectFolder(folder);
      setImages(result.images);
      setCurrentIdx(0);
      setObjects([]);
      setSaved(false);
      setClickPoints([]);
      setSelectedObjId(null);
      setStatusMsg(`${result.total}개 이미지 로드됨`);
    } catch {
      setFolderError("이미지 목록을 불러올 수 없습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleNavigate = (idx: number) => {
    setCurrentIdx(idx);
  };

  const handleCanvasClick = async (x: number, y: number, label: 0 | 1) => {
    if (!currentImage) return;

    // Optimistic: add point visually
    const newPoint: ClickPoint = { x, y, label };
    setClickPoints((prev) => [...prev, newPoint]);

    try {
      const result = await api.samClick(
        currentImage.path, x, y, label, selectedClass,
        selectedObjId !== null ? selectedObjId : -1
      );
      setObjects((prev) => {
        const exists = prev.find((o) => o.obj_id === result.obj_id);
        if (exists) return prev.map((o) => o.obj_id === result.obj_id ? result : o);
        return [...prev, result];
      });
      setSelectedObjId(result.obj_id);
      setSaved(false);
      setStatusMsg(`${result.class_name} #${result.obj_id} — 클릭 ${result.click_count}회`);
    } catch (e) {
      // Roll back optimistic point
      setClickPoints((prev) => prev.slice(0, -1));
      setStatusMsg(`오류: ${e}`);
    }
  };

  const handleObjectSelect = (objId: number) => {
    setSelectedObjId((prev) => prev === objId ? null : objId);
    setClickPoints([]);
    const obj = objects.find((o) => o.obj_id === objId);
    if (obj) setStatusMsg(`${obj.class_name} #${objId} 선택 — 좌클릭(+) 우클릭(−)`);
  };

  const handleDelete = async (objId: number) => {
    if (!currentImage) return;
    try {
      await api.deleteObject(currentImage.path, objId);
      setObjects((prev) => prev.filter((o) => o.obj_id !== objId));
      if (selectedObjId === objId) { setSelectedObjId(null); setClickPoints([]); }
      setSaved(false);
      setStatusMsg(`객체 #${objId} 삭제`);
    } catch (e) {
      setStatusMsg(`삭제 오류: ${e}`);
    }
  };

  const handleClear = async () => {
    if (!currentImage) return;
    if (!window.confirm("이 이미지의 모든 객체를 초기화할까요?")) return;
    try {
      await api.clearObjects(currentImage.path);
      setObjects([]);
      setSelectedObjId(null);
      setClickPoints([]);
      setSaved(false);
      setStatusMsg("전체 초기화 완료");
    } catch (e) {
      setStatusMsg(`초기화 오류: ${e}`);
    }
  };

  const handleSave = async () => {
    if (!currentImage || objects.length === 0) return;
    setSaving(true);
    try {
      const result = await api.saveLabel(currentImage.path, false);
      if (result.conflict) {
        if (!window.confirm(result.message + "\n덮어쓰시겠습니까?")) {
          setSaving(false); return;
        }
        const force = await api.saveLabel(currentImage.path, true);
        if (force.ok) {
          setSaved(true);
          setImages((prev) =>
            prev.map((img, i) => i === currentIdx ? { ...img, saved: true } : img)
          );
          setStatusMsg(`저장 완료 — ${force.object_count}개 객체`);
        }
      } else if (result.ok) {
        setSaved(true);
        setImages((prev) =>
          prev.map((img, i) => i === currentIdx ? { ...img, saved: true } : img)
        );
        setStatusMsg(`저장 완료 — ${result.object_count}개 객체`);
      }
    } catch (e) {
      setStatusMsg(`저장 오류: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleNewObject = () => {
    setSelectedObjId(null);
    setClickPoints([]);
    setStatusMsg(`새 ${selectedClass} 객체 — 캔버스를 클릭하세요`);
  };

  // ─── Folder Browser ────────────────────────────────────────────────────────
  if (!projectFolder) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0d0d1a",
          color: "#ddd",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 32,
        }}
      >
        <h2 style={{ color: "#90caf9", margin: 0 }}>SAM3 Auto Labeling</h2>
        <p style={{ color: "#888", margin: 0 }}>이미지가 있는 프로젝트 폴더를 선택하세요</p>

        <div style={{ display: "flex", gap: 8, width: "100%", maxWidth: 600 }}>
          <input
            value={folderInput}
            onChange={(e) => setFolderInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleFolderBrowse()}
            style={{
              flex: 1,
              padding: "8px 12px",
              background: "#1a1a2e",
              border: "1px solid #3a3a5e",
              borderRadius: 6,
              color: "#ddd",
              fontSize: 13,
            }}
          />
          <button
            onClick={handleFolderBrowse}
            disabled={loading}
            style={{
              padding: "8px 16px",
              background: "#1565C0",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            탐색
          </button>
        </div>

        {folderError && <div style={{ color: "#ef5350", fontSize: 13 }}>{folderError}</div>}

        {subFolders.length > 0 && (
          <div
            style={{
              width: "100%",
              maxWidth: 600,
              background: "#1a1a2e",
              border: "1px solid #2a2a4e",
              borderRadius: 8,
              maxHeight: 320,
              overflowY: "auto",
            }}
          >
            {/* 현재 폴더 직접 열기 */}
            <div
              onClick={() => handleSelectFolder(folderInput)}
              style={{
                padding: "10px 16px",
                cursor: "pointer",
                borderBottom: "1px solid #2a2a4e",
                color: "#90caf9",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              📂 현재 폴더 열기: {folderInput}
            </div>
            {subFolders.map((f) => (
              <div
                key={f}
                style={{
                  padding: "8px 16px",
                  cursor: "pointer",
                  borderBottom: "1px solid #1e1e3e",
                  fontSize: 13,
                  color: "#ccc",
                  display: "flex",
                  justifyContent: "space-between",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#252540")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span
                  onClick={() => { setFolderInput(f); setSubFolders([]); }}
                >
                  📁 {f.split("/").pop()}
                </span>
                <button
                  onClick={() => handleSelectFolder(f)}
                  style={{
                    padding: "2px 10px",
                    background: "#1565C0",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  열기
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Main Labeling UI ──────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", overflow: "hidden", background: "#0d0d1a" }}>
      <Sidebar
        objects={objects}
        selectedObjId={selectedObjId}
        onSelect={handleObjectSelect}
        onDelete={handleDelete}
        onClear={handleClear}
        onSave={handleSave}
        onNewObject={handleNewObject}
        saving={saving}
        saved={saved}
      />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "8px 16px",
            background: "#12121f",
            borderBottom: "1px solid #2a2a3e",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() => setProjectFolder(null)}
            style={{
              padding: "4px 10px",
              background: "none",
              color: "#78909c",
              border: "1px solid #444",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            ← 폴더 변경
          </button>

          <ClassSelector selected={selectedClass} onChange={(cls) => { setSelectedClass(cls); setSelectedObjId(null); setClickPoints([]); }} />
          <ModeToggle mode={mode} onChange={setMode} />
        </div>

        {/* Image navigator */}
        <div
          style={{
            padding: "8px 16px",
            background: "#0f0f1e",
            borderBottom: "1px solid #1e1e3e",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <ImageNavigator
            images={images}
            currentIdx={currentIdx}
            onNavigate={handleNavigate}
            unsaved={unsaved}
          />
        </div>

        {/* Canvas area */}
        <div style={{ flex: 1, overflow: "hidden", background: "#111" }}>
          {imageUrl && imageMeta ? (
            <LabelCanvas
              imageUrl={imageUrl}
              imageW={imageMeta.w}
              imageH={imageMeta.h}
              objects={objects}
              selectedObjId={selectedObjId}
              clickPoints={clickPoints}
              onCanvasClick={handleCanvasClick}
              onObjectSelect={handleObjectSelect}
            />
          ) : (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#444",
                fontSize: 14,
              }}
            >
              {images.length === 0 ? "이미지가 없습니다" : "이미지 로딩 중..."}
            </div>
          )}
        </div>

        {/* Status bar */}
        {statusMsg && (
          <div
            style={{
              padding: "4px 16px",
              background: "#12121f",
              borderTop: "1px solid #1e1e3e",
              fontSize: 12,
              color: "#90a4ae",
            }}
          >
            {statusMsg}
          </div>
        )}
      </div>
    </div>
  );
}
