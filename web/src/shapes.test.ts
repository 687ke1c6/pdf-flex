import { describe, expect, test } from "bun:test";
import { fixedSize, keepsAspect, toStampArgs, type ShapePlacement } from "./placement";
import {
  clickGeometry,
  DEFAULT_SHAPE_STYLE,
  dragGeometry,
  drawing,
  lineBox,
  lineEnds,
  snapAngle,
  svgPath,
  type Segment,
} from "./shapes";

/** Every point a path visits (curve control points included). */
function points(path: Segment[]): [number, number][] {
  return path.flatMap((s): [number, number][] => {
    if (s.op === "Z") return [];
    if (s.op === "C") return [[s.x1, s.y1], [s.x2, s.y2], [s.x, s.y]];
    return [[s.x, s.y]];
  });
}

describe("drawing", () => {
  test("a rectangle's outline is inset by half its width, so it stays in the box", () => {
    const d = drawing("rect", { stroke: "#000000", strokeWidth: 4, fill: null }, 100, 50);
    expect(points(d.path)).toEqual([[2, 2], [98, 2], [98, 48], [2, 48]]);
    expect(d.stroke).toEqual({ color: "#000000", width: 4 });
    expect(d.fill).toBeNull();
  });

  test("an ellipse touches the middle of each inset side", () => {
    const d = drawing("ellipse", { ...DEFAULT_SHAPE_STYLE, strokeWidth: 2 }, 100, 60);
    const ends = d.path.flatMap((s) => (s.op === "M" || s.op === "C" ? [[s.x, s.y]] : []));
    expect(ends).toEqual([[99, 30], [50, 59], [1, 30], [50, 1], [99, 30]]);
  });

  test("a line runs between its ends, with round caps, and always has an outline", () => {
    const ends: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 5, y: 5 }, { x: 95, y: 45 }];
    const d = drawing("line", { stroke: null, strokeWidth: 3, fill: null }, 100, 50, ends);
    expect(points(d.path)).toEqual([[5, 5], [95, 45]]);
    expect(d.stroke).toEqual({ color: "#000000", width: 3 });
    expect(d.rounded).toBe(true);
  });

  test("symbols stay inside their box, in their colour, with weight following size", () => {
    for (const shape of ["check", "cross", "dot", "circle"] as const) {
      const d = drawing(shape, { stroke: "#b91c1c", strokeWidth: 9, fill: null }, 20, 20);
      for (const [x, y] of points(d.path)) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(20);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(20);
      }
      expect(d.stroke?.color ?? d.fill).toBe("#b91c1c");
      if (d.stroke) expect(d.stroke.width).toBeLessThan(3);
    }
  });
});

test("svgPath flips y for SVG", () => {
  expect(
    svgPath(
      [
        { op: "M", x: 0, y: 0 },
        { op: "L", x: 10, y: 40 },
        { op: "C", x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
        { op: "Z" },
      ],
      50,
    ),
  ).toBe("M0 50L10 10C1 48 3 46 5 44Z");
});

describe("lines", () => {
  test("lineBox pads around the ends, and lineEnds gives them back", () => {
    const a = { x: 100, y: 200 };
    const b = { x: 50, y: 260 };
    const { box, ends } = lineBox(a, b, 2);
    expect(box).toEqual({ x: 45, y: 195, width: 60, height: 70 });
    expect(lineEnds(box, ends)).toEqual([a, b]);
  });

  test("snapAngle keeps the length and snaps to 45°", () => {
    const out = snapAngle({ x: 0, y: 0 }, { x: 100, y: 10 });
    expect(out.x).toBeCloseTo(Math.hypot(100, 10));
    expect(out.y).toBeCloseTo(0);
    const diagonal = snapAngle({ x: 0, y: 0 }, { x: 50, y: 45 });
    expect(diagonal.x).toBeCloseTo(diagonal.y);
  });
});

describe("drawing by drag", () => {
  test("any drag direction gives a normal box", () => {
    expect(dragGeometry("rect", { x: 100, y: 100 }, { x: 40, y: 160 }, false, 2).box).toEqual({ x: 40, y: 100, width: 60, height: 60 });
  });
  test("Shift makes rectangles square, from the starting corner", () => {
    expect(dragGeometry("rect", { x: 100, y: 100 }, { x: 140, y: 80 }, true, 2).box).toEqual({ x: 100, y: 60, width: 40, height: 40 });
  });
  test("symbols are always square", () => {
    const { box } = dragGeometry("check", { x: 0, y: 0 }, { x: 30, y: 10 }, false, 2);
    expect(box.width).toBe(box.height);
  });
  test("a flat drag still has some height", () => {
    expect(dragGeometry("ellipse", { x: 0, y: 0 }, { x: 30, y: 0 }, false, 2).box.height).toBe(2);
  });
  test("a line drag sets its ends", () => {
    const { box, ends } = dragGeometry("line", { x: 10, y: 10 }, { x: 110, y: 10 }, false, 2);
    expect(lineEnds(box, ends!)).toEqual([{ x: 10, y: 10 }, { x: 110, y: 10 }]);
  });
  test("a click adds a default size centred on it", () => {
    expect(clickGeometry("rect", { x: 300, y: 400 }, 2).box).toEqual({ x: 240, y: 370, width: 120, height: 60 });
    expect(clickGeometry("dot", { x: 300, y: 400 }, 2).box).toEqual({ x: 294, y: 394, width: 12, height: 12 });
  });
});

describe("shape placements", () => {
  const base = { id: "s", kind: "shape", page: 1, x: 10, y: 20, width: 100, height: 50 } as const;
  const rect: ShapePlacement = { ...base, shape: "rect", style: { stroke: "#ff0000", strokeWidth: 2, fill: "#ffffff" } };
  const check: ShapePlacement = { ...base, shape: "check", style: DEFAULT_SHAPE_STYLE };
  const line: ShapePlacement = { ...base, shape: "line", style: DEFAULT_SHAPE_STYLE, ends: [{ x: 4, y: 4 }, { x: 96, y: 46 }] };

  test("rectangles resize freely, symbols keep their proportions, lines keep their size when moved", () => {
    expect(keepsAspect(rect)).toBe(false);
    expect(keepsAspect(check)).toBe(true);
    expect(fixedSize(line)).toBe(true);
    expect(fixedSize(rect)).toBe(false);
  });

  test("toStampArgs writes the path, colours as RGB, and paint", () => {
    const item = toStampArgs([rect]).placements[0].item;
    if (item.kind !== "shape") throw new Error("not a shape");
    expect(item.stroke).toEqual({ color: [255, 0, 0], width: 2 });
    expect(item.fill).toEqual([255, 255, 255]);
    expect(item.path[0]).toEqual({ op: "M", x: 1, y: 1 });
    expect(item.rounded).toBe(false);
  });
});
