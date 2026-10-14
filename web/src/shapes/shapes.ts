// Shapes and symbols: their paths, and their geometry while drawing. One path
// builder serves the on-screen preview (SVG) and what `pdf-stamp` draws, so
// they match. Paths are in points from the box's bottom-left corner, y up.

import type { Box, Point } from "../document/placement";

export const SHAPE_KINDS = ["rect", "ellipse", "line", "check", "cross", "dot", "circle"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const SYMBOLS = ["check", "cross", "dot", "circle"] as const satisfies ShapeKind[];
export const isSymbol = (shape: ShapeKind) => (SYMBOLS as readonly ShapeKind[]).includes(shape);

export interface ShapeStyle {
  /** Outline colour (`#rrggbb`), or none. Symbols are drawn in this colour. */
  stroke: string | null;
  /** Outline width in points. */
  strokeWidth: number;
  /** Fill colour, or none. */
  fill: string | null;
}

export const DEFAULT_SHAPE_STYLE: ShapeStyle = { stroke: "#000000", strokeWidth: 2, fill: null };
export const MIN_STROKE = 0.5;
export const MAX_STROKE = 20;

/** A path step, as `pdf-stamp`'s `Segment` (serde: tagged by `op`). */
export type Segment =
  | { op: "M"; x: number; y: number }
  | { op: "L"; x: number; y: number }
  | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: "Z" };

export interface Drawing {
  path: Segment[];
  stroke: { color: string; width: number } | null;
  fill: string | null;
  /** Round line caps and joins. */
  rounded: boolean;
}

/** Bézier handle length for a quarter circle. */
const K = 0.5522847498;

