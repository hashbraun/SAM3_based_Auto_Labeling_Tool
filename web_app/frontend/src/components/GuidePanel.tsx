import { useEffect, useRef, useState } from "react";
import { api, type GuideObject, type TrainStatus } from "../api/client";

interface BatchStatus {
  running: boolean;
  progress: number;
  total: number;
  current_image: string;
  accepted: number;
  skipped: number;
  error: string;
}

interface Props {
  imagePath: string;
  folder: string;
  onAccept: (objects: GuideObject[]) => void;
  onBatchDone?: () => void;
}

export default function GuidePanel({ imagePath, folder, onAccept, onBatchDone }: Props) {
  const [models, setModels] = useState<{ name: string; path: string; map50: number; created_at: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [conf, setConf] = useState(0.3);
  const [inferring, setInferring] = useState(false);
  const [guideObjects, setGuideObjects] = useState<GuideObject[]>([]);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");

  const [trainStatus, setTrainStatus] = useState<TrainStatus | null>(null);
  const [trainOpen, setTrainOpen] = useState(false);
  const [epochs, setEpochs] = useState(50);
  const [imgsz, setImgsz] = useState(1280);
  const [batch, setBatch] = useState(4);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);


  useEffect(() => {
    api.listModels().then((r) => {
      setModels(r.models);
      if (r.models.length > 0 && !selectedModel) setSelectedModel(r.models[0].path);
    });
    fetchStatus();
  }, []);

  useEffect(() => {
    if (trainStatus?.running || trainStatus?.pending) {
      pollRef.current = setInterval(fetchStatus, 15000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [trainStatus?.running, trainStatus?.pending]);

  async function fetchStatus() {
    try {
      const s = await api.getTrainStatus();
      setTrainStatus(s);
      if (!s.running && !s.pending) {
        api.listModels().then((r) => {
          setModels(r.models);
          if (r.models.length > 0 && !selectedModel) setSelectedModel(r.models[0].path);
        });
      }
    } catch {}
  }

  async function handleStartTrain() {
    try {
      await api.startTraining({ epochs, imgsz, batch });
      await fetchStatus();
    } catch (e: any) { setError(e.message); }
  }

  async function handleStopTrain() {
    await api.stopTraining();
    await fetchStatus();
  }

  async function handleInfer() {
    if (!selectedModel || !imagePath) return;
    setInferring(true);
    setError("");
    try {
      const r = await api.guideInfer(imagePath, selectedModel, conf);
      setGuideObjects(r.objects);
      setAccepted(new Set(r.objects.map((_: any, i: number) => i)));
    } catch (e: any) { setError(e.message); }
    finally { setInferring(false); }
  }

  async function handleInferAll() {
    if (!selectedModel || !folder) return;
    setError("");
    try {
      await api.guideInferAll(folder, selectedModel, conf);
      batchPollRef.current = setInterval(async () => {
        const s = await api.getInferAllStatus();
        setBatchStatus(s);
        if (!s.running) {
          clearInterval(batchPollRef.current!);
          batchPollRef.current = null;
          onBatchDone?.();
        }
      }, 1500);
    } catch (e: any) { setError(e.message); }
  }

  function handleAcceptSelected() {
    const selected = guideObjects.filter((_, i) => accepted.has(i));
    onAccept(selected);
    setGuideObjects([]);
    setAccepted(new Set());
  }

  const isTraining = trainStatus?.running || trainStatus?.pending;
  const batchDone = batchStatus && !batchStatus.running;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 0" }}>

      {/* ── 공유 설정: 모델 + Confidence ── */}
      <div style={{ background: "#1a1a2e", borderRadius: 8, padding: 12 }}>
        <div style={{ color: "#90CAF9", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>설정</div>
        <label style={labelStyle}>
          모델
          <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
            {models.length === 0 && <option value="">학습된 모델 없음</option>}
            {models.map((m) => (
              <option key={m.path} value={m.path}>{m.name} (mAP50={m.map50})</option>
            ))}
          </select>
        </label>
        <label style={{ ...labelStyle, marginTop: 6 }}>
          <span style={{ whiteSpace: "nowrap" }}>Conf {conf.toFixed(2)}</span>
          <input
            type="range" min={0.05} max={0.95} step={0.05}
            value={conf}
            onChange={(e) => setConf(+e.target.value)}
            style={{ flex: 1 }}
          />
        </label>
        <div style={{ color: "#555", fontSize: 10, marginTop: 4 }}>현재 이미지 · 전체 폴더 모두 적용</div>
      </div>

      {/* ── 현재 이미지 Guide ── */}
      <div style={{ background: "#1a1a2e", borderRadius: 8, padding: 12 }}>
        <div style={{ color: "#90CAF9", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>현재 이미지 Guide</div>
        <button onClick={handleInfer} disabled={!selectedModel || !imagePath || inferring} style={btnStyle("#37474F")}>
          {inferring ? "추론 중..." : "Guide 실행"}
        </button>
      </div>

      {/* 결과 accept/reject */}
      {guideObjects.length > 0 && (
        <div style={{ background: "#1a1a2e", borderRadius: 8, padding: 12 }}>
          <div style={{ color: "#90CAF9", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
            결과 선택 ({accepted.size}/{guideObjects.length})
          </div>
          <div style={{ maxHeight: 140, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {guideObjects.map((obj, i) => (
              <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={accepted.has(i)}
                  onChange={() => {
                    const next = new Set(accepted);
                    if (next.has(i)) next.delete(i); else next.add(i);
                    setAccepted(next);
                  }}
                />
                <span style={{ color: "#ccc" }}>{obj.class_name} ({(obj.confidence * 100).toFixed(0)}%)</span>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button onClick={handleAcceptSelected} style={btnStyle("#2E7D32")} disabled={accepted.size === 0}>선택 적용</button>
            <button onClick={() => setGuideObjects([])} style={btnStyle("#37474F")}>취소</button>
          </div>
        </div>
      )}

      {/* ── 전체 폴더 Guide ── */}
      <div style={{ background: "#1a1a2e", borderRadius: 8, padding: 12 }}>
        <div style={{ color: "#90CAF9", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>전체 폴더 Guide</div>

        {batchStatus?.running ? (
          <>
            <div style={{ color: "#aaa", fontSize: 11, marginBottom: 4 }}>{batchStatus.current_image || "처리 중..."}</div>
            <div style={{ background: "#111", borderRadius: 4, height: 6, marginBottom: 6 }}>
              <div style={{ background: "#4CAF50", height: "100%", borderRadius: 4, width: `${batchStatus.total ? (batchStatus.progress / batchStatus.total) * 100 : 0}%`, transition: "width 0.3s" }} />
            </div>
            <div style={{ color: "#888", fontSize: 11 }}>{batchStatus.progress}/{batchStatus.total} · 추가 {batchStatus.accepted} · skip {batchStatus.skipped}</div>
          </>
        ) : (
          <>
            {batchDone && (
              <div style={{ color: "#81C784", fontSize: 11, marginBottom: 6 }}>
                완료: {batchStatus!.total}장 · 추가 {batchStatus!.accepted}개 · skip {batchStatus!.skipped}개
              </div>
            )}
            <button onClick={handleInferAll} disabled={!selectedModel || !folder} style={btnStyle("#37474F")}>
              {batchDone ? "다시 실행" : "전체 Guide 실행"}
            </button>
          </>
        )}

        {batchStatus?.error && <div style={{ color: "#ef9a9a", fontSize: 11, marginTop: 4 }}>{batchStatus.error}</div>}
      </div>

      {/* ── YOLO 학습 (접힘) ── */}
      <div style={{ background: "#1a1a2e", borderRadius: 8, overflow: "hidden" }}>
        <button
          onClick={() => setTrainOpen((v) => !v)}
          style={{ width: "100%", padding: "10px 12px", background: "none", border: "none", color: "#607D8B", fontSize: 12, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <span>YOLO 재학습</span>
          <span>{trainOpen ? "▲" : "▼"}</span>
        </button>
        {trainOpen && (
          <div style={{ padding: "0 12px 12px" }}>
            {isTraining ? (
              <>
                <div style={{ color: "#aaa", fontSize: 11, marginBottom: 4 }}>
                  {trainStatus?.pending ? "대기 중..." : `에폭 ${trainStatus?.epoch} / ${trainStatus?.total_epochs}`}
                </div>
                {trainStatus?.metrics?.mAP50 != null && (
                  <div style={{ color: "#81C784", fontSize: 11 }}>mAP50: {trainStatus.metrics.mAP50}</div>
                )}
                <div style={{ background: "#111", borderRadius: 4, height: 6, marginTop: 6 }}>
                  <div style={{ background: "#4CAF50", height: "100%", borderRadius: 4, width: `${trainStatus?.total_epochs ? (trainStatus.epoch / trainStatus.total_epochs) * 100 : 0}%`, transition: "width 0.5s" }} />
                </div>
                <button onClick={handleStopTrain} style={btnStyle("#c62828")}>학습 중지</button>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={labelStyle}>Epochs<input type="number" value={epochs} min={1} max={300} onChange={(e) => setEpochs(+e.target.value)} style={inputStyle} /></label>
                <label style={labelStyle}>Image Size
                  <select value={imgsz} onChange={(e) => setImgsz(+e.target.value)} style={inputStyle}>
                    {[640, 1280, 1920].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>Batch<input type="number" value={batch} min={1} max={32} onChange={(e) => setBatch(+e.target.value)} style={inputStyle} /></label>
                <button onClick={handleStartTrain} style={btnStyle("#1565C0")}>학습 시작 (sbatch)</button>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <div style={{ color: "#ef9a9a", fontSize: 11 }}>{error}</div>}
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#aaa" };
const inputStyle: React.CSSProperties = { background: "#111", color: "#eee", border: "1px solid #333", borderRadius: 4, padding: "2px 6px", fontSize: 12, width: 80 };
function btnStyle(bg: string): React.CSSProperties {
  return { marginTop: 4, width: "100%", padding: "6px 0", background: bg, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 };
}
