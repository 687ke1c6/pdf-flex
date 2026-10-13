// Checks that the stamper (WASM build) and pdf.js agree on every corpus PDF:
// both accept or both reject it, and if both accept it, they agree on the
// page count and every page's display size. The web app places signatures
// using pdf.js's sizes and stamps them with the WASM build, so a disagreement
// would put signatures in the wrong place.
// Usage: `just wasm-smoke`, or bun crates/pdf-stamp-wasm/corpus.ts after `just wasm` (needs web/node_modules).
// pdf.js logs its own warnings to stderr; results go to stdout.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDocument } from "../../web/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { initSync, inspect } from "./pkg/pdf_stamp_wasm.js";

initSync({ module: readFileSync(new URL("./pkg/pdf_stamp_wasm_bg.wasm", import.meta.url)) });

const corpus = new URL("../pdf-stamp/tests/corpus/", import.meta.url).pathname;
// Files pdf.js can't open but the stamper repairs: harmless, since the app can't show them.
const PDFJS_CANT_OPEN = new Set(["generated/no-xref-or-trailer.pdf"]);

let failures = 0;
for (const dir of ["real", "generated"]) {
  for (const name of readdirSync(join(corpus, dir)).filter((f) => f.endsWith(".pdf")).sort()) {
    const path = `${dir}/${name}`;
    const bytes = readFileSync(join(corpus, path));

    let viewer: string;
    try {
      const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false });
      const doc = await task.promise;
      const sizes: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const { width, height } = (await doc.getPage(i)).getViewport({ scale: 1 });
        sizes.push(`${Math.round(width)}x${Math.round(height)}`);
      }
      viewer = sizes.join(" ");
      await task.destroy();
    } catch (e) {
      if (process.env.DEBUG) console.error(e);
      viewer = "cannot open";
    }

    let stamper: string;
    try {
      const inspection = inspect(bytes);
      const flat = inspection.sizes;
      inspection.free();
      stamper = Array.from({ length: flat.length / 2 }, (_, i) => `${Math.round(flat[2 * i])}x${Math.round(flat[2 * i + 1])}`).join(" ");
    } catch (e) {
      stamper = `refuses: ${(e as Error).message}`;
    }

    // pdf.js opens encrypted files and decompression bombs; refusing to sign them is fine.
    const agree = viewer === stamper || stamper.startsWith("refuses") || (viewer === "cannot open" && PDFJS_CANT_OPEN.has(path));
    if (!agree) failures++;
    console.log(`${agree ? "ok  " : "FAIL"} ${path}: pdf.js ${viewer} | stamper ${stamper}`);
  }
}
if (failures) {
  console.log(`${failures} corpus files where pdf.js and the stamper disagree`);
  process.exit(1);
}
