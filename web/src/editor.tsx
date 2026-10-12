// Editing state: the signature library, which signature is active, where signatures are placed, and what's selected.
import { createContext, createSignal, useContext, type ParentProps } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import type { PageSize } from "./pdf";
import { centeredAt, type Box, type Placement, type Point } from "./placement";
import {
  exportSignatures,
  newSignatureId,
  parseSignatureExport,
  requestPersistence,
  signatureStore,
  type SignatureRecipe,
  type SignatureSource,
  type StoredSignature,
} from "./signatureStore";

/** A library signature plus what the UI needs to show it. */
export interface Signature extends StoredSignature {
  /** Object URL of the PNG. */
  url: string;
}

/** A new signature to add, before it has an id or timestamps. */
export interface NewSignature {
  name: string;
  source: SignatureSource;
  png: Blob;
  width: number;
  height: number;
  recipe?: SignatureRecipe;
}

/** Default width of a newly placed signature, in points (about 2 in). */
const DEFAULT_WIDTH = 150;
/** MIME type for dragging a signature from the sidebar onto a page; the data is the signature id. */
export const SIGNATURE_DRAG_TYPE = "application/x-pdf-sign-signature";

const withUrl = (sig: StoredSignature): Signature => ({ ...sig, url: URL.createObjectURL(sig.png) });

function createEditor() {
  const [library, setLibrary] = createStore<Signature[]>([]);
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [placements, setPlacements] = createStore<Placement[]>([]);
  const [selected, setSelected] = createSignal<string | null>(null);
  let pages: PageSize[] = [];
  let nextPlacementId = 0;

  const signature = (id: string | null | undefined) => library.find((s) => s.id === id);
  /** Store records are proxies (including nested ones like a recipe), which IndexedDB can't clone. */
  const toStored = (sig: Signature): StoredSignature => {
    const { url: _url, ...stored } = unwrap(sig);
    return stored;
  };
  const save = (sig: Signature) => signatureStore.put(toStored(sig));

  async function addToLibrary(sigs: StoredSignature[]) {
    for (const sig of sigs) await signatureStore.put(sig);
    setLibrary((list) => [...sigs.map(withUrl), ...list]);
    void requestPersistence();
  }

  return {
    library,
    signature,
    /** The signature that "Place on page" and new drags use. */
    active: () => signature(activeId()),
    setActive: setActiveId,
    placements,
    selected,
    select: setSelected,

    /** Loads the saved library. Call once at startup. */
    async loadLibrary() {
      const stored = await signatureStore.list();
      setLibrary(stored.map(withUrl));
      setActiveId(stored[0]?.id ?? null);
    },

    async addSignature(sig: NewSignature) {
      const now = Date.now();
      // Unwrap in case the caller's recipe came from a store: IndexedDB can't clone proxies.
      const recipe = sig.recipe && structuredClone(unwrap(sig.recipe));
      const stored: StoredSignature = { ...sig, recipe, id: newSignatureId(), createdAt: now, lastUsedAt: now };
      await addToLibrary([stored]);
      setActiveId(stored.id);
    },

    async renameSignature(id: string, name: string) {
      const sig = signature(id);
      if (!sig || !name.trim()) return;
      setLibrary((s) => s.id === id, "name", name.trim());
      await save(signature(id)!);
    },

    isInUse: (id: string) => placements.some((p) => p.signatureId === id),

    /** Deletes a signature. Refuses (returns false) while it's placed in the open document. */
    async deleteSignature(id: string): Promise<boolean> {
      const sig = signature(id);
      if (!sig || placements.some((p) => p.signatureId === id)) return false;
      await signatureStore.remove(id);
      URL.revokeObjectURL(sig.url);
      setLibrary((list) => list.filter((s) => s.id !== id));
      if (activeId() === id) setActiveId(library[0]?.id ?? null);
      return true;
    },

    exportLibrary: () => exportSignatures(library.map(toStored)),

    /** Adds the signatures from an export file; returns how many were added. */
    async importLibrary(text: string): Promise<number> {
      const sigs = parseSignatureExport(text);
      await addToLibrary(sigs);
      return sigs.length;
    },

    /** Call when a new document is opened: clears placements made on the old one. */
    reset(newPages: PageSize[]) {
      pages = newPages;
      setPlacements([]);
      setSelected(null);
    },

    /** Places a signature (default: the active one) centred on `center` in points, or the page centre. */
    add(page: number, center?: Point, signatureId = activeId()) {
      const sig = signature(signatureId);
      const size = pages[page - 1];
      if (!sig || !size) return;
      setActiveId(sig.id);

      const width = Math.min(DEFAULT_WIDTH, size.width / 2);
      const box = centeredAt(center ?? { x: size.width / 2, y: size.height / 2 }, width, sig.width / sig.height, size);
      const id = `p${nextPlacementId++}`;
      setPlacements(placements.length, { id, signatureId: sig.id, page, ...box });
      setSelected(id);

      // Remember use for ordering next session; the list doesn't reshuffle under the user now.
      setLibrary((s) => s.id === sig.id, "lastUsedAt", Date.now());
      void save(signature(sig.id)!);
    },

    update(id: string, box: Box) {
      setPlacements((p) => p.id === id, box);
    },

    remove(id: string) {
      setPlacements((list) => list.filter((p) => p.id !== id));
      if (selected() === id) setSelected(null);
    },
  };
}

export type Editor = ReturnType<typeof createEditor>;

const EditorContext = createContext<Editor>();

export function EditorProvider(props: ParentProps) {
  return <EditorContext.Provider value={createEditor()}>{props.children}</EditorContext.Provider>;
}

export function useEditor(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error("useEditor must be used inside <EditorProvider>");
  return editor;
}
