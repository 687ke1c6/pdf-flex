// Runs the Rust stamper (WASM) off the main thread so large PDFs don't freeze the UI.
import init, { inspect, stamp } from "pdf-stamp-wasm/pdf_stamp_wasm.js";
import wasmUrl from "pdf-stamp-wasm/pdf_stamp_wasm_bg.wasm?url";
import type { WorkerRequest, WorkerResponse } from "./stamper";

// The DOM lib types `self` as Window; this is the slice of the worker scope we use.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};

const ready = init({ module_or_path: wasmUrl });

scope.onmessage = async ({ data }) => {
  const { id } = data;
  try {
    await ready;
    if (data.kind === "inspect") {
      const inspection = inspect(data.pdf);
      // wasm-bindgen returns fresh copies on ordinary (non-shared) ArrayBuffers.
      const sizes = inspection.sizes as Float64Array<ArrayBuffer>;
      const { digitallySigned } = inspection;
      inspection.free();
      scope.postMessage({ id, ok: true, kind: "inspect", sizes, digitallySigned }, [sizes.buffer]);
    } else {
      const out = stamp(data.pdf, data.images, data.imageLengths, data.placements) as Uint8Array<ArrayBuffer>;
      scope.postMessage({ id, ok: true, kind: "stamp", pdf: out }, [out.buffer]);
    }
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
