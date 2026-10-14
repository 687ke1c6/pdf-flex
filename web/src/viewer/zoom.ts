// Zoom is a fraction of actual size: 1 = 100% = one PDF point drawn as 96/72 CSS pixels.

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;

/** CSS pixels per PDF point at 100% zoom (PDF is 72 pt/in, CSS is 96 px/in). */
export const CSS_PX_PER_PT = 96 / 72;

const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Next preset step above (`dir = 1`) or below (`dir = -1`) the current zoom. */
export function stepZoom(current: number, dir: 1 | -1): number {
  const next = dir > 0 ? STEPS.find((s) => s > current + 1e-3) : [...STEPS].reverse().find((s) => s < current - 1e-3);
  return next ?? current;
}

/** Zoom at which the widest page fills `available` CSS pixels. */
export function fitWidthZoom(available: number, widestPagePt: number): number {
  return clampZoom(available / (widestPagePt * CSS_PX_PER_PT));
}
