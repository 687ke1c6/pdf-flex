import { describe, expect, test } from "bun:test";
import { FONT_METRICS } from "./metrics";
import {
  clampSize,
  hexToRgb,
  layoutText,
  LINE_HEIGHT,
  lineWidth,
  relaidOut,
  resizedTextSize,
  standardFont,
  type TextStyle,
} from "./textLayout";
import { unsupportedChars, winAnsiByte } from "./winansi";

const LETTER = { width: 612, height: 792 };
const style: TextStyle = { family: "Helvetica", bold: false, italic: false, size: 10, color: "#000000", align: "left" };

describe("winAnsiByte (mirrors pdf-stamp's table)", () => {
  test("ASCII and Latin-1 map to themselves", () => {
    expect(winAnsiByte("A")).toBe(0x41);
    expect(winAnsiByte("é")).toBe(0xe9);
    expect(winAnsiByte(" ")).toBe(0xa0);
  });
  test("Windows extras use 0x80–0x9F", () => {
    expect(winAnsiByte("€")).toBe(0x80);
    expect(winAnsiByte("“")).toBe(0x93);
    expect(winAnsiByte("Ÿ")).toBe(0x9f);
  });
  test("controls and other scripts have no byte", () => {
    for (const c of ["\t", "\u007f", "ł", "Ω", "中", "😀"]) expect(winAnsiByte(c)).toBeUndefined();
  });
  test("unsupportedChars lists each once, ignoring newlines", () => {
    expect(unsupportedChars("Łódź\nłódź Ł")).toEqual(["Ł", "ź", "ł"]);
    expect(unsupportedChars("Café\n5 €")).toEqual([]);
  });
});

test("metrics match Adobe's AFM values", () => {
  const width = (font: keyof typeof FONT_METRICS, char: string) => FONT_METRICS[font].widths[winAnsiByte(char)!];
  expect(width("Helvetica", "A")).toBe(667);
  expect(width("Helvetica", " ")).toBe(278);
  expect(width("Helvetica", "é")).toBe(556);
  expect(width("Helvetica-Bold", "A")).toBe(722);
  expect(width("Times-Roman", "A")).toBe(722);
  expect(width("Times-Roman", "€")).toBe(500);
  expect(width("Courier-BoldOblique", "W")).toBe(600);
  expect(FONT_METRICS.Helvetica.ascender).toBe(718);
  expect(FONT_METRICS["Times-Roman"].descender).toBe(-217);
});

test("standardFont names every combination", () => {
  expect(standardFont({ family: "Helvetica", bold: false, italic: false })).toBe("Helvetica");
  expect(standardFont({ family: "Helvetica", bold: true, italic: true })).toBe("Helvetica-BoldOblique");
  expect(standardFont({ family: "Times", bold: false, italic: false })).toBe("Times-Roman");
  expect(standardFont({ family: "Times", bold: false, italic: true })).toBe("Times-Italic");
  expect(standardFont({ family: "Courier", bold: true, italic: false })).toBe("Courier-Bold");
});

describe("layoutText", () => {
  test("measures with the standard metrics", () => {
    // H 722 + e 556 + l 222 + l 222 + o 556 = 2278 units.
    expect(lineWidth("Hello", { ...style, size: 12 })).toBeCloseTo(27.336);
  });

  test("one line: the box hugs the text", () => {
    const { width, height, lines } = layoutText("Hello", style);
    expect(width).toBeCloseTo(22.78);
    expect(height).toBeCloseTo(10 * LINE_HEIGHT);
    expect(lines).toHaveLength(1);
    expect(lines[0].x).toBe(0);
    // The baseline sits inside the line, nearer the bottom.
    expect(lines[0].y).toBeGreaterThan(0);
    expect(lines[0].y).toBeLessThan(height / 2);
  });

  test("lines go down by the line height, and the box fits the widest", () => {
    const { width, height, lines } = layoutText("Hello\nHi\nWorld!", style);
    expect(height).toBeCloseTo(3 * 10 * LINE_HEIGHT);
    expect(lines[0].y - lines[1].y).toBeCloseTo(10 * LINE_HEIGHT);
    expect(lines[1].y - lines[2].y).toBeCloseTo(10 * LINE_HEIGHT);
    expect(width).toBeCloseTo(Math.max(...lines.map((l) => l.width)));
  });

  test("alignment moves shorter lines within the box", () => {
    const left = layoutText("Hello\nHi", style);
    const center = layoutText("Hello\nHi", { ...style, align: "center" });
    const right = layoutText("Hello\nHi", { ...style, align: "right" });
    const free = left.width - left.lines[1].width;
    expect(left.lines[1].x).toBe(0);
    expect(center.lines[1].x).toBeCloseTo(free / 2);
    expect(right.lines[1].x).toBeCloseTo(free);
    expect(right.lines[0].x).toBe(0);
  });

  test("empty text keeps a clickable width", () => {
    expect(layoutText("", style).width).toBe(5);
  });
});

describe("relaidOut", () => {
  const box = { x: 100, y: 200, width: 50, height: 12 };
  test("keeps the top-left corner by default", () => {
    const out = relaidOut(box, "Hello\nHello", style);
    expect(out.x).toBe(100);
    expect(out.y + out.height).toBe(212);
    expect(out.height).toBeCloseTo(24);
  });
  test("keeps the given corner", () => {
    const out = relaidOut(box, "Hello", style, "se");
    expect(out.x + out.width).toBeCloseTo(150);
    expect(out.y).toBe(200);
  });
});

describe("resizedTextSize", () => {
  const box = { x: 100, y: 200, width: 50, height: 12 };
  test("dragging a corner out to double the width doubles the size", () => {
    expect(resizedTextSize(box, 10, "se", { x: 200, y: 212 - 24 }, LETTER)).toBe(20);
  });
  test("stays within the allowed sizes, in half points", () => {
    expect(resizedTextSize(box, 10, "se", { x: 101, y: 211 }, LETTER)).toBe(4);
    expect(clampSize(12.3)).toBe(12.5);
    expect(clampSize(1000)).toBe(200);
  });
});

test("hexToRgb", () => {
  expect(hexToRgb("#1e3a8a")).toEqual([30, 58, 138]);
  expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
});
