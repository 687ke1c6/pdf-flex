// Undo/redo as a stack of snapshots. Snapshots are whole copies of the state,
// which is cheap for the handful of placements a document has.

export interface History<T> {
  /**
   * Records `current` as the state to return to, before it is changed. Calls
   * with the same non-empty `tag` in a row are merged into one step, so a drag
   * or a burst of arrow-key nudges undoes in one go.
   */
  checkpoint(current: T, tag?: string): void;
  /** Ends a merged step: the next checkpoint starts a new one even with the same tag. */
  seal(): void;
  /** Returns the state to restore, or `undefined` if there is nothing to undo. */
  undo(current: T): T | undefined;
  redo(current: T): T | undefined;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

export function createHistory<T>(onChange: () => void = () => {}, limit = 200): History<T> {
  let past: T[] = [];
  let future: T[] = [];
  let lastTag: string | undefined;

  return {
    checkpoint(current, tag) {
      if (!tag || tag !== lastTag) {
        past.push(current);
        if (past.length > limit) past.shift();
      }
      lastTag = tag;
      future = [];
      onChange();
    },
    seal() {
      lastTag = undefined;
    },
    undo(current) {
      const previous = past.pop();
      if (previous === undefined) return undefined;
      future.push(current);
      lastTag = undefined;
      onChange();
      return previous;
    },
    redo(current) {
      const next = future.pop();
      if (next === undefined) return undefined;
      past.push(current);
      lastTag = undefined;
      onChange();
      return next;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() {
      past = [];
      future = [];
      lastTag = undefined;
      onChange();
    },
  };
}
