import { expect, test } from "bun:test";
import { createDocState, isDirty, savedKey, stateOf } from "./docState";
import { createHistory } from "./history";
import { deletePages, insertSlots, isUntouched, movePages, rearrange, slotsOf, type PagesState } from "./pages";
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

test("a source opens as its pages in order, untouched", () => {
  const slots = slotsOf("orig", [LETTER, { width: 792, height: 612 }]);
  expect(slots).toEqual([
    { key: "s0", source: "orig", index: 0, width: 612, height: 792 },
    { key: "s1", source: "orig", index: 1, width: 792, height: 612 },
  ]);
  expect(isUntouched(slots, "orig", 2)).toBe(true);
  expect(isUntouched(slots, "orig", 3)).toBe(false);
  expect(isUntouched(slots, "other", 2)).toBe(false);
  expect(isUntouched([slots[1], slots[0]], "orig", 2)).toBe(false);
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

test("the last page can't be deleted", () => {
  expect(deletePages(doc(), [1, 2, 3])).toBeUndefined();
  const one: PagesState = { slots: slotsOf("orig", [LETTER]), placements: [] };
  expect(deletePages(one, [1])).toBeUndefined();
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

test("a document with changed pages is dirty until they're put back", () => {
  const d = createDocState([LETTER, LETTER], "orig");
  expect(isDirty(d)).toBe(false);
  const before = stateOf(d);
  d.setSlots(deletePages(before, [2])!.slots);
  expect(isDirty(d)).toBe(true);
  d.setSlots(before.slots);
  expect(isDirty(d)).toBe(false);
  // Pages are compared by what they show, not by their keys.
  expect(savedKey(slotsOf("orig", [LETTER], "x"), [])).toBe(savedKey(slotsOf("orig", [LETTER]), []));
});