function ellipse(x0: number, y0: number, x1: number, y1: number): Segment[] {
  const [cx, cy, rx, ry] = [(x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2];
  return [
    { op: "M", x: cx + rx, y: cy },
    { op: "C", x1: cx + rx, y1: cy + K * ry, x2: cx + K * rx, y2: cy + ry, x: cx, y: cy + ry },
    { op: "C", x1: cx - K * rx, y1: cy + ry, x2: cx - rx, y2: cy + K * ry, x: cx - rx, y: cy },
    { op: "C", x1: cx - rx, y1: cy - K * ry, x2: cx - K * rx, y2: cy - ry, x: cx, y: cy - ry },
    { op: "C", x1: cx + K * rx, y1: cy - ry, x2: cx + rx, y2: cy - K * ry, x: cx + rx, y: cy },
    { op: "Z" },
  ];
}

const rect = (x0: number, y0: number, x1: number, y1: number): Segment[] => [
  { op: "M", x: x0, y: y0 },
  { op: "L", x: x1, y: y0 },
  { op: "L", x: x1, y: y1 },
  { op: "L", x: x0, y: y1 },
  { op: "Z" },
];

/**
 * What to draw for a shape in a `width` × `height` box. Outlines are inset by
 * half their width, so the whole shape stays inside its box. A line runs
 * between its `ends` (relative to the box).
 */
export function drawing(shape: ShapeKind, style: ShapeStyle, width: number, height: number, ends?: [Point, Point]): Drawing {
  const color = style.stroke ?? style.fill ?? "#000000";
  // Symbols are drawn on a unit square, scaled to the box, with a weight that follows their size.
  const unit = (points: [number, number][]): Segment[] =>
    points.map(([x, y], i) => ({ op: i ? "L" : "M", x: x * width, y: y * height }) as Segment);
  const weight = Math.min(width, height) * 0.12;

  switch (shape) {
    case "rect":
    case "ellipse": {
      const stroke = style.stroke ? { color: style.stroke, width: style.strokeWidth } : null;
      const inset = Math.min(stroke ? stroke.width / 2 : 0, width / 2, height / 2);
      const build = shape === "rect" ? rect : ellipse;
      return { path: build(inset, inset, width - inset, height - inset), stroke, fill: style.fill, rounded: false };
    }
    case "line": {
      const [a, b] = ends ?? [
        { x: 0, y: 0 },
        { x: width, y: height },
      ];
      return {
        path: [
          { op: "M", x: a.x, y: a.y },
          { op: "L", x: b.x, y: b.y },
        ],
        // A line is nothing without its outline.
        stroke: { color: style.stroke ?? "#000000", width: style.strokeWidth },
        fill: null,
        rounded: true,
      };
    }
    case "check":
      return { path: unit([[0.12, 0.52], [0.4, 0.22], [0.88, 0.8]]), stroke: { color, width: weight }, fill: null, rounded: true };
    case "cross":
      return {
        path: [...unit([[0.18, 0.18], [0.82, 0.82]]), ...unit([[0.18, 0.82], [0.82, 0.18]])],
        stroke: { color, width: weight },
        fill: null,
        rounded: true,
      };
    case "dot":
      return { path: ellipse(0.1 * width, 0.1 * height, 0.9 * width, 0.9 * height), stroke: null, fill: color, rounded: false };
    case "circle": {
      const w = Math.min(width, height) * 0.1;
      const [ix, iy] = [0.1 * width + w / 2, 0.1 * height + w / 2];
      return { path: ellipse(ix, iy, width - ix, height - iy), stroke: { color, width: w }, fill: null, rounded: false };
    }
  }
}

/** The path as SVG path data, in a box `height` points tall (SVG's y points down). */
export function svgPath(path: Segment[], height: number): string {
  const y = (v: number) => height - v;
  return path
    .map((s) => {
      switch (s.op) {
        case "M":
        case "L":
          return `${s.op}${s.x} ${y(s.y)}`;
        case "C":
          return `C${s.x1} ${y(s.y1)} ${s.x2} ${y(s.y2)} ${s.x} ${y(s.y)}`;
        case "Z":
          return "Z";
      }
    })
    .join("");
}

/** Space around a line inside its box, so it's easy to grab and its caps aren't cut off. */
const linePad = (strokeWidth: number) => strokeWidth / 2 + 4;

/** The box and box-relative ends for a line between two page points. */
export function lineBox(a: Point, b: Point, strokeWidth: number): { box: Box; ends: [Point, Point] } {
  const pad = linePad(strokeWidth);
  const x = Math.min(a.x, b.x) - pad;
  const y = Math.min(a.y, b.y) - pad;
  return {
    box: { x, y, width: Math.abs(a.x - b.x) + 2 * pad, height: Math.abs(a.y - b.y) + 2 * pad },
    ends: [
      { x: a.x - x, y: a.y - y },
      { x: b.x - x, y: b.y - y },
    ],
  };
}

/** A line's ends as page points. */
export const lineEnds = (box: Box, ends: [Point, Point]): [Point, Point] => [
  { x: box.x + ends[0].x, y: box.y + ends[0].y },
  { x: box.x + ends[1].x, y: box.y + ends[1].y },
];

/** Snaps `to` so the line from `from` is horizontal, vertical or at 45°. */
export function snapAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(dx, dy);
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

/** Smallest side of a drawn shape, in points. */
const MIN_DRAWN = 2;

/** Default sizes, in points, for a shape added with a click. */
const CLICK_SIZE: Record<ShapeKind, [number, number]> = {
  rect: [120, 60],
  ellipse: [100, 70],
  line: [120, 0],
  check: [12, 12],
  cross: [12, 12],
  dot: [12, 12],
  circle: [12, 12],
};

/** The shape added by a click at `at`: a default size, centred there. */
export function clickGeometry(shape: ShapeKind, at: Point, strokeWidth: number): { box: Box; ends?: [Point, Point] } {
  const [w, h] = CLICK_SIZE[shape];
  if (shape === "line") return lineBox({ x: at.x - w / 2, y: at.y }, { x: at.x + w / 2, y: at.y }, strokeWidth);
  return { box: { x: at.x - w / 2, y: at.y - h / 2, width: w, height: h } };
}

/**
 * The shape drawn by dragging from `start` to `current`. With `constrain`
 * (Shift), rectangles and ellipses are square and lines snap to 45°. Symbols
 * are always square.
 */
export function dragGeometry(
  shape: ShapeKind,
  start: Point,
  current: Point,
  constrain: boolean,
  strokeWidth: number,
): { box: Box; ends?: [Point, Point] } {
  if (shape === "line") return lineBox(start, constrain ? snapAngle(start, current) : current, strokeWidth);
  let dx = current.x - start.x;
  let dy = current.y - start.y;
  if (constrain || isSymbol(shape)) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  // Never flat: a box needs some area to be seen, grabbed and saved.
  const width = Math.max(MIN_DRAWN, Math.abs(dx));
  const height = Math.max(MIN_DRAWN, Math.abs(dy));
  return { box: { x: dx < 0 ? start.x - width : start.x, y: dy < 0 ? start.y - height : start.y, width, height } };
}
