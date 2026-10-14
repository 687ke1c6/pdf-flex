// Main-thread client for stamp.worker.ts.
import type { PageSize } from "../viewer/pdf";
import { toStampArgs, type Placement, type StampPlacement } from "../document/placement";

export type WorkerRequest =
  | {
      id: number;
      kind: "stamp";
      pdf: Uint8Array;
      /** Image files concatenated; split by `imageLengths`. */
      images: Uint8Array;
      imageLengths: Uint32Array;
      placements: StampPlacement[];
    }
  | { id: number; kind: "inspect"; pdf: Uint8Array };

export type WorkerResponse =
  | { id: number; ok: true; kind: "stamp"; pdf: Uint8Array<ArrayBuffer> }
  | { id: number; ok: true; kind: "inspect"; sizes: Float64Array<ArrayBuffer>; digitallySigned: boolean }
  | { id: number; ok: false; error: string };

type Success = Extract<WorkerResponse, { ok: true }>;

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, { resolve(response: Success): void; reject(err: Error): void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./stamp.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    const request = pending.get(data.id);
    pending.delete(data.id);
    if (data.ok) request?.resolve(data);
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

/** Sends a request (its buffers are transferred, so pass copies) and waits for the reply. */
function call<K extends Success["kind"]>(
  request: Extract<WorkerRequest, { kind: K }>,
  transfer: Transferable[],
): Promise<Extract<Success, { kind: K }>> {
  return new Promise((resolve, reject) => {
    pending.set(request.id, { resolve: resolve as (r: Success) => void, reject });
    getWorker().postMessage(request, transfer);
  });
}

export interface Inspection {
  /** Each page's size as the stamper sees it. */
  pages: PageSize[];
  /** The PDF has a digital signature or certification, which stamping invalidates. */
  digitallySigned: boolean;
}

/** Checks that the PDF can be edited; rejects with a user-facing message if it can't. */
export async function inspectPdf(pdf: Uint8Array): Promise<Inspection> {
  const copy = pdf.slice();
  const { sizes, digitallySigned } = await call({ id: nextId++, kind: "inspect", pdf: copy }, [copy.buffer]);
  const pages = Array.from({ length: sizes.length / 2 }, (_, i) => ({ width: sizes[2 * i], height: sizes[2 * i + 1] }));
  return { pages, digitallySigned };
}

/**
 * Returns a new PDF with each placement drawn on it. `images` maps
 * signature ids to their PNG bytes. The inputs are not modified.
 */
export async function stampPdf(
  pdf: Uint8Array,
  placements: Placement[],
  images: Map<string, Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  const args = toStampArgs(placements);
  const files = args.signatureIds.map((sigId) => {
    const bytes = images.get(sigId);
    if (!bytes) throw new Error(`Missing image for signature ${sigId}`);
    return bytes;
  });
  const imageLengths = new Uint32Array(files.map((f) => f.length));
  const concatenated = new Uint8Array(imageLengths.reduce((sum, n) => sum + n, 0));
  files.reduce((offset, f) => (concatenated.set(f, offset), offset + f.length), 0);

  // pdf is copied because its buffer is transferred to the worker.
  const request = {
    id: nextId++,
    kind: "stamp" as const,
    pdf: pdf.slice(),
    images: concatenated,
    imageLengths,
    placements: args.placements,
  };
  const transfer = [request.pdf.buffer, request.images.buffer, request.imageLengths.buffer];
  return (await call(request, transfer)).pdf;
}

/**
 * Whether the stamper and the viewer agree on the pages. If they don't,
 * placed items may not land where they were placed. Sizes may differ by
 * rounding (the stamper works in 32-bit floats).
 */
export function sameLayout(viewer: PageSize[], stamper: PageSize[]): boolean {
  return (
    viewer.length === stamper.length &&
    viewer.every((v, i) => Math.abs(v.width - stamper[i].width) < 0.5 && Math.abs(v.height - stamper[i].height) < 0.5)
  );
}
