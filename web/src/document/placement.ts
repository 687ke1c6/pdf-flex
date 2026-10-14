// Placement geometry. Placements live in display space, the contract `pdf-stamp`
// expects: PDF points, origin at the bottom-left of the page as shown, y up.
// The screen is CSS pixels from the page's top-left, y down.

import type { PageSize } from "../viewer/pdf";
import { drawing, isSymbol, type Segment, type ShapeKind, type ShapeStyle } from "../shapes/shapes";
import { hexToRgb, layoutText, standardFont, type TextStyle } from "../text/textLayout";

/** What every placed item has: where it is. Moving, clamping and undo only use this. */
interface PlacedBox {
  id: string;
  /** 1-based page number. */
  page: number;
  /** Bottom-left corner, in points. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A saved signature, drawn as an image. */
export interface ImagePlacement extends PlacedBox {
  kind: "image";
  signatureId: string;
}

/** Text, written into the PDF as real text. Its box always fits its layout (see textLayout.ts). */
export interface TextPlacement extends PlacedBox {
  kind: "text";
  /** Lines separated by `\n`. */
  text: string;
  style: TextStyle;
}

/** A vector shape or symbol. Its path is built from the box (see shapes.ts). */
export interface ShapePlacement extends PlacedBox {
  kind: "shape";
  shape: ShapeKind;
  style: ShapeStyle;
  /** A line's two ends, relative to the box's bottom-left corner. */
  ends?: [Point, Point];
}

/** Anything placed on a page. Each kind adds what it draws. */
export type Placement = ImagePlacement | TextPlacement | ShapePlacement;

export type Box = Pick<PlacedBox, "x" | "y" | "width" | "height">;
export interface Point {
  x: number;
  y: number;
}
export interface CssBox {
  left: number;
  top: number;
  width: number;
  height: number;
}
export type Corner = "nw" | "ne" | "sw" | "se";

/** Smallest width a placement can be resized to, in points. */
export const MIN_WIDTH = 20;
/** Smallest width or height when resizing freely, in points. */
export const MIN_SIDE = 2;

/** Whether resizing keeps the aspect ratio. Rectangles and ellipses keep it only with Shift. */
export const keepsAspect = (p: Placement): boolean => p.kind !== "shape" || isSymbol(p.shape);

/** Whether moving must never resize the box, because its contents are laid out to fit it exactly. */
export const fixedSize = (p: Placement): boolean => p.kind === "text" || (p.kind === "shape" && p.shape === "line");

/** Where a box appears on screen, relative to its page's top-left. */
export function toCss(box: Box, page: PageSize, scale: number): CssBox {
  return {
    left: box.x * scale,
    top: (page.height - box.y - box.height) * scale,
    width: box.width * scale,
    height: box.height * scale,
  };
}

/** A screen point relative to the page's top-left, in display-space points. */
export function toPoints(cssX: number, cssY: number, page: PageSize, scale: number): Point {
  return { x: cssX / scale, y: page.height - cssY / scale };
}

/** Shrinks a box (keeping its aspect ratio) to fit the page, then moves it fully onto the page. */
export function clampToPage(box: Box, page: PageSize): Box {
  const shrink = Math.min(1, page.width / box.width, page.height / box.height);
  const width = box.width * shrink;
  const height = box.height * shrink;
  return {
    width,
    height,
    x: Math.min(Math.max(box.x, 0), page.width - width),
    y: Math.min(Math.max(box.y, 0), page.height - height),
  };
}

/** A box of the given width and aspect ratio (width / height), centred on `center`. */
/**
 * Moves a box fully onto the page without resizing it (its top-left corner
 * wins if it's larger than the page). For boxes whose size can't change, like text.
 */
export function keptOnPage(box: Box, page: PageSize): Box {
  const x = Math.max(0, Math.min(box.x, page.width - box.width));
  const y = Math.min(page.height - box.height, Math.max(box.y, 0));
  return { ...box, x, y };
}

export function centeredAt(center: Point, width: number, aspect: number, page: PageSize): Box {
  const height = width / aspect;
  return clampToPage({ x: center.x - width / 2, y: center.y - height / 2, width, height }, page);
}

export function moved(box: Box, dx: number, dy: number, page: PageSize): Box {
  return clampToPage({ ...box, x: box.x + dx, y: box.y + dy }, page);
}

/**
 * Resizes by dragging `corner` to `pointer`, keeping the opposite corner fixed
 * and the box's aspect ratio. The box can't flip past its anchor or leave the page.
 */
export function resized(box: Box, corner: Corner, pointer: Point, page: PageSize, minWidth = MIN_WIDTH): Box {
  const aspect = box.width / box.height;
  const right = corner === "ne" || corner === "se";
  const up = corner === "nw" || corner === "ne";
  // The fixed corner, opposite the one being dragged.
  const anchor = { x: right ? box.x : box.x + box.width, y: up ? box.y : box.y + box.height };

  const dx = right ? pointer.x - anchor.x : anchor.x - pointer.x;
  const dy = up ? pointer.y - anchor.y : anchor.y - pointer.y;
  const maxWidth = Math.min(
    right ? page.width - anchor.x : anchor.x,
    (up ? page.height - anchor.y : anchor.y) * aspect,
  );
  const width = Math.min(maxWidth, Math.max(minWidth, dx, dy * aspect));
  const height = width / aspect;
  return {
    width,
    height,
    x: right ? anchor.x : anchor.x - width,
    y: up ? anchor.y : anchor.y - height,
  };
}

/**
 * Resizes by dragging `corner` to `pointer`, keeping the opposite corner fixed.
 * Width and height change independently; the box can't flip past its anchor or leave the page.
 */
export function resizedFree(box: Box, corner: Corner, pointer: Point, page: PageSize): Box {
  const right = corner === "ne" || corner === "se";
  const up = corner === "nw" || corner === "ne";
  const anchor = { x: right ? box.x : box.x + box.width, y: up ? box.y : box.y + box.height };

  const maxWidth = right ? page.width - anchor.x : anchor.x;
  const maxHeight = up ? page.height - anchor.y : anchor.y;
  const width = Math.min(maxWidth, Math.max(MIN_SIDE, right ? pointer.x - anchor.x : anchor.x - pointer.x));
  const height = Math.min(maxHeight, Math.max(MIN_SIDE, up ? pointer.y - anchor.y : anchor.y - pointer.y));
  return {
    width,
    height,
    x: right ? anchor.x : anchor.x - width,
    y: up ? anchor.y : anchor.y - height,
  };
}

/** The standard PDF fonts `pdf-stamp` writes text in, by PostScript name. */
export type StandardFont =
  | "Helvetica"
  | "Helvetica-Bold"
  | "Helvetica-Oblique"
  | "Helvetica-BoldOblique"
  | "Times-Roman"
  | "Times-Bold"
  | "Times-Italic"
  | "Times-BoldItalic"
  | "Courier"
  | "Courier-Bold"
  | "Courier-Oblique"
  | "Courier-BoldOblique";

/** What a placement draws, as `pdf-stamp`'s `Item` (serde: tagged by `kind`). */
export type StampItem =
  | { kind: "image"; image: number }
  | {
      kind: "shape";
      path: Segment[];
      stroke: { color: [number, number, number]; width: number } | null;
      fill: [number, number, number] | null;
      rounded: boolean;
    }
  | {
      kind: "text";
      font: StandardFont;
      /** Points. */
      size: number;
      /** 0–255 RGB. */
      color: [number, number, number];
      /** Baseline starts, in points from the box's bottom-left corner. */
      lines: { text: string; x: number; y: number }[];
    };

/** A placement as the WASM `stamp` function takes it: `pdf-stamp`'s `Placement`. */
export interface StampPlacement extends Box {
  page: number;
  item: StampItem;
}

/**
 * The arguments the WASM `stamp` function takes: the distinct signatures used
 * (in image-index order) and the placements, which refer to images by index.
 */
export function toStampArgs(placements: Placement[]): { signatureIds: string[]; placements: StampPlacement[] } {
  const signatureIds = [...new Set(placements.flatMap((p) => (p.kind === "image" ? [p.signatureId] : [])))];
  const toItem = (p: Placement): StampItem => {
    switch (p.kind) {
      case "image":
        return { kind: "image", image: signatureIds.indexOf(p.signatureId) };
      case "text": {
        const { lines } = layoutText(p.text, p.style);
        return {
          kind: "text",
          font: standardFont(p.style),
          size: p.style.size,
          color: hexToRgb(p.style.color),
          lines: lines.filter((l) => l.text).map(({ text, x, y }) => ({ text, x, y })),
        };
      }
      case "shape": {
        const d = drawing(p.shape, p.style, p.width, p.height, p.ends);
        return {
          kind: "shape",
          path: d.path,
          stroke: d.stroke && { color: hexToRgb(d.stroke.color), width: d.stroke.width },
          fill: d.fill ? hexToRgb(d.fill) : null,
          rounded: d.rounded,
        };
      }
    }
  };
  return {
    signatureIds,
    placements: placements.map((p) => ({ page: p.page, x: p.x, y: p.y, width: p.width, height: p.height, item: toItem(p) })),
  };
}
