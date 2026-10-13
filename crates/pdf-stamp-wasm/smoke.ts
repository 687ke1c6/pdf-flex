// Runs the built WASM package (pkg/) under Bun: stamps a fixture and writes out/wasm-smoke.pdf.
// Usage: bun crates/pdf-stamp-wasm/smoke.ts   (after `just wasm` and `just fixtures`)
import { readFileSync, writeFileSync } from "node:fs";
import { initSync, inspect, stamp } from "./pkg/pdf_stamp_wasm.js";

initSync({ module: readFileSync(new URL("./pkg/pdf_stamp_wasm_bg.wasm", import.meta.url)) });

const pdf = readFileSync("out/fixtures/rotate-90.pdf");
const sig = readFileSync("out/sig.png");

// The rotate-90 fixture's target box: displayed 792 pt wide, box 150 x 50 at (602, 40).
const lengths = new Uint32Array([sig.length]);
const started = performance.now();
const image = { kind: "image", image: 0 };
const text = { kind: "text", font: "Helvetica-Bold", size: 12, color: [30, 58, 138], lines: [{ text: "Café – 5 €", x: 0, y: 4 }] };
const out = stamp(pdf, sig, lengths, [
  { page: 1, x: 602, y: 40, width: 150, height: 50, item: image },
  { page: 1, x: 602, y: 100, width: 150, height: 20, item: text },
]);
console.log(`stamped in ${(performance.now() - started).toFixed(1)} ms -> ${out.length} bytes`);
writeFileSync("out/wasm-smoke.pdf", out);

/** Runs `f`, which must throw; returns the error message. */
function expectError(what: string, f: () => unknown): string {
  try {
    f();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error(`expected an error for ${what}`);
}

console.log(`error path ok: ${expectError("a missing page", () => stamp(pdf, sig, lengths, [{ page: 9, x: 0, y: 0, width: 10, height: 10, item: image }]))}`);
console.log(`text error ok: ${expectError("an unsupported character", () => stamp(pdf, sig, lengths, [{ page: 1, x: 0, y: 0, width: 10, height: 10, item: { ...text, lines: [{ text: "Łódź", x: 0, y: 0 }] } }]))}`);
console.log(`bad input ok: ${expectError("an unknown kind", () => stamp(pdf, sig, lengths, [{ page: 1, x: 0, y: 0, width: 10, height: 10, item: { kind: "video" } }]))}`);

const inspection = inspect(pdf);
const sizes = inspection.sizes.join();
if (sizes !== "792,612" || inspection.digitallySigned) throw new Error(`inspect gave ${sizes}, ${inspection.digitallySigned}`);
inspection.free();
console.log(`inspect ok: ${expectError("a non-PDF", () => inspect(new TextEncoder().encode("<html>")))}`);
