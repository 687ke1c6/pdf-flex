import { describe, expect, test } from "bun:test";
import { sameLayout } from "./stamper";

describe("sameLayout", () => {
  const letter = { width: 612, height: 792 };
  test("matches within rounding", () => {
    expect(sameLayout([letter], [{ width: 612.0001, height: 791.9999 }])).toBe(true);
  });
  test("catches a different page count or size", () => {
    expect(sameLayout([letter], [letter, letter])).toBe(false);
    expect(sameLayout([letter], [{ width: 792, height: 612 }])).toBe(false);
  });
});
