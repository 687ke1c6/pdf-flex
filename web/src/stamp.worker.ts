// Runs the Rust stamper (WASM) off the main thread so large PDFs don't freeze the UI.
import init, { stamp } from "pdf-stamp-wasm/pdf_stamp_wasm.js";
import wasmUrl from "pdf-stamp-wasm/pdf_stamp_wasm_bg.wasm?url";
import type { StampRequest, StampResponse } from "./stamper";

// The DOM lib types `self` as Window; this is the slice of the worker scope we use.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<StampRequest>) => void) | null;
  postMessage(message: StampResponse, transfer?: Transferable[]): void;
};

const ready = init({ module_or_path: wasmUrl });

scope.onmessage = async ({ data: { id, pdf, signature, placements } }) => {
  try {
    await ready;
    // wasm-bindgen returns a fresh copy on an ordinary (non-shared) ArrayBuffer.
    const out = stamp(pdf, signature, placements) as Uint8Array<ArrayBuffer>;
    scope.postMessage({ id, ok: true, pdf: out }, [out.buffer]);
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
