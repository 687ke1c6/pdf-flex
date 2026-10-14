// Freehand strokes: smooth rendering with optional pen pressure, and export to a trimmed canvas.
import { cleanUp } from "./signatureImage";

/** A sampled point in drawing-pad CSS pixels. `p` is pressure, 0–1 (0.5 for mouse and touch). */
export interface StrokePoint {
  x: number;
  y: number;
  p: number;
}
export type Stroke = StrokePoint[];

/** Line width at normal pressure, in pad CSS pixels. */
export const BASE_WIDTH = 2.6;
/** Export resolution relative to the pad's CSS size; a ~480 px pad exports about 1440 px wide. */
const EXPORT_SCALE = 3;

/** Width for a point: pen pressure varies it between about 0.4× and 1.6×; 0.5 (mouse) gives 1×. */
const widthAt = (pt: StrokePoint) => BASE_WIDTH * (0.4 + 1.2 * pt.p);
const mid = (a: StrokePoint, b: StrokePoint): StrokePoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2 });

/**
 * Draws strokes with `ctx` already scaled so one unit is one pad CSS pixel.
 * Curves pass through the midpoints between samples, using each sample as the
 * control point, which smooths out jitter. Segments are stroked separately so
 * their width can follow pressure.
 */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], color: string) {
  ctx.strokeStyle = ctx.fillStyle = color;
  ctx.lineCap = ctx.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke[0].x, stroke[0].y, widthAt(stroke[0]) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    let from = stroke[0];
    for (let i = 1; i < stroke.length; i++) {
      const last = i === stroke.length - 1;
      const to = last ? stroke[i] : mid(stroke[i], stroke[i + 1]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      if (last) ctx.lineTo(to.x, to.y);
      else ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, to.x, to.y);
      ctx.lineWidth = widthAt(stroke[i]);
      ctx.stroke();
      from = to;
    }
  }
}

/** Renders strokes at high resolution on a transparent canvas, trimmed to the ink; `null` if empty. */
export function exportStrokes(strokes: Stroke[], padWidth: number, padHeight: number, color: string): HTMLCanvasElement | null {
  if (!strokes.length) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(padWidth * EXPORT_SCALE);
  canvas.height = Math.ceil(padHeight * EXPORT_SCALE);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
  drawStrokes(ctx, strokes, color);
  return cleanUp(canvas, { removeBackground: false, threshold: 0 });
}
