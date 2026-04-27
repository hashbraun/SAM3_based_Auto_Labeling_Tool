import { useEffect, useRef, useState } from "react";
import { DetectionResult } from "../api/client";

interface Point {
  x: number;
  y: number;
  label: 0 | 1;
}

interface Props {
  imageUrl: string;
  imageW: number;
  imageH: number;
  detections: DetectionResult[];
  selectedDetIdx: number | null;
  points: Point[];
  onCanvasClick: (x: number, y: number, label: 0 | 1) => void;
  onDetectionSelect: (detIdx: number) => void;
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

function findHitDetection(nx: number, ny: number, detections: DetectionResult[]): number | null {
  for (const det of detections) {
    for (const poly of det.polygons) {
      if (poly.length >= 4 && pointInPolygon(nx, ny, poly)) return det.det_idx;
    }
  }
  return null;
}

const COLORS = [
  [100, 200, 255],
  [100, 255, 150],
  [255, 180, 100],
  [220, 100, 255],
  [255, 100, 130],
];

export default function LabelCanvas({
  imageUrl,
  imageW,
  imageH,
  detections,
  selectedDetIdx,
  points,
  onCanvasClick,
  onDetectionSelect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // Track container dimensions via ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      setContainerSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const canvasW = containerSize.w;
  const canvasH = containerSize.h;

  // Scale image to fit canvas while preserving aspect ratio
  const scale = canvasW > 0 && canvasH > 0
    ? Math.min(canvasW / imageW, canvasH / imageH)
    : 1;
  const drawW = imageW * scale;
  const drawH = imageH * scale;
  const offsetX = (canvasW - drawW) / 2;
  const offsetY = (canvasH - drawH) / 2;

  const toCanvas = (nx: number, ny: number): [number, number] => [
    offsetX + nx * drawW,
    offsetY + ny * drawH,
  ];

  const toImage = (cx: number, cy: number): [number, number] => [
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

      // Draw detection polygons
      detections.forEach((det) => {
        const [r, g, b] = COLORS[det.det_idx % COLORS.length];
        const isSelected = det.det_idx === selectedDetIdx;

        ctx.fillStyle = `rgba(${r},${g},${b},${isSelected ? 0.5 : 0.3})`;
        ctx.strokeStyle = `rgba(${r},${g},${b},${isSelected ? 1.0 : 0.8})`;
        ctx.lineWidth = isSelected ? 2.5 : 1.5;

        det.polygons.forEach((poly) => {
          if (poly.length < 4) return;
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
        });

        // Bbox dashed outline for selected detection
        if (isSelected) {
          const [bx1, by1, bx2, by2] = det.bbox;
          const [cx1, cy1] = toCanvas(bx1 / imageW, by1 / imageH);
          const [cx2, cy2] = toCanvas(bx2 / imageW, by2 / imageH);
          ctx.strokeStyle = `rgb(${r},${g},${b})`;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 3]);
          ctx.strokeRect(cx1, cy1, cx2 - cx1, cy2 - cy1);
          ctx.setLineDash([]);
        }
      });

      // Draw correction points
      points.forEach(({ x, y, label }) => {
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
      });
    };
    img.src = imageUrl;

    return () => { cancelled = true; };
  }, [imageUrl, detections, selectedDetIdx, points, canvasW, canvasH, drawW, drawH, offsetX, offsetY, imageW, imageH]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvasW / rect.width);
    const cy = (e.clientY - rect.top) * (canvasH / rect.height);

    // 정규화 좌표로 polygon hit test
    const nx = (cx - offsetX) / drawW;
    const ny = (cy - offsetY) / drawH;
    const hitIdx = findHitDetection(nx, ny, detections);

    if (hitIdx !== null && hitIdx !== selectedDetIdx) {
      // 다른 detection 클릭 → 선택만
      onDetectionSelect(hitIdx);
      return;
    }

    // 선택된 detection이 있을 때만 포인트 추가
    if (selectedDetIdx === null) return;
    const [ix, iy] = toImage(cx, cy);
    if (ix < 0 || iy < 0 || ix >= imageW || iy >= imageH) return;
    onCanvasClick(ix, iy, e.button === 2 ? 0 : 1);
  };

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        width={canvasW}
        height={canvasH}
        style={{ display: "block", cursor: selectedDetIdx !== null ? "crosshair" : "default" }}
        onMouseDown={handleMouseDown}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
