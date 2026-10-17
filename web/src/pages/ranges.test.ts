import { expect, test } from "bun:test";
import { formatRanges, parseRanges } from "./ranges";

test("ranges and single pages, in any order and spacing", () => {
  expect(parseRanges("1-3, 5", 6)).toEqual([0, 1, 2, 4]);
  expect(parseRanges(" 5 ,1 – 2 ", 6)).toEqual([0, 1, 4]);
  expect(parseRanges("2 4;6", 6)).toEqual([1, 3, 5]);
  expect(parseRanges("3-1, 2", 6)).toEqual([0, 1, 2]);
  expect(parseRanges("4-", 6)).toEqual([3, 4, 5]);
  expect(parseRanges("1-1", 1)).toEqual([0]);
});

test("mistakes are explained", () => {
  expect(parseRanges("", 6)).toBe("Choose at least one page.");
  expect(parseRanges("  , ", 6)).toBe("Choose at least one page.");
  expect(parseRanges("7", 6)).toBe("There's no page 7: this PDF has 6 pages.");
  expect(parseRanges("0-2", 6)).toBe("There's no page 0: this PDF has 6 pages.");
  expect(parseRanges("2", 1)).toBe("There's no page 2: this PDF has 1 page.");
  expect(parseRanges("1-2-3", 6)).toBe("“1-2-3” isn't a page or a range of pages, like 1-3.");
  expect(parseRanges("one", 6)).toBe("“one” isn't a page or a range of pages, like 1-3.");
});

test("pages are written back as short ranges", () => {
  expect(formatRanges([0, 1, 2, 4])).toBe("1-3, 5");
  expect(formatRanges([4, 0, 2, 1, 1])).toBe("1-3, 5");
  expect(formatRanges([3])).toBe("4");
  expect(formatRanges([])).toBe("");
  expect(parseRanges(formatRanges([0, 2, 3, 4, 9]), 10)).toEqual([0, 2, 3, 4, 9]);
});
