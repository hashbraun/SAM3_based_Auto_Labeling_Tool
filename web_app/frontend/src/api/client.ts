const BASE = "/api";

export const CLASSES = ["사람", "강아지", "로봇", "휠체어"] as const;
export type ClassName = (typeof CLASSES)[number];

export const CLASS_COLORS: Record<ClassName, string> = {
  사람: "#4FC3F7",
  강아지: "#81C784",
  로봇: "#FFB74D",
  휠체어: "#CE93D8",
};

export interface ImageEntry {
  path: string;
  filename: string;
  saved: boolean;
}

export interface SamObject {
  obj_id: number;
  class_name: ClassName;
  polygons: number[][];
  click_count: number;
  from_box: boolean;
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
  listFolders: (root: string): Promise<{ path: string; folders: string[] }> =>
    request(`/project/folders?root=${encodeURIComponent(root)}`),

  listImages: (
    folder: string
  ): Promise<{ folder: string; images: ImageEntry[]; total: number }> =>
    request(`/project/images?folder=${encodeURIComponent(folder)}`),

  imageUrl: (imagePath: string): string =>
    `${BASE}/project/image?path=${encodeURIComponent(imagePath)}`,

  samClick: (
    imagePath: string,
    x: number,
    y: number,
    label: number,
    className: ClassName,
    objId = -1
  ): Promise<SamObject> =>
    request("/sam/click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_path: imagePath,
        x,
        y,
        label,
        class_name: className,
        obj_id: objId,
      }),
    }),

  getObjects: (
    imagePath: string
  ): Promise<{ objects: SamObject[]; saved: boolean }> =>
    request(`/sam/objects?image_path=${encodeURIComponent(imagePath)}`),

  deleteObject: (
    imagePath: string,
    objId: number
  ): Promise<{ ok: boolean }> =>
    request("/sam/object", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_path: imagePath, obj_id: objId }),
    }),

  clearObjects: (imagePath: string): Promise<{ ok: boolean }> =>
    request(`/sam/objects?image_path=${encodeURIComponent(imagePath)}`, {
      method: "DELETE",
    }),

  saveLabel: (
    imagePath: string,
    force = false
  ): Promise<{
    ok?: boolean;
    label_path?: string;
    object_count?: number;
    conflict?: boolean;
    message?: string;
  }> =>
    request("/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_path: imagePath, force }),
    }),
};
