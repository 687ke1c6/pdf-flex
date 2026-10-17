// End to end for page changes: pages from several PDFs are assembled the way the
// web app does it (pdf.js extractPages), then the WASM stamper inspects the result,
// must agree on every page size, and stamps a marker on each page, which pdftotext
// must read back on that page. Writes out/assemble-smoke.pdf.
// Usage: `just wasm-smoke`, or bun crates/pdf-stamp-wasm/assemble.ts after `just wasm` (needs web/node_modules).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { getDocument } from "../../web/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { assemble } from "../../web/src/download/assemble";
import { blankPdf } from "../../web/src/pages/blank";
import { initSync, inspect, stamp } from "./pkg/pdf_stamp_wasm.js";

initSync({ module: readFileSync(new URL("./pkg/pdf_stamp_wasm_bg.wasm", import.meta.url)) });

const corpus = new URL("../pdf-stamp/tests/corpus/", import.meta.url).pathname;
const files = {
  tree: "generated/deep-page-tree.pdf", // A4, inherited attributes, a rotated page
  small: "generated/user-unit-2.pdf",
  form: "real/irs-w9-xfa-form.pdf",
  rotated: "generated/rotate-real-number.pdf",
};
type Id = keyof typeof files | "blank";
const bytes = {
  ...Object.fromEntries(Object.entries(files).map(([id, f]) => [id, new Uint8Array(readFileSync(corpus + f))])),
  blank: blankPdf(500, 300), // made by the app, not read from a file
} as Record<Id, Uint8Array>;

async function sizes(data: Uint8Array) {
  const doc = await getDocument({ data: data.slice(), verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await doc.getPage(i)).getViewport({ scale: 1 }));
  return { doc, sizes: out.map(({ width, height }) => ({ width, height })) };
}
const opened = Object.fromEntries(await Promise.all((Object.keys(bytes) as Id[]).map(async (id) => [id, await sizes(bytes[id])]))) as Record<Id, Awaited<ReturnType<typeof sizes>>>;

// Inserted before, between and after the base document's pages, one of them twice.
const order: [Id, number][] = [["form", 0], ["tree", 0], ["small", 0], ["blank", 0], ["tree", 2], ["rotated", 0], ["tree", 1], ["small", 0]];
const slots = order.map(([source, index], i) => ({ key: `k${i}`, source, index, ...opened[source].sizes[index] }));

const started = performance.now();
const pdf = await assemble(opened.tree.doc, "tree", slots, (id) => bytes[id as Id]);
console.log(`assembled ${slots.length} pages in ${(performance.now() - started).toFixed(0)} ms -> ${pdf.length} bytes`);

let failures = 0;
const fail = (msg: string) => {
  console.log(`FAIL: ${msg}`);
  failures++;
};

const stamped = inspect(pdf).sizes;
slots.forEach((s, i) => {
  const [w, h] = [stamped[2 * i], stamped[2 * i + 1]];
  if (Math.abs(w - s.width) > 0.5 || Math.abs(h - s.height) > 0.5) fail(`page ${i + 1}: stamper sees ${w} x ${h}, viewer ${s.width} x ${s.height}`);
});
if (stamped.length !== 2 * slots.length) fail(`stamper sees ${stamped.length / 2} pages, expected ${slots.length}`);

const marker = (n: number) => `PAGEMARK${n}`;
const placements = slots.map((_, i) => ({
  page: i + 1,
  x: 20,
  y: 20,
  width: 120,
  height: 14,
  item: { kind: "text", font: "Helvetica", size: 10, color: [0, 0, 0], lines: [{ text: marker(i + 1), x: 0, y: 3 }] },
}));
const out = stamp(pdf, new Uint8Array(), new Uint32Array(), placements);
writeFileSync("out/assemble-smoke.pdf", out);

// Each marker must be on its page and where it was placed: 20 pt from the left and bottom of the page as
// shown. Sizes alone can't catch a flipped rotation (90° and 270° pages are the same size).
slots.forEach((s, i) => {
  const html = execFileSync("pdftotext", ["-cropbox", "-bbox", "-f", `${i + 1}`, "-l", `${i + 1}`, "out/assemble-smoke.pdf", "-"]).toString();
  const word = html.match(new RegExp(`<word xMin="([\\d.]+)" yMin="[\\d.]+" xMax="[\\d.]+" yMax="([\\d.]+)">${marker(i + 1)}</word>`));
  if (!word) return fail(`page ${i + 1}: pdftotext doesn't find ${marker(i + 1)}`);
  // Poppler doesn't apply /UserUnit; pdf.js and the stamper do. Scale its numbers to theirs. (Its page
  // size is before /Rotate, so the longer sides are compared.)
  const [, w, h] = html.match(/<page width="([\d.]+)" height="([\d.]+)"/)!.map(Number);
  const unit = Math.max(s.width, s.height) / Math.max(w, h);
  const [left, bottom] = [Number(word[1]) * unit, s.height - Number(word[2]) * unit];
  if (Math.abs(left - 20) > 2 || bottom < 15 || bottom > 30) fail(`page ${i + 1}: marker at ${left.toFixed(1)}, ${bottom.toFixed(1)} from the bottom-left, expected about 20, 20`);
});
execFileSync("qpdf", ["--check", "out/assemble-smoke.pdf"], { stdio: "ignore" });

if (failures) process.exit(1);
console.log(`assemble ok: ${slots.length} pages from 4 PDFs and a blank page, sizes agree, every marker on its page where placed; qpdf ok: out/assemble-smoke.pdf`);
