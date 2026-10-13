// Editing state: the active tool, the signature library, what's placed where, what's selected, and text being edited.
import { createContext, createMemo, createSignal, useContext, type ParentProps } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import type { PageSize } from "./pdf";
import { createHistory } from "./history";
import {
  centeredAt,
  clampToPage,
  keptOnPage,
  moved,
  type Box,
  type Corner,
  type Placement,
  type Point,
  type TextPlacement,
} from "./placement";
import { savedTool, saveTool, type Tool } from "./ToolRail";
import { LINE_HEIGHT, opposite, relaidOut, resizedTextSize, type TextStyle } from "./textLayout";
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
export const SIGNATURE_DRAG_TYPE = "application/x-pdf-flex-signature";

const withUrl = (sig: StoredSignature): Signature => ({ ...sig, url: URL.createObjectURL(sig.png) });

const TEXT_STYLE_KEY = "pdf-flex:text-style";
const DEFAULT_TEXT_STYLE: TextStyle = { family: "Helvetica", bold: false, italic: false, size: 12, color: "#000000", align: "left" };

/** The text style used last time. Storage may be unavailable (private mode, blocked). */
function savedTextStyle(): TextStyle {
  try {
    const saved = JSON.parse(localStorage.getItem(TEXT_STYLE_KEY) ?? "null");
    return { ...DEFAULT_TEXT_STYLE, ...saved };
  } catch {
    return DEFAULT_TEXT_STYLE;
  }
}

