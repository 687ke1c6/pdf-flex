// Drafts: work in progress on a document, kept in this browser until discarded.
// A draft is keyed by its document's hash (see `documentId`), so opening the
// same file again finds it. Its PDF is stored separately and written once.
import { run, runAll } from "./db";
import type { Placement } from "./placement";
import type { StoredSignature } from "./signatureStore";

/** Bumped when a draft's shape changes incompatibly. */
export const DRAFT_VERSION = 1;

export interface Draft {
  /** The document's SHA-256. */
  id: string;
  version: number;
  name: string;
  pageCount: number;
  /** Size of the PDF in bytes. */
  size: number;
  placements: Placement[];
  /** Copies of the signatures its placements use, so it restores even if they're deleted from the library. */
  signatures: StoredSignature[];
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

export const draftStore = {
  get: (id: string) => run<Draft | undefined>("drafts", "readonly", (s) => s.get(id)),

  /** Every draft, most recently saved first. */
  async list(): Promise<DraftSummary[]> {
    const all = await run<Draft[]>("drafts", "readonly", (s) => s.getAll());
    return all.map(summarize).sort((a, b) => b.savedAt - a.savedAt);
  },

  /** The draft's original PDF. */
  async pdf(id: string): Promise<Uint8Array | undefined> {
    const file = await run<DraftFile | undefined>("draftFiles", "readonly", (s) => s.get(id));
    return file && new Uint8Array(await file.pdf.arrayBuffer());
  },

  /** Saves a draft, and its PDF when given (only needed the first time). */
  save: (draft: Draft, pdf?: Uint8Array) =>
    runAll(["drafts", "draftFiles"], (tx) => {
      tx.objectStore("drafts").put(draft);
      if (pdf) tx.objectStore("draftFiles").put({ id: draft.id, pdf: new Blob([pdf as Uint8Array<ArrayBuffer>]) } satisfies DraftFile);
    }),

  remove: (id: string) =>
    runAll(["drafts", "draftFiles"], (tx) => {
      tx.objectStore("drafts").delete(id);
      tx.objectStore("draftFiles").delete(id);
    }),

  clear: () =>
    runAll(["drafts", "draftFiles"], (tx) => {
      tx.objectStore("drafts").clear();
      tx.objectStore("draftFiles").clear();
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
