import { expect, test } from "bun:test";
import { createDocState, hasChanges, isDirty, savedKey, stateOf } from "./docState";
import { createHistory } from "./history";
import { deletePages, insertSlots, movePages, pagesOf, stepAt, rearrange, singleSource, slotsOf, sourcesOf, usedSources, withoutKeys, type PagesState, type Source } from "./pages";
import type { Placement } from "./placement";

const LETTER = { width: 612, height: 792 };
const at = (id: string, page: number): Placement => ({ id, kind: "image", signatureId: "s", page, x: 10, y: 10, width: 50, height: 20 });
/** A three-page document with one item on each page: a on 1, b on 2, c on 3. */
const doc = (): PagesState => ({
  slots: slotsOf("orig", [LETTER, LETTER, LETTER]),
  placements: [at("a", 1), at("b", 2), at("c", 3)],
});
const pageOf = (s: PagesState) => Object.fromEntries(s.placements.map((p) => [p.id, p.page]));
const order = (s: PagesState) => s.slots.map((x) => `${x.source}:${x.index}`);
const other = slotsOf("other", [LETTER, { width: 842, height: 595 }], "o");

test("a source opens as its pages in order", () => {
  expect(slotsOf("orig", [LETTER, { width: 792, height: 612 }])).toEqual([
    { key: "s0", source: "orig", index: 0, width: 612, height: 792 },
    { key: "s1", source: "orig", index: 1, width: 792, height: 612 },
  ]);
});

test("inserting at the start, middle and end moves the items after it", () => {
  const start = insertSlots(doc(), 0, other);
  expect(order(start)).toEqual(["other:0", "other:1", "orig:0", "orig:1", "orig:2"]);
  expect(pageOf(start)).toEqual({ a: 3, b: 4, c: 5 });

  const middle = insertSlots(doc(), 1, other);
  expect(order(middle)).toEqual(["orig:0", "other:0", "other:1", "orig:1", "orig:2"]);
  expect(pageOf(middle)).toEqual({ a: 1, b: 4, c: 5 });

  const original = doc();
  const end = insertSlots(original, 3, other);
  expect(pageOf(end)).toEqual({ a: 1, b: 2, c: 3 });
  // Items that don't move are the same objects.
  expect(end.placements[0]).toBe(original.placements[0]);
  expect(order(insertSlots(doc(), 99, other))).toEqual(order(end));
});

test("deleting pages removes their items and closes the gap", () => {
  const next = deletePages(doc(), [2])!;
  expect(order(next)).toEqual(["orig:0", "orig:2"]);
  expect(pageOf(next)).toEqual({ a: 1, c: 2 });
  expect(pageOf(deletePages(doc(), [1, 3])!)).toEqual({ b: 1 });
});

test("deleting every page leaves the blank page given, or nothing is deleted", () => {
  expect(deletePages(doc(), [1, 2, 3])).toBeUndefined();
  const blank = { key: "b", source: "blank:612x792", index: 0, ...LETTER };
  const next = deletePages(doc(), [1, 2, 3], blank)!;
  expect(next.slots).toEqual([blank]);
  expect(next.placements).toEqual([]);
  // Not needed while a page is left.
  expect(order(deletePages(doc(), [1, 2], blank)!)).toEqual(["orig:2"]);
});

test("moving pages keeps their order and takes their items along", () => {
  const toEnd = movePages(doc(), [1], 3);
  expect(order(toEnd)).toEqual(["orig:1", "orig:2", "orig:0"]);
  expect(pageOf(toEnd)).toEqual({ a: 3, b: 1, c: 2 });

  const toStart = movePages(doc(), [2, 3], 0);
  expect(order(toStart)).toEqual(["orig:1", "orig:2", "orig:0"]);
  expect(pageOf(toStart)).toEqual({ a: 3, b: 1, c: 2 });

  // Before the page at position 2 (the third), counted before the move.
  expect(order(movePages(doc(), [1], 2))).toEqual(["orig:1", "orig:0", "orig:2"]);
  expect(order(movePages(doc(), [2], 1))).toEqual(order(doc()));
});

test("the same source page can appear twice, and items stay on their own copy", () => {
  const twice = insertSlots(doc(), 3, [{ ...doc().slots[0], key: "copy" }]);
  expect(order(twice)).toEqual(["orig:0", "orig:1", "orig:2", "orig:0"]);
  const without = deletePages(twice, [1])!;
  expect(order(without)).toEqual(["orig:1", "orig:2", "orig:0"]);
  expect(pageOf(without)).toEqual({ b: 1, c: 2 });
});