function saveTextStyle(style: TextStyle) {
  try {
    localStorage.setItem(TEXT_STYLE_KEY, JSON.stringify(style));
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

/** An in-place text edit in progress. It becomes one undo step when it ends. */
interface EditSession {
  id: string;
  /** The placements before the edit (before the box was added, if it's new). */
  before: Placement[];
  isNew: boolean;
}

function createEditor() {
  const [library, setLibrary] = createStore<Signature[]>([]);
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [placements, setPlacements] = createStore<Placement[]>([]);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [tool, setToolSignal] = createSignal<Tool>(savedTool());
  const [textStyle, setTextStyleSignal] = createSignal<TextStyle>(savedTextStyle());
  const [editing, setEditing] = createSignal<string | null>(null);
  let session: EditSession | undefined;
  let pages: PageSize[] = [];
  let nextPlacementId = 0;

  // Undo/redo over the placements. The version signal makes canUndo/canRedo reactive.
  const [historyVersion, setHistoryVersion] = createSignal(0);
  const history = createHistory<Placement[]>(() => setHistoryVersion((v) => v + 1));
  const snapshot = () => unwrap(placements).map((p) => ({ ...p }));
  /** Call before every change to the placements. `tag` merges a run of changes into one undo step. */
  const checkpoint = (tag?: string) => history.checkpoint(snapshot(), tag);
  function restore(state: Placement[] | undefined) {
    if (!state) return;
    endEdit();
    // A signature may have been deleted from the library since; its placements can't come back.
    state = state.filter((p) => p.kind !== "image" || library.some((s) => s.id === p.signatureId));
    setPlacements(state);
    if (!state.some((p) => p.id === selected())) setSelected(null);
  }

  // Unsaved changes: the placements differ from those at the last download (or open).
  const [savedState, setSavedState] = createSignal("[]");
  const dirty = createMemo(() => JSON.stringify(placements) !== savedState());

  const signature = (id: string | null | undefined) => library.find((s) => s.id === id);
  const usesSignature = (id: string) => placements.some((p) => p.kind === "image" && p.signatureId === id);
  /** Store records are proxies (including nested ones like a recipe), which IndexedDB can't clone. */
  const toStored = (sig: Signature): StoredSignature => {
    const { url: _url, ...stored } = unwrap(sig);
    return stored;
  };
  const save = (sig: Signature) => signatureStore.put(toStored(sig));

  const textPlacement = (id: string | null | undefined) =>
    placements.find((p): p is TextPlacement => p.id === id && p.kind === "text");

  /** Changes a text placement's text or style, re-laying it out with `anchor` fixed. */
  function setText(p: TextPlacement, text: string, style: TextStyle, anchor: Corner = "nw") {
    const size = pages[p.page - 1];
    const box = relaidOut(p, text, style, anchor);
    setPlacements((q) => q.id === p.id, { text, style, ...(size ? keptOnPage(box, size) : box) });
  }

  /** Ends the in-place edit, if any: empty text is removed, and a change becomes one undo step. */
  function endEdit() {
    const current = session;
    if (!current) return;
    session = undefined;
    setEditing(null);
    const p = textPlacement(current.id);
    if (!p) return;
    const empty = !p.text.trim();
    const before = current.before.find((q): q is TextPlacement => q.id === p.id && q.kind === "text");
    const changed = current.isNew
      ? !empty
      : before?.text !== p.text || JSON.stringify(before.style) !== JSON.stringify(p.style);
    if (changed || (empty && !current.isNew)) history.checkpoint(current.before);
    if (empty) {
      setPlacements((list) => list.filter((q) => q.id !== p.id));
      if (selected() === p.id) setSelected(null);
    }
  }

  function select(id: string | null) {
    if (editing() && editing() !== id) endEdit();
    setSelected(id);
  }

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
    select,

    /** The tool whose panel is open; it decides what clicking a page does. */
    tool,
    setTool(next: Tool) {
      setToolSignal(next);
      saveTool(next);
    },

    /** The selected placement, if it's text. */
    selectedText: () => textPlacement(selected()),
    /** The style the next text box gets. */
    textStyle,
    /** The id of the text placement being edited in place, if any. */
    editing,

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

    isInUse: usesSignature,

    /** Deletes a signature. Refuses (returns false) while it's placed in the open document. */
    async deleteSignature(id: string): Promise<boolean> {
      const sig = signature(id);
      if (!sig || usesSignature(id)) return false;
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

    /** Call when a new document is opened: clears placements made on the old one, and their history. */
    reset(newPages: PageSize[]) {
      session = undefined;
      setEditing(null);
      pages = newPages;
      setPlacements([]);
      setSelected(null);
      history.clear();
      setSavedState("[]");
    },

    /** Size of a page in points (1-based), if it exists. */
    pageSize: (page: number): PageSize | undefined => pages[page - 1],

    /** Whether there are placements that haven't been downloaded. */
    dirty,
    /** Call after the edited PDF has been downloaded. */
    markSaved() {
      setSavedState(JSON.stringify(placements));
    },

    canUndo: () => (historyVersion(), history.canUndo()),
    canRedo: () => (historyVersion(), history.canRedo()),
    undo: () => restore(history.undo(snapshot())),
    redo: () => restore(history.redo(snapshot())),
    /** Ends a merged change (a drag), so the next one is a separate undo step. */
    endChange: () => history.seal(),

    /** Places a signature (default: the active one) centred on `center` in points, or the page centre. */
    add(page: number, center?: Point, signatureId = activeId()) {
      const sig = signature(signatureId);
      const size = pages[page - 1];
      if (!sig || !size) return;
      setActiveId(sig.id);

      const width = Math.min(DEFAULT_WIDTH, size.width / 2);
      const box = centeredAt(center ?? { x: size.width / 2, y: size.height / 2 }, width, sig.width / sig.height, size);
      const id = `p${nextPlacementId++}`;
      checkpoint();
      setPlacements(placements.length, { id, kind: "image", signatureId: sig.id, page, ...box });
      setSelected(id);

      // Remember use for ordering next session; the list doesn't reshuffle under the user now.
      setLibrary((s) => s.id === sig.id, "lastUsedAt", Date.now());
      void save(signature(sig.id)!);
    },

    /**
     * Moves or resizes a placement, optionally onto another page (where it is
     * kept within the page). Changes with the same `tag` undo as one step until
     * `endChange` is called; drags pass one.
     */
    update(id: string, box: Box, page?: number, tag?: string) {
      const current = placements.find((p) => p.id === id);
      if (!current) return;
      const target = page ?? current.page;
      const size = pages[target - 1];
      if (!size) return;
      const next = { ...(current.kind === "text" ? keptOnPage(box, size) : clampToPage(box, size)), page: target };
      const same = (Object.keys(next) as (keyof typeof next)[]).every((k) => next[k] === current[k]);
      if (same) return;
      checkpoint(tag);
      setPlacements((p) => p.id === id, next);
    },

    /** Moves the selected placement by (dx, dy) points; a run of nudges undoes as one step. */
    nudge(dx: number, dy: number) {
      const current = placements.find((p) => p.id === selected());
      const size = current && pages[current.page - 1];
      if (!current || !size) return;
      checkpoint(`nudge:${current.id}`);
      const box = { x: current.x + dx, y: current.y + dy, width: current.width, height: current.height };
      setPlacements((p) => p.id === current.id, current.kind === "text" ? keptOnPage(box, size) : moved(current, dx, dy, size));
    },

    /**
     * Adds an empty text box and starts editing it. `at` (points) is where the
     * middle of its first line goes; by default, the middle of the page.
     */
    addText(page: number, at?: Point) {
      const size = pages[page - 1];
      if (!size) return;
      endEdit();
      const style = textStyle();
      const point = at ?? { x: size.width / 2, y: size.height / 2 };
      const half = (style.size * LINE_HEIGHT) / 2;
      const box = relaidOut({ x: point.x, y: point.y - half, width: 0, height: 2 * half }, "", style);
      const id = `p${nextPlacementId++}`;
      session = { id, before: snapshot(), isNew: true };
      setPlacements(placements.length, { id, kind: "text", text: "", style, page, ...keptOnPage(box, size) });
      setSelected(id);
      setEditing(id);
    },

    /** Starts editing a text placement in place. */
    beginEdit(id: string) {
      if (!textPlacement(id) || editing() === id) return;
      endEdit();
      session = { id, before: snapshot(), isNew: false };
      setSelected(id);
      setEditing(id);
    },

    /** Replaces the text being edited (no undo step of its own: the edit is one). */
    typeText(id: string, text: string) {
      const p = textPlacement(id);
      if (p) setText(p, text.replace(/\r\n?/g, "\n"), p.style);
    },

    endEdit,

    /**
     * Changes the style of the selected text box, if any, and of the next one.
     * Changes with the same `tag` (e.g. typing a size) undo as one step.
     */
    setTextStyle(change: Partial<TextStyle>, tag?: string) {
      const next = { ...textStyle(), ...change };
      setTextStyleSignal(next);
      saveTextStyle(next);
      const p = textPlacement(selected());
      if (!p) return;
      const style = { ...p.style, ...change };
      if (JSON.stringify(style) === JSON.stringify(p.style)) return;
      // Mid-edit, the change is part of the edit's undo step.
      if (!session) checkpoint(tag && `style:${p.id}:${tag}`);
      setText(p, p.text, style);
      setTextStyleSignal({ ...style });
      saveTextStyle(style);
    },

    /** Resizes a text box by dragging `corner`: its font size follows. One drag is one undo step. */
    resizeText(id: string, start: TextPlacement, corner: Corner, pointer: Point) {
      const p = textPlacement(id);
      const size = pages[start.page - 1];
      if (!p || !size) return;
      const fontSize = resizedTextSize(start, start.style.size, corner, pointer, size);
      if (fontSize === p.style.size) return;
      checkpoint(`resize:${id}`);
      const style = { ...p.style, size: fontSize };
      // Laid out from the starting box, so the opposite corner stays put.
      setPlacements((q) => q.id === id, { style, ...keptOnPage(relaidOut(start, p.text, style, opposite(corner)), size) });
    },

    remove(id: string) {
      if (!placements.some((p) => p.id === id)) return;
      if (editing() === id) {
        // Removing mid-edit: the removal is the undo step, from before the edit.
        const before = session!.before;
        session = undefined;
        setEditing(null);
        if (before.some((p) => p.id === id)) history.checkpoint(before);
        setPlacements((list) => list.filter((p) => p.id !== id));
        if (selected() === id) setSelected(null);
        return;
      }
      checkpoint();
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
