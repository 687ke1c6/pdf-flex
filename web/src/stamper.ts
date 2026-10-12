// Main-thread client for stamp.worker.ts.
import { toStampArgs, type Placement } from "./placement";

export interface StampRequest {
  id: number;
  pdf: Uint8Array;
  signature: Uint8Array;
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

/** Returns a new PDF with the signature drawn at each placement. The inputs are not modified. */
export function stampPdf(pdf: Uint8Array, signature: Uint8Array, placements: Placement[]): Promise<Uint8Array<ArrayBuffer>> {
  const id = nextId++;
  // Copies, because their buffers are transferred to the worker.
  const request: StampRequest = { id, pdf: pdf.slice(), signature: signature.slice(), placements: toStampArgs(placements) };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage(request, [request.pdf.buffer, request.signature.buffer, request.placements.buffer]);
  });
}
