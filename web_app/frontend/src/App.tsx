import { useEffect, useState } from "react";
import {
  api,
  CLASSES,
  ClassName,
  GuideObject,
  ImageEntry,
  SamObject,
} from "./api/client";
import ClassSelector from "./components/ClassSelector";
import GuidePanel from "./components/GuidePanel";
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
  const [savingAll, setSavingAll] = useState(false);
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

  // 키보드 단축키
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") { e.preventDefault(); handleSave(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); if (currentIdx < images.length - 1) handleNavigate(currentIdx + 1); }
      if (e.key === "ArrowLeft")  { e.preventDefault(); if (currentIdx > 0) handleNavigate(currentIdx - 1); }
      if (e.key === "f" || e.key === "F") { e.preventDefault(); handleNewObject(); }
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

  const handleSaveAll = async () => {
    setSavingAll(true);
    try {
      const r = await api.saveAll(true);
      if (projectFolder) {
        const result = await api.listImages(projectFolder);
        setImages(result.images);
      }
      if (currentImage) {
        api.getObjects(currentImage.path).then((res) => setSaved(res.saved));
      }
      setStatusMsg(`전체 저장 완료 — ${r.saved}장 저장, ${r.skipped}장 skip`);
    } catch (e) {
      setStatusMsg(`전체 저장 오류: ${e}`);
    } finally {
      setSavingAll(false);
    }
  };

  const handleNewObject = () => {
    setSelectedObjId(null);
    setClickPoints([]);
    setStatusMsg(`새 ${selectedClass} 객체 — 캔버스를 클릭하세요`);
  };

  // ─── Folder Browser ────────────────────────────────────────────────────────
  const [browserTab, setBrowserTab] = useState<"server" | "upload">("server");
  const [uploadFolderName, setUploadFolderName] = useState("");
  const [uploading, setUploading] = useState(false);

  // 업로드 탭 전용 폴더 탐색기
  const [uploadBrowsePath, setUploadBrowsePath] = useState("/nas03");
  const [uploadBrowseFolders, setUploadBrowseFolders] = useState<string[]>([]);
  const [uploadBrowseError, setUploadBrowseError] = useState("");
  const [uploadBrowseOpen, setUploadBrowseOpen] = useState(false);

  const browseUploadPath = async (path: string) => {
    setUploadBrowseError("");
    try {
      const result = await api.listFolders(path);
      setUploadBrowsePath(path);
      setUploadBrowseFolders(result.folders);
      setUploadBrowseOpen(true);
    } catch {
      setUploadBrowseError("폴더를 열 수 없습니다.");
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !uploadFolderName.trim()) return;
    setUploading(true);
    try {
      const result = await api.uploadImages(uploadFolderName.trim(), e.target.files);
      await handleSelectFolder(result.folder);
    } catch {
      setFolderError("업로드 실패");
    } finally {
      setUploading(false);
    }
  };

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

        {/* 탭 */}
        <div style={{ display: "flex", gap: 0, width: "100%", maxWidth: 600 }}>
          {(["server", "upload"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setBrowserTab(tab)}
              style={{
                flex: 1, padding: "8px 0", fontSize: 13, cursor: "pointer", border: "none",
                background: browserTab === tab ? "#1565C0" : "#1a1a2e",
                color: browserTab === tab ? "#fff" : "#888",
                borderBottom: browserTab === tab ? "2px solid #42a5f5" : "2px solid transparent",
              }}
            >
              {tab === "server" ? "서버 폴더" : "내 PC 업로드"}
            </button>
          ))}
        </div>

        {browserTab === "upload" ? (
          <div style={{ width: "100%", maxWidth: 600, background: "#1a1a2e", borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            {/* 저장 경로 선택 */}
            <div style={{ color: "#aaa", fontSize: 13 }}>
              저장 경로
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input
                  value={uploadFolderName}
                  onChange={(e) => setUploadFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && browseUploadPath(uploadFolderName || uploadBrowsePath)}
                  placeholder="/nas03/1_EV_LABELING/my_folder"
                  style={{ flex: 1, padding: "8px 12px", background: "#111", border: `1px solid ${uploadFolderName.trim() ? "#1565C0" : "#333"}`, borderRadius: 6, color: "#ddd", fontSize: 13, boxSizing: "border-box" }}
                />
                <button
                  onClick={() => browseUploadPath(uploadFolderName.trim() || uploadBrowsePath)}
                  style={{ padding: "8px 12px", background: "#1565C0", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
                >
                  탐색
                </button>
              </div>
            </div>

            {/* 인라인 폴더 탐색기 */}
            {uploadBrowseOpen && (
              <div style={{ background: "#111", border: "1px solid #2a2a4e", borderRadius: 8, overflow: "hidden" }}>
                {/* 경로 헤더 */}
                <div style={{ padding: "8px 12px", background: "#0d0d1a", borderBottom: "1px solid #2a2a4e", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#888", fontSize: 11, flex: 1, wordBreak: "break-all" }}>{uploadBrowsePath}</span>
                  {uploadBrowsePath !== "/" && (
                    <button
                      onClick={() => browseUploadPath(uploadBrowsePath.split("/").slice(0, -1).join("/") || "/")}
                      style={{ padding: "2px 8px", background: "none", color: "#90caf9", border: "1px solid #2a4a6a", borderRadius: 4, cursor: "pointer", fontSize: 11, whiteSpace: "nowrap" }}
                    >
                      ↑ 상위
                    </button>
                  )}
                </div>

                {/* 현재 폴더 선택 */}
                <div
                  onClick={() => { setUploadFolderName(uploadBrowsePath); setUploadBrowseOpen(false); }}
                  style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #1e1e3e", color: "#81c784", fontSize: 12, fontWeight: 600 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#1a2a1a")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  ✓ 여기에 저장: {uploadBrowsePath.split("/").pop() || "/"}
                </div>

                {/* 하위 폴더 목록 */}
                <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  {uploadBrowseFolders.length === 0 ? (
                    <div style={{ padding: "12px", color: "#555", fontSize: 12, textAlign: "center" }}>하위 폴더 없음</div>
                  ) : (
                    uploadBrowseFolders.map((f) => (
                      <div
                        key={f}
                        style={{ padding: "7px 12px", cursor: "pointer", borderBottom: "1px solid #1a1a2e", fontSize: 12, color: "#ccc", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#1a1a3e")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <span onClick={() => browseUploadPath(f)}>📁 {f.split("/").pop()}</span>
                        <button
                          onClick={() => { setUploadFolderName(f); setUploadBrowseOpen(false); }}
                          style={{ padding: "2px 8px", background: "#1565C0", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                        >
                          선택
                        </button>
                      </div>
                    ))
                  )}
                </div>
                {uploadBrowseError && <div style={{ padding: "8px 12px", color: "#ef5350", fontSize: 12 }}>{uploadBrowseError}</div>}
              </div>
            )}

            {/* 파일 선택 */}
            <label style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "20px", border: "2px dashed #2a2a5e", borderRadius: 8,
              cursor: uploadFolderName.trim() ? "pointer" : "not-allowed",
              color: uploadFolderName.trim() ? "#90caf9" : "#555",
              fontSize: 13, gap: 8,
            }}>
              {uploading ? "업로드 중..." : "📁 이미지 파일 선택 (여러 개 가능)"}
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.bmp,.webp"
                multiple
                disabled={!uploadFolderName.trim() || uploading}
                onChange={handleUpload}
                style={{ display: "none" }}
              />
            </label>
            {uploadFolderName.trim() && (
              <div style={{ color: "#555", fontSize: 11 }}>저장 위치: {uploadFolderName}</div>
            )}
            {folderError && <div style={{ color: "#ef5350", fontSize: 13 }}>{folderError}</div>}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, width: "100%", maxWidth: 600 }}>
              <input
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleFolderBrowse()}
                style={{
                  flex: 1, padding: "8px 12px", background: "#1a1a2e",
                  border: "1px solid #3a3a5e", borderRadius: 6, color: "#ddd", fontSize: 13,
                }}
              />
              <button
                onClick={handleFolderBrowse}
                disabled={loading}
                style={{ padding: "8px 16px", background: "#1565C0", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
              >
                탐색
              </button>
            </div>

            {folderError && <div style={{ color: "#ef5350", fontSize: 13 }}>{folderError}</div>}

            {subFolders.length > 0 && (
              <div style={{ width: "100%", maxWidth: 600, background: "#1a1a2e", border: "1px solid #2a2a4e", borderRadius: 8, maxHeight: 320, overflowY: "auto" }}>
                <div
                  onClick={() => handleSelectFolder(folderInput)}
                  style={{ padding: "10px 16px", cursor: "pointer", borderBottom: "1px solid #2a2a4e", color: "#90caf9", fontSize: 13, fontWeight: 600 }}
                >
                  📂 현재 폴더 열기: {folderInput}
                </div>
                {subFolders.map((f) => (
                  <div
                    key={f}
                    style={{ padding: "8px 16px", cursor: "pointer", borderBottom: "1px solid #1e1e3e", fontSize: 13, color: "#ccc", display: "flex", justifyContent: "space-between" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#252540")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span
                      onClick={async () => {
                        setFolderInput(f);
                        try {
                          const result = await api.listFolders(f);
                          setSubFolders(result.folders);
                        } catch {
                          setSubFolders([]);
                        }
                      }}
                    >
                      📁 {f.split("/").pop()}
                    </span>
                    <button
                      onClick={() => handleSelectFolder(f)}
                      style={{ padding: "2px 10px", background: "#1565C0", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 11 }}
                    >
                      열기
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const handleGuideAccept = async (guideObjects: GuideObject[]) => {
    if (!currentImage) return;
    const payload = guideObjects.map((o) => ({ class_name: o.class_name, polygon: o.polygon }));
    try {
      await api.guideAccept(currentImage.path, payload);
      const r = await api.getObjects(currentImage.path);
      setObjects(r.objects);
      setSaved(false);
      setStatusMsg(`Guide 객체 ${guideObjects.length}개 적용됨`);
    } catch (e) {
      setStatusMsg(`Guide 적용 오류: ${e}`);
    }
  };

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
          <ModeToggle mode={mode} onChange={setMode} yoloAvailable={true} />
          <button
            onClick={handleSaveAll}
            disabled={savingAll}
            style={{
              marginLeft: "auto",
              padding: "4px 14px",
              background: "#1565C0",
              color: "#90caf9",
              border: "1px solid #1976D2",
              borderRadius: 6,
              cursor: savingAll ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {savingAll ? "저장 중..." : "전체 저장"}
          </button>
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

      {/* YOLO Guide 우측 패널 */}
      {mode === "yolo_guide" && (
        <div
          style={{
            width: 220,
            background: "#12121f",
            borderLeft: "1px solid #2a2a3e",
            overflowY: "auto",
            padding: 12,
            flexShrink: 0,
          }}
        >
          <GuidePanel
            imagePath={currentImage?.path ?? ""}
            folder={projectFolder ?? ""}
            onAccept={handleGuideAccept}
            onBatchDone={() => {
              if (currentImage) {
                api.getObjects(currentImage.path).then((r) => {
                  setObjects(r.objects);
                  setSaved(r.saved);
                });
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
