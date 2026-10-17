// The page list: which page of which source PDF is shown at each position.
// Page operations (insert, delete, move) edit this list; the PDF bytes are only
// assembled from it at download. Placements keep 1-based page numbers, so every
// operation remaps them by following each slot's key to its new position.
import { isBlankSource } from "../pages/blank";
import type { LoadedPdf, PageSize } from "../viewer/pdf";
import type { Placement } from "./placement";

/** A PDF that pages come from: the opened document, or one inserted into it. */
export interface Source {
  /** Its SHA-256, like a document's id: the same file is one source however often it's inserted. */
  id: string;
  name: string;
  bytes: Uint8Array;
  /** Open in pdf.js, to render its pages. */
  pdf: LoadedPdf;
  /** Checked when it was added: it carries a digital signature, which saving invalidates. */
  digitallySigned?: boolean;
}

/** One page of the document: page `index` (0-based) of source `source`, at its display size. */
export interface Slot extends PageSize {
  /** Unique within the document, and kept while the page exists, wherever it moves. */
  key: string;
  /** The source PDF's id (its SHA-256, like a document's). */
  source: string;
  index: number;
}

/** A slot before it has a key. */
export type NewSlot = Omit<Slot, "key">;

/** The page list and the placements on it: what an undo step restores. */
export interface PagesState {
  slots: Slot[];
  placements: Placement[];
}

/** The page list without keys, as a draft keeps it (keys are given again when it's restored). */
export const withoutKeys = (slots: Slot[]): NewSlot[] => slots.map(({ key: _key, ...page }) => page);

/** The sources pages come from, each once, in order of first use. */
export const sourcesOf = (pages: NewSlot[]): string[] => [...new Set(pages.map((p) => p.source))];

/** The PDFs the pages come from, blank pages aside: what a draft stores. */
export const usedSources = (slots: Slot[], sources: Map<string, Source>): Source[] =>
  sourcesOf(slots).flatMap((id) => (isBlankSource(id) ? [] : [sources.get(id)!]));

/**
 * The source whose pages these are, all of them in order, if there is one: then
 * that PDF can be stamped as it is, with nothing to assemble.
 */
export function singleSource(slots: Slot[], sources: Map<string, Source>): Source | undefined {
  const source = slots.length ? sources.get(slots[0].source) : undefined;
  if (!source || slots.length !== source.pdf.pages.length) return undefined;
  return slots.every((s, i) => s.source === source.id && s.index === i) ? source : undefined;
}

/** Every page of a source, in order. */
export const pagesOf = (source: Pick<Source, "id" | "pdf">): NewSlot[] =>
  source.pdf.pages.map(({ width, height }, index) => ({ source: source.id, index, width, height }));

/** A source's pages as slots, in order, keyed `${prefix}0`, `${prefix}1`, …. */
export const slotsOf = (source: string, pages: PageSize[], prefix = "s"): Slot[] =>
  pages.map(({ width, height }, index) => ({ key: `${prefix}${index}`, source, index, width, height }));

/**
 * Switches to a new page list. Each placement follows its page's slot (by key)
 * to its new position; placements whose slot is gone are dropped.
 */
export function rearrange(state: PagesState, slots: Slot[]): PagesState {
  const position = new Map(slots.map((s, i) => [s.key, i + 1]));
  const placements = state.placements.flatMap((p) => {
    const key = state.slots[p.page - 1]?.key;
    const page = key === undefined ? undefined : position.get(key);
    return page === undefined ? [] : [p.page === page ? p : { ...p, page }];
  });
  return { slots, placements };
}

/** Inserts slots before 0-based position `at` (0: first, `slots.length`: at the end). */
export function insertSlots(state: PagesState, at: number, added: Slot[]): PagesState {
  const i = Math.max(0, Math.min(at, state.slots.length));
  return rearrange(state, [...state.slots.slice(0, i), ...added, ...state.slots.slice(i)]);
}

/**
 * Deletes the pages at these 1-based numbers, with their placements. Returns
 * `undefined` if that would leave no pages: a document always has one.
 */
export function deletePages(state: PagesState, pages: number[]): PagesState | undefined {
  const gone = new Set(pages);
  const slots = state.slots.filter((_, i) => !gone.has(i + 1));
  return slots.length ? rearrange(state, slots) : undefined;
}

/**
 * Moves the pages at these 1-based numbers, keeping their order, so that they
 * sit before the page that is now at 0-based position `at` (`slots.length`: at the end).
 */
export function movePages(state: PagesState, pages: number[], at: number): PagesState {
  const moving = new Set(pages);
  const moved = state.slots.filter((_, i) => moving.has(i + 1));
  const staying = state.slots.filter((_, i) => !moving.has(i + 1));
  // Where `at` lands once the moved pages are taken out.
  const i = state.slots.slice(0, Math.max(0, at)).filter((_, j) => !moving.has(j + 1)).length;
  return rearrange(state, [...staying.slice(0, i), ...moved, ...staying.slice(i)]);
}
