// Text layout: from text and a style to a box size and where each line's
// baseline starts. One layout serves the on-screen preview, the box, and what
// `pdf-stamp` is asked to draw, so the screen and the PDF agree.
//
// Widths come from the standard fonts' official metrics (the same ones every
// PDF viewer uses). Where a baseline sits in its line follows the CSS line box
// of the preview font, so text typed in the in-place editor lines up exactly
// with the finished preview.

import { FONT_METRICS } from "./metrics";
import type { Box, Corner, Point, StandardFont } from "../document/placement";
import type { PageSize } from "../viewer/pdf";
import { winAnsiByte } from "./winansi";

export type TextFamily = "Helvetica" | "Times" | "Courier";
export type TextAlign = "left" | "center" | "right";

export interface TextStyle {
  family: TextFamily;
  bold: boolean;
  italic: boolean;
  /** Font size in points. */
  size: number;
  /** `#rrggbb`. */
  color: string;
  align: TextAlign;
}

/** Line spacing, as a multiple of the font size. */
export const LINE_HEIGHT = 1.2;
export const MIN_SIZE = 4;
export const MAX_SIZE = 200;

/**
 * The bundled on-screen stand-ins: metrically compatible with the standard
 * fonts. `ascent` and `descent` (per unit of font size) are the vertical
 * metrics browsers use for their line boxes, read from the font files.
 */
export const PREVIEW_FONTS: Record<TextFamily, { css: string; ascent: number; descent: number }> = {
  Helvetica: { css: '"Arimo", Helvetica, Arial, sans-serif', ascent: 1854 / 2048, descent: 434 / 2048 },
  Times: { css: '"Tinos", "Times New Roman", Times, serif', ascent: 1825 / 2048, descent: 443 / 2048 },
  Courier: { css: '"Cousine", "Courier New", Courier, monospace', ascent: 1705 / 2048, descent: 615 / 2048 },
};

/** The standard PDF font for a style, by PostScript name. */
export function standardFont({ family, bold, italic }: Pick<TextStyle, "family" | "bold" | "italic">): StandardFont {
  if (family === "Times") {
    if (bold && italic) return "Times-BoldItalic";
    if (bold) return "Times-Bold";
    return italic ? "Times-Italic" : "Times-Roman";
  }
  const suffix = (bold ? "Bold" : "") + (italic ? "Oblique" : "");
  return (suffix ? `${family}-${suffix}` : family) as StandardFont;
}

/** Width of one line in points. Characters that can't be written count as a question mark. */
export function lineWidth(text: string, style: TextStyle): number {
  const { widths } = FONT_METRICS[standardFont(style)];
  let units = 0;
  for (const char of text) units += widths[winAnsiByte(char) ?? 0x3f];
  return (units * style.size) / 1000;
}

export interface LaidOutLine {
  text: string;
  /** Baseline start, in points from the box's bottom-left corner. */
  x: number;
  y: number;
  width: number;
}

export interface TextLayout {
  width: number;
  height: number;
  lines: LaidOutLine[];
}

/** Lays out `text` (lines separated by `\n`): the box size and each line's baseline. */
export function layoutText(text: string, style: TextStyle): TextLayout {
  const { size, align } = style;
  const rows = text.split("\n");
  const widths = rows.map((row) => lineWidth(row, style));
  // An empty box keeps some width, so it can be seen and clicked.
  const width = Math.max(size / 2, ...widths);
  const lineHeight = size * LINE_HEIGHT;
  const height = rows.length * lineHeight;
  const { ascent, descent } = PREVIEW_FONTS[style.family];
  // As in a CSS line box: the leftover line height is split above and below the glyphs.
  const baseline = (lineHeight - (ascent + descent) * size) / 2 + ascent * size;
  const lines = rows.map((row, i) => {
    const free = width - widths[i];
    return {
      text: row,
      x: align === "left" ? 0 : align === "center" ? free / 2 : free,
      y: height - (i * lineHeight + baseline),
      width: widths[i],
    };
  });
  return { width, height, lines };
}

/**
 * The box for `text` in `style`, placed so that the `anchor` corner of
 * `current` stays where it is. Typing and restyling keep the top-left corner;
 * resizing keeps the corner opposite the one dragged.
 */
export function relaidOut(current: Box, text: string, style: TextStyle, anchor: Corner = "nw"): Box {
  const { width, height } = layoutText(text, style);
  const right = anchor === "ne" || anchor === "se";
  const top = anchor === "nw" || anchor === "ne";
  return {
    width,
    height,
    x: right ? current.x + current.width - width : current.x,
    y: top ? current.y + current.height - height : current.y,
  };
}

/** Rounds to the nearest half point, within the allowed sizes. */
export const clampSize = (size: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size * 2) / 2));

/**
 * The font size for dragging `corner` of a text box to `pointer`: the box
 * scales with the pointer like an image would, and the size follows its width.
 */
export function resizedTextSize(box: Box, size: number, corner: Corner, pointer: Point, page: PageSize): number {
  const right = corner === "ne" || corner === "se";
  const up = corner === "nw" || corner === "ne";
  const anchor = { x: right ? box.x : box.x + box.width, y: up ? box.y : box.y + box.height };
  const aspect = box.width / box.height;
  const dx = right ? pointer.x - anchor.x : anchor.x - pointer.x;
  const dy = up ? pointer.y - anchor.y : anchor.y - pointer.y;
  const maxWidth = Math.min(right ? page.width - anchor.x : anchor.x, (up ? page.height - anchor.y : anchor.y) * aspect);
  const width = Math.min(maxWidth, Math.max(dx, dy * aspect));
  return clampSize((size * width) / box.width);
}

/** The corner diagonally opposite. */
export const opposite = (corner: Corner): Corner => ({ nw: "se", ne: "sw", sw: "ne", se: "nw" } as const)[corner];

/** `#rrggbb` as 0–255 RGB. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
