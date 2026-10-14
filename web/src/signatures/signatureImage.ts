// Turning an image into a clean signature: background removal, trimming, size limit.

/** Longest side of a stored signature, in pixels: about 5 in at 300 dpi, plenty for print. */
const MAX_SIDE = 1600;
/** Brightness range over which pixels fade from ink to transparent, for smooth edges. */
const SOFTNESS = 40;
/** Alpha at or below this counts as empty when trimming. */
const EMPTY_ALPHA = 8;
/** Transparent margin kept around the ink after trimming, in pixels. */
const PADDING = 4;

export interface CleanupOptions {
  removeBackground: boolean;
  /** 0–255: pixels lighter than this become transparent. */
  threshold: number;
}

/** Default threshold: removes white and light-grey paper, keeps pen strokes. */
export const DEFAULT_THRESHOLD = 200;

/** Draws a bitmap onto a canvas, downscaled so its longest side is at most `MAX_SIDE`. */
export function toCanvas(bitmap: ImageBitmap): HTMLCanvasElement {
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** True if any pixel is noticeably transparent, i.e. the image already has no background. */
export function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

/**
 * Returns a new canvas with the background removed (if asked) and trimmed to the
 * ink, or `null` if nothing visible is left.
 */
export function cleanUp(source: HTMLCanvasElement, options: CleanupOptions): HTMLCanvasElement | null {
  const { width, height } = source;
  const image = source.getContext("2d")!.getImageData(0, 0, width, height);
  const data = image.data;

  if (options.removeBackground) {
    for (let i = 0; i < data.length; i += 4) {
      const brightness = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      const ink = Math.min(1, Math.max(0, (options.threshold - brightness) / SOFTNESS + 0.5));
      data[i + 3] = Math.round(data[i + 3] * ink);
    }
  }

  // Bounding box of everything visible.
  let [minX, minY, maxX, maxY] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > EMPTY_ALPHA) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  minX = Math.max(0, minX - PADDING);
  minY = Math.max(0, minY - PADDING);
  maxX = Math.min(width - 1, maxX + PADDING);
  maxY = Math.min(height - 1, maxY + PADDING);

  const out = document.createElement("canvas");
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext("2d")!.putImageData(image, -minX, -minY, minX, minY, out.width, out.height);
  return out;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode the image"))), "image/png"),
  );
}
