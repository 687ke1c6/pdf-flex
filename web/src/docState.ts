// One document's editing state. Each open document (tab) has its own; the
// editor (editor.tsx) works on the active one.
import { createSignal, type Accessor, type Setter } from "solid-js";
import { createStore, unwrap, type SetStoreFunction } from "solid-js/store";
import { createHistory, type History } from "./history";
import type { PageSize } from "./pdf";
import type { Placement } from "./placement";

/** An in-place text edit in progress. It becomes one undo step when it ends. */
export interface EditSession {
  id: string;
  /** The placements before the edit (before the box was added, if it's new). */
  before: Placement[];
  isNew: boolean;
}

/**
 * One document's editing state: what's placed on it, what's selected, the text
 * being edited, its undo history, its page sizes, and what was last downloaded.
 * Each open document (tab) has its own; the editor works on the active one.
 */
export interface DocState {
  readonly placements: Placement[];
  setPlacements: SetStoreFunction<Placement[]>;
  /** The selected placements' ids, in the order they were selected. */
  selection: Accessor<string[]>;
  setSelection: Setter<string[]>;
  /** The id of the text placement being edited in place, if any. */
  editing: Accessor<string | null>;
  setEditing: Setter<string | null>;
  /** The in-place edit in progress, if any. */
  session: EditSession | undefined;
  pages: PageSize[];
  nextPlacementId: number;
  history: History<Placement[]>;
  /** Changes whenever the history does, so canUndo/canRedo are reactive. */
  historyVersion: Accessor<number>;
  /** The placements as last downloaded (or as opened), serialised. */
  savedState: Accessor<string>;
  setSavedState: Setter<string>;
}

/** A fresh document state for a PDF with these pages. */
export function createDocState(pages: PageSize[]): DocState {
  const [placements, setPlacements] = createStore<Placement[]>([]);
  const [selection, setSelection] = createSignal<string[]>([]);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [historyVersion, setHistoryVersion] = createSignal(0);
  const [savedState, setSavedState] = createSignal("[]");
  return {
    placements,
    setPlacements,
    selection,
    setSelection,
    editing,
    setEditing,
    session: undefined,
    pages,
    nextPlacementId: 0,
    history: createHistory<Placement[]>(() => setHistoryVersion((v) => v + 1)),
    historyVersion,
    savedState,
    setSavedState,
  };
}

/** A plain copy of a document's placements. */
export const snapshotOf = (d: DocState): Placement[] => unwrap(d.placements).map((p) => ({ ...p }));

/** Whether a document has placements that haven't been downloaded. */
export const isDirty = (d: DocState) => JSON.stringify(d.placements) !== d.savedState();
