// Assembling an edited page list into one PDF, with pdf.js's extractPages (see
// docs/pages-plan.md §2). The result is then stamped like any opened PDF.
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { DocState } from "../document/docState";
import type { Slot } from "../document/pages";
import { inspectPdf, sameLayout } from "./stamper";

/** Consecutive pages of one source, in ascending order: one extractPages entry. */
export interface Run {
  source: string;
  /** 0-based page indices in the source. */
  pages: number[];
}

/**
 * Splits the page list into runs that pdf.js can copy as they are. A run ends
 * where the source changes or the next page isn't the following one, so each
 * entry's pages are in the order pdf.js keeps them.
 */
export function runsOf(slots: Slot[]): Run[] {
  const runs: Run[] = [];
  for (const slot of slots) {
    const last = runs.at(-1);
    if (last && last.source === slot.source && slot.index === last.pages.at(-1)! + 1) last.pages.push(slot.index);
    else runs.push({ source: slot.source, pages: [slot.index] });
  }
  return runs;
}

/**
 * Builds a PDF of exactly these pages, in order. `base` is the pdf.js document
 * of source `baseId` (its own pages need no copy of its bytes); `bytesOf` gives
 * any other source's bytes.
 */
export async function assemble(
  base: Pick<PDFDocumentProxy, "extractPages">,
  baseId: string,
  slots: Slot[],
  bytesOf: (source: string) => Uint8Array,
): Promise<Uint8Array> {
  const entries = runsOf(slots).map((run) => ({
    // A copy each time: pdf.js may take over (transfer) the buffer it's given.
    document: run.source === baseId ? null : bytesOf(run.source).slice(),
    includePages: run.pages,
  }));
  return base.extractPages(entries);
}

/**
 * The PDF to stamp a document's placements onto: the original as it is, or,
 * if its pages have changed, those pages assembled into a new PDF and checked.
 * Rejects with a user-facing message if they can't be put together as shown.
 */
export async function pagesPdf(doc: DocState, originalId: string): Promise<Uint8Array> {
  const original = doc.sources.get(originalId)!;
  if (!doc.pagesChanged()) return original.bytes;
  const slots = doc.slots();
  let out: Uint8Array;
  try {
    out = await assemble(original.pdf.doc, originalId, slots, (id) => doc.sources.get(id)!.bytes);
  } catch (err) {
    throw new Error(`The pages couldn't be put together (${err instanceof Error ? err.message : err}).`);
  }
  // The stamper must see the pages the editor shows, or items would land in the wrong place.
  const { pages } = await inspectPdf(out);
  if (!sameLayout(slots, pages)) throw new Error("The pages couldn't be put together as shown, so nothing was saved.");
  return out;
}