test("an item on a page that doesn't exist is dropped", () => {
  const state = { ...doc(), placements: [at("lost", 9)] };
  expect(rearrange(state, state.slots).placements).toEqual([]);
});

test("page changes and placements undo and redo together", () => {
  const h = createHistory<PagesState>();
  let state = doc();
  const change = (next: PagesState) => {
    h.checkpoint(state);
    state = next;
  };
  change(insertSlots(state, 1, other));
  change(deletePages(state, [1])!);
  expect(pageOf(state)).toEqual({ b: 3, c: 4 });
  state = h.undo(state)!;
  expect(pageOf(state)).toEqual({ a: 1, b: 4, c: 5 });
  state = h.undo(state)!;
  expect(state).toEqual(doc());
  state = h.redo(state)!;
  state = h.redo(state)!;
  expect(order(state)).toEqual(["other:0", "other:1", "orig:1", "orig:2"]);
});

/** A source with these pages, as far as the page list cares. */
const source = (id: string, count: number) => ({ id, name: `${id}.pdf`, pdf: { pages: Array(count).fill(LETTER) } }) as unknown as Source;

test("a document with changed pages is dirty until they're put back", () => {
  const d = createDocState(pagesOf(source("orig", 2)));
  expect(d.slots().map((s) => s.key)).toEqual(["s0", "s1"]);
  expect(isDirty(d)).toBe(false);
  const before = stateOf(d);
  d.setSlots(deletePages(before, [2])!.slots);
  expect(isDirty(d)).toBe(true);
  d.setSlots(before.slots);
  expect(isDirty(d)).toBe(false);
  // Pages are compared by what they show, not by their keys.
  expect(savedKey(slotsOf("orig", [LETTER], "x"), [])).toBe(savedKey(slotsOf("orig", [LETTER]), []));
});

test("one PDF's pages, all of them in order, need no assembling", () => {
  const orig = source("orig", 2);
  const sources = new Map([["orig", orig], ["other", source("other", 1)]]);
  expect(singleSource(slotsOf("orig", [LETTER, LETTER]), sources)).toBe(orig);
  expect(singleSource(slotsOf("orig", [LETTER]), sources)).toBeUndefined();
  expect(singleSource(movePages({ slots: slotsOf("orig", [LETTER, LETTER]), placements: [] }, [2], 0).slots, sources)).toBeUndefined();
  expect(singleSource(slotsOf("other", [LETTER]), sources)?.id).toBe("other");
  expect(singleSource([...slotsOf("orig", [LETTER, LETTER]), ...slotsOf("other", [LETTER], "o")], sources)).toBeUndefined();
  expect(singleSource([], sources)).toBeUndefined();

  const d = createDocState(pagesOf(orig));
  d.sources.set("orig", orig);
  expect(hasChanges(d)).toBe(false);
  d.setSlots(slotsOf("orig", [LETTER]));
  expect(hasChanges(d)).toBe(true);
});

test("a draft keeps the pages without keys, and every PDF they use but blank pages", () => {
  const slots = [...slotsOf("orig", [LETTER]), ...slotsOf("other", [LETTER, LETTER], "o"), ...slotsOf("blank:612x792", [LETTER], "b"), ...slotsOf("other", [LETTER], "x")];
  expect(withoutKeys(slots)[1]).toEqual({ source: "other", index: 0, width: 612, height: 792 });
  expect(sourcesOf(withoutKeys(slots))).toEqual(["orig", "other", "blank:612x792"]);
  const [orig, other] = [source("orig", 1), source("other", 2)];
  expect(usedSources(slots, new Map([["orig", orig], ["other", other]]))).toEqual([orig, other]);
});

test("pages move one step up or down, together, and stop at the ends", () => {
  const step = (pages: number[], dir: -1 | 1) => order(movePages(doc(), pages, stepAt(pages, 3, dir)));
  expect(step([2], -1)).toEqual(["orig:1", "orig:0", "orig:2"]);
  expect(step([2], 1)).toEqual(["orig:0", "orig:2", "orig:1"]);
  expect(step([1], -1)).toEqual(order(doc()));
  expect(step([3], 1)).toEqual(order(doc()));
  expect(step([1, 2], 1)).toEqual(["orig:2", "orig:0", "orig:1"]);
  expect(step([3, 2], -1)).toEqual(["orig:1", "orig:2", "orig:0"]);
});
