// Rendering a typed name in a script font to a transparent, trimmed canvas.
import { cleanUp } from "./signatureImage";

/** Font size to render at, in pixels: large enough to print crisply at typical signature sizes. */
const FONT_SIZE = 160;
/** Widest the text may be before the font size is reduced, keeping output under the 1600 px cap. */
const MAX_TEXT_WIDTH = 1400;

/** Renders `text` in `family`, or returns `null` if there's nothing visible to draw. */
export async function renderTyped(text: string, family: string, color: string): Promise<HTMLCanvasElement | null> {
  const value = text.trim();
  if (!value) return null;
  // Canvas text silently falls back to another font if the web font isn't loaded yet.
  await document.fonts.load(`${FONT_SIZE}px "${family}"`, value);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = (size: number) => `${size}px "${family}"`;
  ctx.font = font(FONT_SIZE);
  const size = Math.min(FONT_SIZE, (FONT_SIZE * MAX_TEXT_WIDTH) / ctx.measureText(value).width);

  // Script swashes overflow their measured box, so leave a font-size margin all round and trim afterwards.
  ctx.font = font(size);
  canvas.width = Math.ceil(ctx.measureText(value).width + 2 * size);
  canvas.height = Math.ceil(size * 3);
  ctx.font = font(size); // resizing the canvas resets its state
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(value, size, canvas.height / 2);

  return cleanUp(canvas, { removeBackground: false, threshold: 0 });
}
