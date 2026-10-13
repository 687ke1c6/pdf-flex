import { describe, expect, test } from "bun:test";
import { createHistory } from "./history";

describe("history", () => {
  test("undoes and redoes in order", () => {
    const h = createHistory<number>();
    let state = 0;
    const change = (next: number) => {
      h.checkpoint(state);
      state = next;
    };
    change(1);
    change(2);
    state = h.undo(state)!;
    expect(state).toBe(1);
    state = h.undo(state)!;
    expect(state).toBe(0);
    expect(h.undo(state)).toBeUndefined();
    state = h.redo(state)!;
    state = h.redo(state)!;
    expect(state).toBe(2);
    expect(h.canRedo()).toBe(false);
  });

  test("a new change clears redo", () => {
    const h = createHistory<number>();
    h.checkpoint(0);
    const undone = h.undo(1)!;
    h.checkpoint(undone);
    expect(h.canRedo()).toBe(false);
  });

  test("merges checkpoints with the same tag until sealed", () => {
    const h = createHistory<number>();
    h.checkpoint(0, "nudge:a");
    h.checkpoint(1, "nudge:a");
    h.checkpoint(2, "nudge:a");
    expect(h.undo(3)).toBe(0);
    expect(h.canUndo()).toBe(false);

    h.checkpoint(0, "nudge:a");
    h.seal();
    h.checkpoint(1, "nudge:a");
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBe(0);
  });

  test("keeps at most `limit` steps", () => {
    const h = createHistory<number>(undefined, 2);
    for (const n of [0, 1, 2]) h.checkpoint(n);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBe(1);
    expect(h.canUndo()).toBe(false);
  });
});
