// Main-thread client for stamp.worker.ts.
import { toStampArgs, type Placement } from "./placement";

export interface StampRequest {
  id: number;
  pdf: Uint8Array;
  /** Image files concatenated; split by `imageLengths`. */
  images: Uint8Array;
  imageLengths: Uint32Array;
  placements: Float64Array;
}

export type StampResponse = { id: number; ok: true; pdf: Uint8Array<ArrayBuffer> } | { id: number; ok: false; error: string };

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, { resolve(pdf: Uint8Array<ArrayBuffer>): void; reject(err: Error): void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./stamp.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<StampResponse>) => {
    const request = pending.get(data.id);
    pending.delete(data.id);
    if (data.ok) request?.resolve(data.pdf);
    else request?.reject(new Error(data.error));
  };
  worker.onerror = (e) => {
    // The worker failed to load or crashed: fail everything in flight and start fresh next time.
    for (const request of pending.values()) request.reject(new Error(e.message || "The stamping worker failed"));
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}

/**
 * Returns a new PDF with each placement's signature drawn on it. `images` maps
 * signature ids to their PNG bytes. The inputs are not modified.
 */
export function stampPdf(
  pdf: Uint8Array,
  placements: Placement[],
  images: Map<string, Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  const { signatureIds, groups } = toStampArgs(placements);
  const files = signatureIds.map((sigId) => {
    const bytes = images.get(sigId);
    if (!bytes) throw new Error(`Missing image for signature ${sigId}`);
    return bytes;
  });
  const imageLengths = new Uint32Array(files.map((f) => f.length));
  const concatenated = new Uint8Array(imageLengths.reduce((sum, n) => sum + n, 0));
  files.reduce((offset, f) => (concatenated.set(f, offset), offset + f.length), 0);

  const id = nextId++;
  // pdf is copied because its buffer is transferred to the worker.
  const request: StampRequest = { id, pdf: pdf.slice(), images: concatenated, imageLengths, placements: groups };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const transfer = [request.pdf.buffer, request.images.buffer, request.imageLengths.buffer, request.placements.buffer];
    getWorker().postMessage(request, transfer);
  });
}
