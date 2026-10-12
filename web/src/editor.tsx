// Editing state: the signature image, where it's placed, and what's selected.
import { createContext, createSignal, useContext, type ParentProps } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { PageSize } from "./pdf";
import { centeredAt, clampToPage, type Box, type Placement, type Point } from "./placement";

export interface Signature {
  name: string;
  bytes: Uint8Array;
  /** Object URL for showing the image. */
  url: string;
  /** width / height */
  aspect: number;
}

/** Default width of a newly placed signature, in points (about 2 in). */
const DEFAULT_WIDTH = 150;
/** MIME type for dragging the signature from the sidebar onto a page. */
export const SIGNATURE_DRAG_TYPE = "application/x-pdf-sign-signature";

function createEditor() {
  const [signature, setSignatureSignal] = createSignal<Signature | null>(null);
  const [placements, setPlacements] = createStore<Placement[]>([]);
  const [selected, setSelected] = createSignal<string | null>(null);
  let pages: PageSize[] = [];
  let nextId = 0;

  return {
    signature,
    placements,
    selected,
    select: setSelected,

    /** Call when a new document is opened: clears placements made on the old one. */
    reset(newPages: PageSize[]) {
      pages = newPages;
      setPlacements([]);
      setSelected(null);
    },

    async loadSignature(file: File) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const blob = new Blob([bytes], { type: file.type });
      // Decode once here for the aspect ratio; this also rejects files that aren't images.
      const bitmap = await createImageBitmap(blob);
      const aspect = bitmap.width / bitmap.height;
      bitmap.close();

      const old = signature();
      if (old) URL.revokeObjectURL(old.url);
      setSignatureSignal({ name: file.name, bytes, url: URL.createObjectURL(blob), aspect });

      // Existing placements keep their width and take the new image's proportions.
      setPlacements(
        produce((list) => {
          for (const p of list) Object.assign(p, clampToPage({ ...p, height: p.width / aspect }, pages[p.page - 1]));
        }),
      );
    },

    /** Places the signature centred on `center` (display-space points), or the page centre. */
    add(page: number, center?: Point) {
      const sig = signature();
      const size = pages[page - 1];
      if (!sig || !size) return;
      const width = Math.min(DEFAULT_WIDTH, size.width / 2);
      const box = centeredAt(center ?? { x: size.width / 2, y: size.height / 2 }, width, sig.aspect, size);
      const id = `p${nextId++}`;
      setPlacements(placements.length, { id, page, ...box });
      setSelected(id);
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
