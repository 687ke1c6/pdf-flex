// Autosave: keeps a draft of the open document in this browser as you work.
import { createEffect, createSignal, on } from "solid-js";
import { DRAFT_VERSION, draftStore } from "./draftStore";
import type { Placement } from "./placement";
import type { StoredSignature } from "./signatureStore";

/** Wait after the last change before saving, so typing doesn't write on every key. */
export const SAVE_DELAY_MS = 1000;

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
  id: string;
  name: string;
  bytes: Uint8Array;
  pageCount: number;
  createdAt: number;
  /** Its PDF is already in storage (it only needs writing once). */
  fileSaved: boolean;
}

export type AutosaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; at: number }
  | { status: "error"; message: string };

interface Source {
  doc(): DraftDocument | null;
  /** The placements, serialised: changes to it are what get saved. Tracked. */
  version(): string;
  placements(): Placement[];
  signatures(): StoredSignature[];
}

export function createAutosave(source: Source) {
  const [state, setState] = createSignal<AutosaveState>({ status: "idle" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** What's in storage for the current document (or what it had when opened). */
  let saved = "";

  // A new document starts from what it was opened with: nothing to save yet.
  createEffect(
    on(source.doc, () => {
      clearTimeout(timer);
      timer = undefined;
      saved = source.version();
      setState({ status: "idle" });
    }),
  );

  createEffect(
    on(
      source.version,
      (version) => {
        if (!source.doc() || !draftsEnabled() || version === saved) return;
        clearTimeout(timer);
        timer = setTimeout(save, SAVE_DELAY_MS);
      },
      { defer: true },
    ),
  );

  async function save() {
    timer = undefined;
    const doc = source.doc();
    if (!doc || !draftsEnabled()) return;
    const version = source.version();
    setState({ status: "saving" });
    try {
      const now = Date.now();
      await draftStore.save(
        {
          id: doc.id,
          version: DRAFT_VERSION,
          name: doc.name,
          pageCount: doc.pageCount,
          size: doc.bytes.length,
          placements: source.placements(),
          signatures: source.signatures(),
          createdAt: doc.createdAt,
          savedAt: now,
        },
        doc.fileSaved ? undefined : doc.bytes,
      );
      doc.fileSaved = true;
      saved = version;
      setState({ status: "saved", at: now });
    } catch (err) {
      const message = err instanceof DOMException && err.name === "QuotaExceededError" ? "the browser's storage is full" : String(err);
      setState({ status: "error", message });
    }
  }

  return {
    state,
    /** Saves now if a save is waiting. */
    async flush() {
      if (!timer) return;
      clearTimeout(timer);
      await save();
    },
    /** Whether everything on the open document is in its draft. */
    upToDate: () => draftsEnabled() && !timer && state().status !== "error" && source.version() === saved,
    /** Call after drafts are deleted: the open document's draft has to be written again from scratch. */
    forget() {
      const doc = source.doc();
      if (doc) doc.fileSaved = false;
      clearTimeout(timer);
      timer = undefined;
      saved = "";
      setState({ status: "idle" });
    },
  };
}

export type Autosave = ReturnType<typeof createAutosave>;
