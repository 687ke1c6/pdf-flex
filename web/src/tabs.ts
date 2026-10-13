// Tabs: one per open document (or an empty one, showing the start screen).
// Each document's session holds everything that belongs to it: the file, its
// editing state, its draft and autosave, and where it was zoomed and scrolled.
import { createEffect, createRoot, createSignal, on, type Accessor, type Setter } from "solid-js";
import { createAutosave, type Autosave, type DraftDocument } from "./autosave";
import type { Draft } from "./draftStore";
import { createDocState, isDirty, snapshotOf, type DocState } from "./docState";
import type { Editor } from "./editor";
import type { LoadedPdf } from "./pdf";
import type { ScrollPosition } from "./Viewer";

export interface DocSession {
  /** The document's identity (SHA-256), as drafts know it. */
  id: string;
  name: string;
  /** The untouched original, which is what gets stamped. */
  bytes: Uint8Array;
  pdf: LoadedPdf;
  state: DocState;
  autosave: Autosave;
  zoom: Accessor<number>;
  setZoom: Setter<number>;
  page: Accessor<number>;
  setPage: Setter<number>;
  /** Where it was scrolled to when last shown. */
  scroll?: ScrollPosition;
  /** A draft found when it was opened, offered for restoring. */
  offer: Accessor<Draft | null>;
  setOffer: Setter<Draft | null>;
  /** Found when it was opened: it can't be edited, it's digitally signed, … */
  warning: Accessor<string>;
  setWarning: Setter<string>;
  saving: Accessor<boolean>;
  setSaving: Setter<boolean>;
  /** Closing it now would lose work: not downloaded, and not safely in a draft. */
  atRisk(): boolean;
  /** Stops its autosave and frees its PDF. */
  dispose(): void;
}

export interface Tab {
  key: number;
  /** The open document, or null for an empty tab (the start screen). */
  session: DocSession | null;
  /** A tab brought back after a reload, whose document loads when it's first shown. */
  pending?: { id: string; name: string };
}

let nextKey = 0;
export const emptyTab = (): Tab => ({ key: nextKey++, session: null });
export const pendingTab = (id: string, name: string): Tab => ({ key: nextKey++, session: null, pending: { id, name } });
export const docTab = (session: DocSession): Tab => ({ key: nextKey++, session });

/** Whether a tab has no document (it shows the start screen). */
export const isEmptyTab = (tab: Tab) => !tab.session && !tab.pending;

/**
 * Keeps the tab rule: document tabs in their order, then at most one empty
 * tab, always last. `keep` is the empty tab to keep if there are several (the
 * one in front). There's always at least one tab.
 */
export function arrangeTabs(list: Tab[], keep?: number): Tab[] {
  const docs = list.filter((t) => !isEmptyTab(t));
  const empties = list.filter(isEmptyTab);
  const empty = empties.find((t) => t.key === keep) ?? empties[0];
  if (empty) return [...docs, empty];
  return docs.length ? docs : [emptyTab()];
}

/** The document id a tab holds or will hold, if any. */
export const tabDocId = (tab: Tab) => tab.session?.id ?? tab.pending?.id;
/** What a tab is called: its document's name, or "New tab". */
export const tabName = (tab: Tab) => tab.session?.name ?? tab.pending?.name ?? "New tab";

/**
 * A session for an opened PDF, with its own reactive scope: its autosave keeps
 * running while other tabs are in front, and `dispose` ends it.
 */
export function createSession(init: { id: string; name: string; bytes: Uint8Array; pdf: LoadedPdf; draft?: Draft }, editor: Editor): DocSession {
  return createRoot((disposeRoot) => {
    const state = createDocState(init.pdf.pages);
    const draftDoc: DraftDocument = {
      id: init.id,
      name: init.name,
      bytes: init.bytes,
      pageCount: init.pdf.pages.length,
      createdAt: init.draft?.createdAt ?? Date.now(),
      fileSaved: !!init.draft,
    };
    const autosave = createAutosave({
      doc: () => draftDoc,
      version: () => JSON.stringify(state.placements),
      placements: () => snapshotOf(state),
      signatures: () => editor.usedSignatures(state),
    });
    const [zoom, setZoom] = createSignal(1);
    const [page, setPage] = createSignal(1);
    const [offer, setOffer] = createSignal<Draft | null>(null);
    const [warning, setWarning] = createSignal("");
    const [saving, setSaving] = createSignal(false);

    // Starting work while a draft is on offer means starting over.
    createEffect(
      on(
        () => JSON.stringify(state.placements),
        () => offer() && state.placements.length && setOffer(null),
        { defer: true },
      ),
    );

    return {
      id: init.id,
      name: init.name,
      bytes: init.bytes,
      pdf: init.pdf,
      state,
      autosave,
      zoom,
      setZoom,
      page,
      setPage,
      offer,
      setOffer,
      warning,
      setWarning,
      saving,
      setSaving,
      atRisk: () => isDirty(state) && !autosave.upToDate(),
      dispose() {
        disposeRoot();
        void init.pdf.close();
      },
    };
  });
}

// --- Tab mode (Settings): with it off, there's one document at a time and no tab bar ---

const TABS_MODE_KEY = "pdf-flex:tabs-mode";

function loadTabsMode(): boolean {
  try {
    return localStorage.getItem(TABS_MODE_KEY) === "on";
  } catch {
    return false;
  }
}

/** Whether documents open in tabs. Off unless turned on. */
export const [tabsMode, setTabsModeSignal] = createSignal(loadTabsMode());

export function setTabsMode(on: boolean) {
  setTabsModeSignal(on);
  try {
    localStorage.setItem(TABS_MODE_KEY, on ? "on" : "off");
  } catch {
    // Not remembered; the choice still applies for this session.
  }
}

// --- Remembering open tabs across reloads ---

const TABS_KEY = "pdf-flex:tabs";

interface SavedTabs {
  /** Document ids, in tab order. */
  ids: string[];
  /** Which of them was in front. */
  active: number;
}

/** The tabs open last time, by document id. Storage may be unavailable (private mode, blocked). */
export function savedTabs(): SavedTabs {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_KEY) ?? "null") as SavedTabs | null;
    if (saved && Array.isArray(saved.ids)) return { ids: saved.ids.filter((id) => typeof id === "string"), active: Number(saved.active) || 0 };
  } catch {
    // Nothing remembered.
  }
  return { ids: [], active: 0 };
}

/** Remembers the open tabs (empty ones aren't worth keeping). */
export function saveTabs(tabs: Tab[], activeKey: number) {
  const docs = tabs.filter((t) => tabDocId(t));
  const saved: SavedTabs = {
    ids: docs.map((t) => tabDocId(t)!),
    active: Math.max(0, docs.findIndex((t) => t.key === activeKey)),
  };
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(saved));
  } catch {
    // Not remembered; tabs just won't come back after a reload.
  }
}
