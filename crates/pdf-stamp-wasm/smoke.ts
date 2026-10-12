// Runs the built WASM package (demo/pkg) under Bun: stamps a fixture and writes out/wasm-smoke.pdf.
// Usage: bun crates/pdf-stamp-wasm/smoke.ts   (after `just wasm` and `just fixtures`)
import { readFileSync, writeFileSync } from "node:fs";
import { initSync, stamp } from "./demo/pkg/pdf_stamp_wasm.js";

initSync({ module: readFileSync(new URL("./demo/pkg/pdf_stamp_wasm_bg.wasm", import.meta.url)) });

const pdf = readFileSync("out/fixtures/rotate-90.pdf");
const sig = readFileSync("out/sig.png");

// The rotate-90 fixture's target box: displayed 792 pt wide, box 150 x 50 at (602, 40).
const started = performance.now();
const out = stamp(pdf, sig, new Float64Array([1, 602, 40, 150, 50]));
console.log(`stamped in ${(performance.now() - started).toFixed(1)} ms -> ${out.length} bytes`);
writeFileSync("out/wasm-smoke.pdf", out);

try {
  stamp(pdf, sig, new Float64Array([9, 0, 0, 10, 10]));
  throw new Error("expected an error for a missing page");
} catch (e) {
  console.log(`error path ok: ${(e as Error).message}`);
}
