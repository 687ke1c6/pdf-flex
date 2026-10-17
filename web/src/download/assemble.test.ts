import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { slotsOf, type Slot } from "../document/pages";
import { assemble, runsOf } from "./assemble";

const CORPUS = new URL("../../../crates/pdf-stamp/tests/corpus/", import.meta.url).pathname;
const read = (path: string) => new Uint8Array(readFileSync(CORPUS + path));

/** Opens a PDF with pdf.js and returns it with its display page sizes. */
async function open(bytes: Uint8Array) {
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const sizes = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const { width, height } = (await doc.getPage(i)).getViewport({ scale: 1 });
    sizes.push({ width: Math.round(width), height: Math.round(height) });
  }
  return { doc, sizes };
}

const slot = (source: string, index: number): Slot => ({ key: `${source}${index}`, source, index, width: 0, height: 0 });

test("runs group consecutive ascending pages of one source", () => {
  const slots = [slot("a", 0), slot("a", 1), slot("b", 0), slot("b", 1), slot("a", 2), slot("a", 0), slot("a", 0)];
  expect(runsOf(slots)).toEqual([
    { source: "a", pages: [0, 1] },
    { source: "b", pages: [0, 1] },
    { source: "a", pages: [2] },
    { source: "a", pages: [0] },
    { source: "a", pages: [0] },
  ]);
  expect(runsOf([])).toEqual([]);
});

test("pages from several PDFs come out in the page list's order, at their sizes", async () => {
  // A4 pages, the third rotated by an inherited /Rotate; Letter; a small page with /UserUnit.
  const bytes = { tree: read("generated/deep-page-tree.pdf"), letter: read("generated/base.pdf"), small: read("generated/user-unit-2.pdf") };
  const opened = { tree: await open(bytes.tree), letter: await open(bytes.letter), small: await open(bytes.small) };
  const all = (Object.keys(opened) as (keyof typeof opened)[]).flatMap((id) => slotsOf(id, opened[id].sizes, id));
  const pick = (id: string, index: number) => all.find((s) => s.source === id && s.index === index)!;

  // Out of order, repeated, and interleaved with the base document's own pages.
  const slots = [pick("tree", 2), pick("letter", 0), pick("tree", 0), pick("small", 0), pick("tree", 1), pick("tree", 2), pick("letter", 0)];
  const out = await assemble(opened.tree.doc, "tree", slots, (id) => bytes[id as keyof typeof bytes]);

  const result = await open(out);
  expect(result.sizes).toEqual(slots.map(({ width, height }) => ({ width, height })));
  // Sanity check that the sizes tell the pages apart.
  expect(new Set(result.sizes.map((s) => `${s.width}x${s.height}`)).size).toBeGreaterThanOrEqual(3);
});

/** How many form field widgets each page has. */
async function widgets(doc: Awaited<ReturnType<typeof open>>["doc"]) {
  const counts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const annotations = await (await doc.getPage(i)).getAnnotations();
    counts.push(annotations.filter((a: { fieldType?: string }) => a.fieldType).length);
  }
  return counts;
}

test("form fields and the structure tree survive", async () => {
  const form = read("real/irs-w9-xfa-form.pdf");
  const tagged = read("real/word-pdfmaker-tagged.pdf");
  const base = await open(tagged);
  const formDoc = await open(form);
  const slots = [...slotsOf("tagged", base.sizes, "t"), ...slotsOf("form", formDoc.sizes, "f").slice(0, 2)];
  const result = await open(await assemble(base.doc, "tagged", slots, () => form));
  expect(result.doc.numPages).toBe(3);
  // The W-9's fields are all on its first page. (getFieldObjects can't be used: it's an XFA form.)
  const before = await widgets(formDoc.doc);
  expect(before[0]).toBeGreaterThan(0);
  expect(await widgets(result.doc)).toEqual([0, before[0], before[1]]);
  expect(await (await result.doc.getPage(1)).getStructTree()).toBeTruthy();
});
