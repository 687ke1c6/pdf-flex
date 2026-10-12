import { describe, expect, test } from "bun:test";
import { centeredAt, clampToPage, moved, resized, toCss, toPoints, toStampArgs, MIN_WIDTH } from "./placement";

const LETTER = { width: 612, height: 792 };
const box = { x: 100, y: 200, width: 150, height: 50 };

describe("screen <-> display space", () => {
  test("toCss flips y and scales", () => {
    expect(toCss(box, LETTER, 2)).toEqual({ left: 200, top: (792 - 250) * 2, width: 300, height: 100 });
  });

  test("toPoints inverts toCss for the box's top-left corner", () => {
    const css = toCss(box, LETTER, 1.5);
    expect(toPoints(css.left, css.top, LETTER, 1.5)).toEqual({ x: 100, y: 250 });
  });

  test("page top-left on screen is (0, height) in points", () => {
    expect(toPoints(0, 0, LETTER, 3)).toEqual({ x: 0, y: 792 });
  });
});

describe("clampToPage", () => {
  test("moves a box back onto the page", () => {
    expect(clampToPage({ ...box, x: -20, y: 780 }, LETTER)).toEqual({ ...box, x: 0, y: 742 });
  });

  test("shrinks an oversized box, keeping its aspect ratio", () => {
    const out = clampToPage({ x: 0, y: 0, width: 1224, height: 408 }, LETTER);
    expect(out.width).toBe(612);
    expect(out.height).toBe(204);
  });
});

test("centeredAt centres the box on the point", () => {
  expect(centeredAt({ x: 300, y: 400 }, 150, 3, LETTER)).toEqual({ x: 225, y: 375, width: 150, height: 50 });
});

test("moved clamps at the page edge", () => {
  expect(moved(box, 1000, -1000, LETTER)).toEqual({ ...box, x: 462, y: 0 });
});

describe("resized", () => {
  test("dragging the south-east corner keeps the north-west corner fixed", () => {
    const out = resized(box, "se", { x: 400, y: 200 }, LETTER);
    expect(out.x).toBe(box.x);
    expect(out.y + out.height).toBe(box.y + box.height);
    expect(out.width / out.height).toBeCloseTo(3);
    expect(out.width).toBe(300);
  });

  test("dragging the north-west corner keeps the south-east corner fixed", () => {
    const out = resized(box, "nw", { x: 0, y: 300 }, LETTER);
    expect(out.x + out.width).toBe(box.x + box.width);
    expect(out.y).toBe(box.y);
    expect(out.width).toBe(250);
  });

  test("uses whichever axis was dragged further", () => {
    // Pointer barely moves in x but far in y: height drives the size.
    const out = resized(box, "ne", { x: 250, y: 350 }, LETTER);
    expect(out.height).toBe(150);
    expect(out.width).toBe(450);
  });

  test("never smaller than the minimum width", () => {
    expect(resized(box, "se", { x: 0, y: 1000 }, LETTER).width).toBe(MIN_WIDTH);
  });

  test("stops at the page edge", () => {
    const out = resized(box, "se", { x: 5000, y: -5000 }, LETTER);
    expect(out.x + out.width).toBeLessThanOrEqual(612);
    expect(out.y).toBeGreaterThanOrEqual(0);
    expect(out.width / out.height).toBeCloseTo(3);
  });
});

test("toStampArgs flattens to [page, x, y, width, height] groups", () => {
  const args = toStampArgs([
    { id: "a", page: 1, ...box },
    { id: "b", page: 3, x: 1, y: 2, width: 3, height: 4 },
  ]);
  expect([...args]).toEqual([1, 100, 200, 150, 50, 3, 1, 2, 3, 4]);
});
