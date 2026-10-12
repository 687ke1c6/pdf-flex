// Placement geometry. Placements live in display space, the contract `pdf-stamp`
// expects: PDF points, origin at the bottom-left of the page as shown, y up.
// The screen is CSS pixels from the page's top-left, y down.

import type { PageSize } from "./pdf";

export interface Placement {
  id: string;
  /** 1-based page number. */
  page: number;
  /** Bottom-left corner, in points. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Box = Pick<Placement, "x" | "y" | "width" | "height">;
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
export function resized(box: Box, corner: Corner, pointer: Point, page: PageSize): Box {
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
  const width = Math.min(maxWidth, Math.max(MIN_WIDTH, dx, dy * aspect));
  const height = width / aspect;
  return {
    width,
    height,
    x: right ? anchor.x : anchor.x - width,
    y: up ? anchor.y : anchor.y - height,
  };
}

/** The flat `[page, x, y, width, height, …]` layout the WASM `stamp` function takes. */
export function toStampArgs(placements: Placement[]): Float64Array {
  return new Float64Array(placements.flatMap((p) => [p.page, p.x, p.y, p.width, p.height]));
}
