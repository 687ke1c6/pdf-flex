// One document's editing state. Each open document (tab) has its own; the
// editor (editor.tsx) works on the active one.
import { createSignal, type Accessor, type Setter } from "solid-js";
import { createStore, unwrap, type SetStoreFunction } from "solid-js/store";
import { createHistory, type History } from "./history";
import type { PageSize } from "../viewer/pdf";
import { slotsOf, type PagesState, type Slot, type Source } from "./pages";
import type { Placement } from "./placement";

/** An in-place text edit in progress. It becomes one undo step when it ends. */
export interface EditSession {
  id: string;
  /** The placements before the edit (before the box was added, if it's new). */
  before: Placement[];
  isNew: boolean;
}

/**
 * One document's editing state: its pages, what's placed on them, what's selected,
 * the text being edited, its undo history, and what was last downloaded.
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
  /** The page list (see pages.ts). Its sizes are what placements are kept within. */
  slots: Accessor<Slot[]>;
  setSlots: Setter<Slot[]>;
  /** Whether the pages differ from the PDF as opened (so they must be assembled to download). */
  pagesChanged: Accessor<boolean>;
  /**
   * The PDFs the slots come from, by id. Only ever added to (an undo can bring a
   * page back), and added before any slot refers to them; closed with the document.
   */
  sources: Map<string, Source>;
  nextPlacementId: number;
  nextSlotKey: number;
  history: History<PagesState>;
  /** Changes whenever the history does, so canUndo/canRedo are reactive. */
  historyVersion: Accessor<number>;
  /** The pages and placements as last downloaded (or as opened), serialised by `savedKey`. */
  savedState: Accessor<string>;
  setSavedState: Setter<string>;
}

/** A fresh document state for a PDF with these pages; `source` is its id. */
export function createDocState(pages: PageSize[], source = ""): DocState {
  const [placements, setPlacements] = createStore<Placement[]>([]);
  const [slots, setSlots] = createSignal(slotsOf(source, pages));
  const opened = savedKey(slots(), []);
  const [selection, setSelection] = createSignal<string[]>([]);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [historyVersion, setHistoryVersion] = createSignal(0);
  const [savedState, setSavedState] = createSignal(savedKey(slots(), []));
  return {
    placements,
    setPlacements,
    selection,
    setSelection,
    editing,
    setEditing,
    session: undefined,
    slots,
    setSlots,
    pagesChanged: () => savedKey(slots(), []) !== opened,
    sources: new Map(),
    nextPlacementId: 0,
    nextSlotKey: pages.length,
    history: createHistory<PagesState>(() => setHistoryVersion((v) => v + 1)),
    historyVersion,
    savedState,
    setSavedState,
  };
}

/** A plain copy of a document's placements. */
export const snapshotOf = (d: DocState): Placement[] => unwrap(d.placements).map((p) => ({ ...p }));

/** A plain copy of a document's pages and placements: an undo step. */
export const stateOf = (d: DocState): PagesState => ({ slots: d.slots(), placements: snapshotOf(d) });

/** What `isDirty` compares: the pages (by what they show, not their keys) and the placements. */
export const savedKey = (slots: Slot[], placements: readonly Placement[]) =>
  JSON.stringify([slots.map((s) => [s.source, s.index]), placements]);

/** Whether a document has changes (pages or placements) that haven't been downloaded. */
export const isDirty = (d: DocState) => savedKey(d.slots(), d.placements) !== d.savedState();
