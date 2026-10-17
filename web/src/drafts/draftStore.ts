// Drafts: work in progress, kept in this browser until discarded. A draft has
// its own id and records the PDFs its pages come from by their hash (see
// `documentId`), so opening a file finds the drafts that use it. Each of those
// PDFs is stored with the draft, keyed `<draft id>:<source id>`, and written once.
import { run, runAll } from "../common/db";
import type { NewSlot } from "../document/pages";
import type { Placement } from "../document/placement";
import type { StoredSignature } from "../signatures/signatureStore";

/** Bumped when a draft's shape changes incompatibly (and old drafts migrated: see migrate.ts). */
export const DRAFT_VERSION = 2;

export interface Draft {
  /** Its own id, given when its session was created. (Drafts from version 1 keep their document's hash.) */
  id: string;
  version: number;
  /** The name of the file it was started from. */
  name: string;
  pageCount: number;
  /** Size in bytes of the PDFs stored with it. */
  size: number;
  placements: Placement[];
  /** Copies of the signatures its placements use, so it restores even if they're deleted from the library. */
  signatures: StoredSignature[];
  /** The page list. Absent in drafts from version 1 without page changes: every page of the first source. */
  pages?: NewSlot[];
  /** Every PDF its pages come from (blank pages aside), by hash, in order of first use. */
  sources: { id: string; name: string }[];
  createdAt: number;
  savedAt: number;
}

interface DraftFile {
  id: string;
  pdf: Blob;
}

/** What the Recent list shows. */
export interface DraftSummary {
  id: string;
  name: string;
  pageCount: number;
  size: number;
  items: number;
  savedAt: number;
}

export const summarize = (d: Draft): DraftSummary => ({
  id: d.id,
  name: d.name,
  pageCount: d.pageCount,
  size: d.size,
  items: d.placements.length,
  savedAt: d.savedAt,
});

const KINDS = new Set<string>(["image", "text", "shape"] satisfies Placement["kind"][]);

/**
 * The placements of a stored draft that this version of the app can show.
 * Drafts from a newer version may hold kinds it doesn't know; those are left out
 * rather than failing the whole restore.
 */
export const usablePlacements = (d: Draft): Placement[] => d.placements.filter((p) => KINDS.has(p.kind));

/** The ids of the PDFs a draft's pages use. */
export const sourcesUsed = (d: Draft): string[] => (d.pages ? [...new Set(d.pages.map((p) => p.source))] : d.sources.slice(0, 1).map((s) => s.id));

/** Where a PDF a draft uses is stored. */
const fileKey = (draftId: string, sourceId: string) => `${draftId}:${sourceId}`;

export const draftStore = {
  get: (id: string) => run<Draft | undefined>("drafts", "readonly", (s) => s.get(id)),

  /** Every draft, most recently saved first. */
  async list(): Promise<DraftSummary[]> {
    const all = await run<Draft[]>("drafts", "readonly", (s) => s.getAll());
    return all.map(summarize).sort((a, b) => b.savedAt - a.savedAt);
  },

  /** The drafts whose pages use a PDF (by hash), most recently saved first. */
  async matching(sourceId: string): Promise<Draft[]> {
    const all = await run<Draft[]>("drafts", "readonly", (s) => s.getAll());
    return all.filter((d) => sourcesUsed(d).includes(sourceId)).sort((a, b) => b.savedAt - a.savedAt);
  },

  /** A PDF a draft uses, as stored with it. */
  async file(draftId: string, sourceId: string): Promise<Uint8Array | undefined> {
    const file = await run<DraftFile | undefined>("draftFiles", "readonly", (s) => s.get(fileKey(draftId, sourceId)));
    return file && new Uint8Array(await file.pdf.arrayBuffer());
  },

  /**
   * Saves a draft and the PDFs in `files` (each only needs writing once). Stored
   * PDFs in `drop` (by source id) are deleted: no page uses them any more.
   */
  save: (draft: Draft, files: { id: string; bytes: Uint8Array }[] = [], drop: string[] = []) =>
    runAll(["drafts", "draftFiles"], (tx) => {
      tx.objectStore("drafts").put(draft);
      const store = tx.objectStore("draftFiles");
      for (const f of files) store.put({ id: fileKey(draft.id, f.id), pdf: new Blob([f.bytes as Uint8Array<ArrayBuffer>]) } satisfies DraftFile);
      for (const id of drop) store.delete(fileKey(draft.id, id));
    }),

  remove: (id: string) =>
    runAll(["drafts", "draftFiles"], (tx) => {
      tx.objectStore("drafts").delete(id);
      // Its PDFs: every key "<id>:…".
      tx.objectStore("draftFiles").delete(IDBKeyRange.bound(fileKey(id, ""), fileKey(id, "\uffff")));
    }),
};

/** "14:32" today, "Yesterday 14:32", or a date, for when a draft was saved. */
export function formatSavedAt(savedAt: number, now = Date.now()): string {
  const saved = new Date(savedAt);
  const time = saved.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const day = (t: number) => new Date(t).toDateString();
  if (day(savedAt) === day(now)) return time;
  if (day(savedAt) === day(now - 86_400_000)) return `Yesterday ${time}`;
  return saved.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "820 KB", "3.4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
