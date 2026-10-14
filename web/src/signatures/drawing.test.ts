import { expect, test } from "bun:test";
import { BASE_WIDTH, drawStrokes, type Stroke } from "./drawing";

/** A stand-in 2D context that records the drawing calls we care about. */
function recorder() {
  const calls: string[] = [];
  const widths: number[] = [];
  const ctx = {
    strokeStyle: "",
    fillStyle: "",
    lineCap: "",
    lineJoin: "",
    set lineWidth(w: number) {
      widths.push(w);
    },
    beginPath() {},
    moveTo: (x: number, y: number) => calls.push(`M${x},${y}`),
    lineTo: (x: number, y: number) => calls.push(`L${x},${y}`),
    quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => calls.push(`Q${cx},${cy} ${x},${y}`),
    arc: () => calls.push("arc"),
    stroke() {},
    fill() {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, widths };
}

const pt = (x: number, y: number, p = 0.5) => ({ x, y, p });

test("curves pass through midpoints, using samples as control points", () => {
  const { ctx, calls } = recorder();
  drawStrokes(ctx, [[pt(0, 0), pt(10, 0), pt(20, 10), pt(30, 10)]], "#000");
  expect(calls).toEqual([
    "M0,0", "Q10,0 15,5", // first sample to midpoint of samples 1–2
    "M15,5", "Q20,10 25,10", // midpoint to midpoint
    "M25,10", "L30,10", // last midpoint to the final sample
  ]);
});

test("a single tap draws a dot", () => {
  const { ctx, calls } = recorder();
  drawStrokes(ctx, [[pt(5, 5)]], "#000");
  expect(calls).toEqual(["arc"]);
});

test("mouse pressure (0.5) gives the base width; pen pressure varies it", () => {
  const mouse = recorder();
  drawStrokes(mouse.ctx, [[pt(0, 0), pt(10, 0)]], "#000");
  expect(mouse.widths).toEqual([BASE_WIDTH]);

  const pen = recorder();
  const stroke: Stroke = [pt(0, 0, 0.1), pt(10, 0, 0.1), pt(20, 0, 1), pt(30, 0, 1)];
  drawStrokes(pen.ctx, [stroke], "#000");
  expect(pen.widths[0]).toBeLessThan(BASE_WIDTH);
  expect(pen.widths[pen.widths.length - 1]).toBeGreaterThan(BASE_WIDTH);
});
