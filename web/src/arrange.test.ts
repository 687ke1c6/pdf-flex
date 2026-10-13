import { describe, expect, test } from "bun:test";
import { alignedBox, alignTarget, boxContains, limitGroupMove, type AlignEdge, type GroupBox } from "./arrange";

const LETTER = { width: 612, height: 792 };
// Two boxes: a at (100,200) 50×20, b at (300,400) 100×60.
const a = { x: 100, y: 200, width: 50, height: 20 };
const b = { x: 300, y: 400, width: 100, height: 60 };

/** Both boxes after aligning on `edge`. */
const align = (edge: AlignEdge) => {
  const target = alignTarget([a, b], edge);
  return [alignedBox(a, edge, target), alignedBox(b, edge, target)];
};

describe("align", () => {
  test("left: everything to the leftmost left edge, height untouched", () => {
    expect(align("left")).toEqual([{ x: 100, y: 200 }, { x: 100, y: 400 }]);
  });
  test("right: right edges meet at the rightmost one", () => {
    expect(align("right")).toEqual([{ x: 350, y: 200 }, { x: 300, y: 400 }]);
  });
  test("centre: centres meet in the middle of the bounding box", () => {
    // Bounding box 100–400, centre 250.
    expect(align("centre")).toEqual([{ x: 225, y: 200 }, { x: 200, y: 400 }]);
  });
  test("top and bottom (y up)", () => {
    expect(align("top")).toEqual([{ x: 100, y: 440 }, { x: 300, y: 400 }]);
    expect(align("bottom")).toEqual([{ x: 100, y: 200 }, { x: 300, y: 200 }]);
  });
  test("middle: vertical centres meet", () => {
    // Bounding box 200–460, middle 330.
    expect(align("middle")).toEqual([{ x: 100, y: 320 }, { x: 300, y: 300 }]);
  });
});

describe("limitGroupMove", () => {
  const group: GroupBox[] = [
    { id: "a", page: 1, ...a },
    { id: "b", page: 2, ...b },
  ];
  const sizes = () => LETTER;

  test("a free move goes through", () => {
    expect(limitGroupMove(group, 10, -5, sizes)).toEqual({ dx: 10, dy: -5 });
  });
  test("stops when the first box would leave its page, so the arrangement holds", () => {
    // b's right edge is at 400: it can move 212 right. a's left edge at 100: it can move 100 left.
    expect(limitGroupMove(group, 1000, 0, sizes)).toEqual({ dx: 212, dy: 0 });
    expect(limitGroupMove(group, -1000, 0, sizes)).toEqual({ dx: -100, dy: 0 });
    // Up: b's top is at 460 of 792.
    expect(limitGroupMove(group, 0, 1000, sizes)).toEqual({ dx: 0, dy: 332 });
  });
  test("an unknown page stops the move", () => {
    expect(limitGroupMove(group, 1, 1, (page) => (page === 1 ? LETTER : undefined))).toBeNull();
  });
});

test("boxContains: only boxes entirely inside count, edges included", () => {
  expect(boxContains({ x: 0, y: 0, width: 1000, height: 1000 }, a)).toBe(true);
  expect(boxContains({ x: 100, y: 200, width: 50, height: 20 }, a)).toBe(true);
  // Covering most of it isn't enough.
  expect(boxContains({ x: 101, y: 190, width: 100, height: 100 }, a)).toBe(false);
  expect(boxContains(a, b)).toBe(false);
});
