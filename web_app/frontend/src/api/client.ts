const BASE = "/api";

export interface ImageInfo {
  id: string;
  filename: string;
  status: "pending" | "labeled" | "done";
}

export interface DetectionResult {
  det_idx: number;
  class_name: string;
  bbox: [number, number, number, number];
  polygons: number[][];
}

export interface LabelRequest {
  text_prompt: string;
  box_threshold: number;
  text_threshold: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, init);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  return res.json() as Promise<T>;
}

export const api = {
  uploadImages: (files: File[]): Promise<ImageInfo[]> => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    return request("/upload", { method: "POST", body: fd });
  },

  listImages: (): Promise<ImageInfo[]> => request("/images"),

  labelImage: (id: string, req: LabelRequest): Promise<{ detections: DetectionResult[] }> =>
    request(`/label/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),

  getLabelResult: (id: string): Promise<{ detections: DetectionResult[] }> =>
    request(`/label/${id}`),

  startBatch: (req: LabelRequest): Promise<{ ok: boolean }> =>
    request("/label/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),

  getBatchStatus: (): Promise<{ running: boolean; total: number; done: number; failed: number; current: string }> =>
    request("/label/batch"),

  addPoint: (
    imageId: string,
    detIdx: number,
    x: number,
    y: number,
    label: 0 | 1
  ): Promise<{ det_idx: number; polygons: number[][]; point_count: number }> =>
    request(`/correct/${imageId}/${detIdx}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y, label }),
    }),

  resetCorrection: (
    imageId: string,
    detIdx: number
  ): Promise<{ det_idx: number; polygons: number[][]; point_count: number }> =>
    request(`/correct/${imageId}/${detIdx}`, { method: "DELETE" }),

  deleteDetection: (
    imageId: string,
    detIdx: number
  ): Promise<{ detections: DetectionResult[] }> =>
    request(`/label/${imageId}/${detIdx}`, { method: "DELETE" }),

  exportImage: (id: string): Promise<{ ok: boolean; lines: number }> =>
    request(`/export/${id}`, { method: "POST" }),

  exportAll: (): Promise<{ ok: boolean; saved: number }> =>
    request("/export/all", { method: "POST" }),

  exportZipUrl: (): string => `${BASE}/export/zip`,

  deleteImage: (id: string): Promise<{ ok: boolean }> =>
    request(`/images/${id}`, { method: "DELETE" }),
};
