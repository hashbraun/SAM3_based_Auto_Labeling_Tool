import { useEffect, useRef, useState } from "react";
import { CLASS_COLORS, ClassName, SamObject } from "../api/client";

interface ClickPoint {
  x: number;
  y: number;
  label: 0 | 1;
}

interface Props {
  imageUrl: string;
  imageW: number;
  imageH: number;
  objects: SamObject[];
  selectedObjId: number | null;
  clickPoints: ClickPoint[];
  onCanvasClick: (x: number, y: number, label: 0 | 1) => void;
  onObjectSelect: (objId: number) => void;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function pointInPolygon(nx: number, ny: number, poly: number[]): boolean {
  const n = poly.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], yi = poly[i * 2 + 1];
    const xj = poly[j * 2], yj = poly[j * 2 + 1];
    if ((yi > ny) !== (yj > ny) && nx < ((xj - xi) * (ny - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function hitTest(nx: number, ny: number, objects: SamObject[]): number | null {
  for (const obj of objects) {
    for (const poly of obj.polygons) {
      if (poly.length >= 4 && pointInPolygon(nx, ny, poly)) return obj.obj_id;
    }
  }
  return null;
}

export default function LabelCanvas({
  imageUrl,
  imageW,
  imageH,
  objects,
  selectedObjId,
  clickPoints,
  onCanvasClick,
  onObjectSelect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const { w: canvasW, h: canvasH } = size;
  const scale = canvasW > 0 && canvasH > 0 ? Math.min(canvasW / imageW, canvasH / imageH) : 1;
  const drawW = imageW * scale;
  const drawH = imageH * scale;
  const offsetX = (canvasW - drawW) / 2;
  const offsetY = (canvasH - drawH) / 2;

  const toCanvas = (nx: number, ny: number): [number, number] => [
    offsetX + nx * drawW,
    offsetY + ny * drawH,
  ];

  const toImagePixel = (cx: number, cy: number): [number, number] => [
    Math.round(((cx - offsetX) / drawW) * imageW),
    Math.round(((cy - offsetY) / drawH) * imageH),
  ];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasW === 0 || canvasH === 0) return;
    const ctx = canvas.getContext("2d")!;
    let cancelled = false;

    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      ctx.clearRect(0, 0, canvasW, canvasH);
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

      for (const obj of objects) {
        const color = CLASS_COLORS[obj.class_name as ClassName] ?? "#ffffff";
        const [r, g, b] = hexToRgb(color);
        const isSelected = obj.obj_id === selectedObjId;

        ctx.fillStyle = `rgba(${r},${g},${b},${isSelected ? 0.45 : 0.25})`;
        ctx.strokeStyle = `rgba(${r},${g},${b},${isSelected ? 1.0 : 0.7})`;
        ctx.lineWidth = isSelected ? 2.5 : 1.5;

        for (const poly of obj.polygons) {
          if (poly.length < 4) continue;
          const path = new Path2D();
          const [x0, y0] = toCanvas(poly[0], poly[1]);
          path.moveTo(x0, y0);
          for (let i = 2; i < poly.length; i += 2) {
            const [px, py] = toCanvas(poly[i], poly[i + 1]);
            path.lineTo(px, py);
          }
          path.closePath();
          ctx.fill(path);
          ctx.stroke(path);
        }

        // Label text above first polygon centroid
        if (obj.polygons.length > 0 && obj.polygons[0].length >= 2) {
          const poly = obj.polygons[0];
          let sumX = 0, sumY = 0, count = poly.length / 2;
          for (let i = 0; i < poly.length; i += 2) {
            sumX += poly[i]; sumY += poly[i + 1];
          }
          const [lx, ly] = toCanvas(sumX / count, sumY / count);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.font = `bold ${isSelected ? 14 : 12}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(obj.class_name, lx, ly);
        }
      }

      // Draw click correction points
      for (const { x, y, label } of clickPoints) {
        const [cx, cy] = toCanvas(x / imageW, y / imageH);
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.fillStyle = label === 1 ? "#00e676" : "#ff1744";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label === 1 ? "+" : "−", cx, cy);
      }
    };
    img.src = imageUrl;
    return () => { cancelled = true; };
  }, [imageUrl, objects, selectedObjId, clickPoints, canvasW, canvasH, drawW, drawH, offsetX, offsetY, imageW, imageH]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvasW / rect.width);
    const cy = (e.clientY - rect.top) * (canvasH / rect.height);
    const nx = (cx - offsetX) / drawW;
    const ny = (cy - offsetY) / drawH;

    const hitId = hitTest(nx, ny, objects);
    if (hitId !== null && hitId !== selectedObjId) {
      onObjectSelect(hitId);
      return;
    }

    const [ix, iy] = toImagePixel(cx, cy);
    if (ix < 0 || iy < 0 || ix >= imageW || iy >= imageH) return;
    onCanvasClick(ix, iy, e.button === 2 ? 0 : 1);
  };

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        width={canvasW}
        height={canvasH}
        style={{
          display: "block",
          cursor: "crosshair",
        }}
        onMouseDown={handleMouseDown}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
