// Arranging several placements together: aligning them, and moving them as a group.
// Positions are display-space points on each item's own page (y up), so items on
// different pages line up by their position on the page.

import type { Box } from "../document/placement";
import type { PageSize } from "../viewer/pdf";

/** Left, centre and right move items sideways; top, middle and bottom move them up and down. */
export type AlignEdge = "left" | "centre" | "right" | "top" | "middle" | "bottom";

export interface GroupBox extends Box {
  id: string;
  page: number;
}

const horizontal = (edge: AlignEdge) => edge === "left" || edge === "centre" || edge === "right";

/** Where the items line up: that edge (or centre) of their bounding box. */
export function alignTarget(items: Box[], edge: AlignEdge): number {
  const left = Math.min(...items.map((b) => b.x));
  const right = Math.max(...items.map((b) => b.x + b.width));
  const bottom = Math.min(...items.map((b) => b.y));
  const top = Math.max(...items.map((b) => b.y + b.height));
  switch (edge) {
    case "left":
      return left;
    case "centre":
      return (left + right) / 2;
    case "right":
      return right;
    case "top":
      return top;
    case "middle":
      return (bottom + top) / 2;
    case "bottom":
      return bottom;
  }
}

/** The new bottom-left corner of `box` once aligned to `target`; it only moves along one axis. */
export function alignedBox(box: Box, edge: AlignEdge, target: number): { x: number; y: number } {
  if (horizontal(edge)) {
    const x = edge === "left" ? target : edge === "right" ? target - box.width : target - box.width / 2;
    return { x, y: box.y };
  }
  const y = edge === "bottom" ? target : edge === "top" ? target - box.height : target - box.height / 2;
  return { x: box.x, y };
}

/**
 * Limits a group move so no box leaves its page, keeping the boxes'
 * arrangement. `null` if a page is unknown.
 */
export function limitGroupMove(
  starts: GroupBox[],
  dx: number,
  dy: number,
  pageSize: (page: number) => PageSize | undefined,
): { dx: number; dy: number } | null {
  let [minDx, maxDx, minDy, maxDy] = [-Infinity, Infinity, -Infinity, Infinity];
  for (const b of starts) {
    const size = pageSize(b.page);
    if (!size) return null;
    // A box already partly off its page may stay where it is, but not go further.
    minDx = Math.max(minDx, Math.min(0, -b.x));
    maxDx = Math.min(maxDx, Math.max(0, size.width - b.x - b.width));
    minDy = Math.max(minDy, Math.min(0, -b.y));
    maxDy = Math.min(maxDy, Math.max(0, size.height - b.y - b.height));
  }
  return { dx: Math.min(maxDx, Math.max(minDx, dx)), dy: Math.min(maxDy, Math.max(minDy, dy)) };
}

/** Whether `inner` lies entirely within `outer`. */
export const boxContains = (outer: Box, inner: Box): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;
