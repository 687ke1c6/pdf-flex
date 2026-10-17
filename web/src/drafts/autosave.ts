// Autosave: keeps a draft of the open document in this browser as you work.
import { batch, createEffect, createMemo, createSignal, on, untrack } from "solid-js";
import { DRAFT_VERSION, draftStore } from "./draftStore";
import type { NewSlot } from "../document/pages";
import type { Placement } from "../document/placement";
import type { StoredSignature } from "../signatures/signatureStore";

/** Wait after the last change before saving, so typing doesn't write on every key. */
export const SAVE_DELAY_MS = 1000;

/** Longest `flush` waits, so a stuck write (e.g. storage blocked by another tab) can't hold up opening or closing a document. */
export const FLUSH_LIMIT_MS = 3000;

const ENABLED_KEY = "pdf-flex:drafts";

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Whether drafts are kept (the switch in About). On unless turned off. */
export const [draftsEnabled, setDraftsEnabledSignal] = createSignal(loadEnabled());

export function setDraftsEnabled(on: boolean) {
  setDraftsEnabledSignal(on);
  try {
    localStorage.setItem(ENABLED_KEY, on ? "on" : "off");
  } catch {
    // Not remembered; the choice still applies for this session.
  }
}

/** The open document, as far as drafts are concerned. */
export interface DraftDocument {
  /** The draft's id. */
  id: string;
  name: string;
  createdAt: number;
  /** The PDFs it uses that are already in storage, by id (each only needs writing once). */
  sourcesSaved?: Set<string>;
}

export type AutosaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; at: number }
  | { status: "error"; message: string };

interface Source {
  /** The pages and placements, serialised: changes to it are what get saved. Tracked. */
  version(): string;
  placements(): Placement[];
  signatures(): StoredSignature[];
  /** The page list. */
  pages?(): NewSlot[];
  /** The PDFs the pages come from (blank pages aside). */
  sources?(): { id: string; name: string; bytes: Uint8Array }[];
}

/** Keeps `doc`'s draft up to date. Each open document has its own. */
export function createAutosave(doc: DraftDocument, source: Source, store: Pick<typeof draftStore, "save"> = draftStore) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The write that's running, if one is: there's never more than one. */
  let running: Promise<void> | undefined;
  /** The version whose write last failed: not tried again until the document changes. */
  let failed: string | undefined;
  /** What's in storage for the document (at first, what it was opened with: nothing to save yet). */
  const [saved, setSaved] = createSignal(untrack(source.version));
  /** When the draft was last written in this session, if it has been. */
  const [savedAt, setSavedAt] = createSignal<number>();
  const [saving, setSaving] = createSignal(false);
  /** Why the last save failed, until one works. */
  const [error, setError] = createSignal<string>();

  const changed = () => source.version() !== saved();
  const due = () => draftsEnabled() && changed() && source.version() !== failed;

  // Worked out from the above, never set directly.
  const state = createMemo<AutosaveState>(() => {
    if (saving()) return { status: "saving" };
    const message = error();
    // A failure only matters while the document differs from what's stored (undo can bring it back).
    if (message && changed()) return { status: "error", message };
    const at = savedAt();
    return at && !changed() ? { status: "saved", at } : { status: "idle" };
  });

  /** (Re)starts the wait before saving, if there's anything to save. */
  function schedule() {
    clearTimeout(timer);
    timer = due() ? setTimeout(() => void save(), SAVE_DELAY_MS) : undefined;
  }

  // Each change restarts the wait, so a drag or typing is saved once it pauses.
  // Turning drafts on saves what changed while they were off; turning them off cancels the wait.
  createEffect(on([source.version, draftsEnabled], () => schedule(), { defer: true }));

  /** Writes the document as it is now, or joins the write already running. Changes made meanwhile wait for the next one. */
  function save(): Promise<void> {
    running ??= write().finally(() => {
      running = undefined;
      schedule();
    });
    return running;
  }

  async function write() {
    const version = source.version();
    const now = Date.now();
    const pages = source.pages?.();
    const sources = source.sources?.() ?? [];
    const stored = (doc.sourcesSaved ??= new Set());
    // Stored before, but no page uses them now (deleted, or undone): removed, and written again if they come back.
    const unused = [...stored].filter((id) => !sources.some((s) => s.id === id));
    setSaving(true);
    try {
      await store.save(
        {
          id: doc.id,
          version: DRAFT_VERSION,
          name: doc.name,
          pageCount: pages?.length ?? 0,
          size: sources.reduce((sum, s) => sum + s.bytes.length, 0),
          placements: source.placements(),
          signatures: source.signatures(),
          pages,
          sources: sources.map(({ id, name }) => ({ id, name })),
          createdAt: doc.createdAt,
          savedAt: now,
        },
        sources.filter((s) => !stored.has(s.id)),
        unused,
      );
      for (const s of sources) stored.add(s.id);
      for (const id of unused) stored.delete(id);
      failed = undefined;
      batch(() => {
        setSaved(version);
        setSavedAt(now);
        setError(undefined);
      });
    } catch (err) {
      failed = version;
      setError(err instanceof DOMException && err.name === "QuotaExceededError" ? "the browser's storage is full" : String(err));
    } finally {
      setSaving(false);
    }
  }

  /** Saves now without waiting, until storage matches the document or the latest version fails. */
  async function catchUp() {
    while (due() || running) {
      clearTimeout(timer);
      timer = undefined;
      await save();
    }
  }

  /** Catches up, waiting at most FLUSH_LIMIT_MS; past that, saving carries on in the background. */
  function flush(): Promise<void> {
    let limit: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => (limit = setTimeout(resolve, FLUSH_LIMIT_MS)));
    return Promise.race([catchUp(), timeout]).finally(() => clearTimeout(limit));
  }

  return {
    state,
    flush,
    /** Whether everything on the open document is in its draft. */
    upToDate: () => draftsEnabled() && !saving() && !changed(),
  };
}

export type Autosave = ReturnType<typeof createAutosave>;
