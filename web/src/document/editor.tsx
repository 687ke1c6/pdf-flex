// Editing state: the active tool, the signature library, what's placed where, what's selected, and text being edited.
import { createContext, createSignal, useContext, type ParentProps } from "solid-js";
import { createStore, unwrap, type SetStoreFunction } from "solid-js/store";
import { createDocState, isDirty, savedKey, snapshotOf, stateOf, type DocState } from "./docState";
import { deletePages, insertSlots, movePages, rearrange, type NewSlot, type PagesState, type Source } from "./pages";
import type { PageSize } from "../viewer/pdf";
import {
  centeredAt,
  clampToPage,
  fixedSize,
  keptOnPage,
  moved,
  type Box,
  type Corner,
  type Placement,
  type Point,
  type ShapePlacement,
  type TextPlacement,
} from "./placement";
import { alignedBox, alignTarget, limitGroupMove, type AlignEdge, type GroupBox } from "../select/arrange";
import { DEFAULT_SHAPE_STYLE, lineBox, lineEnds, SHAPE_KINDS, type ShapeKind, type ShapeStyle } from "../shapes/shapes";
import { isPanelTool, savedPanelTool, savePanelTool, savedTool, saveTool, type PanelTool, type Tool } from "../app/ToolRail";
import { LINE_HEIGHT, opposite, relaidOut, resizedTextSize, type TextStyle } from "../text/textLayout";
import {
  exportSignatures,
  newSignatureId,
  parseSignatureExport,
  requestPersistence,
  signatureStore,
  type SignatureRecipe,
  type SignatureSource,
  type StoredSignature,
} from "../signatures/signatureStore";

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

/** Reads a remembered setting. Storage may be unavailable (private mode, blocked). */
function load<T>(key: string, fallback: T): T {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    if (saved === null) return fallback;
    return typeof fallback === "object" ? { ...fallback, ...saved } : saved;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

const SHAPE_STYLE_KEY = "pdf-flex:shape-style";
const SHAPE_TOOL_KEY = "pdf-flex:shape-tool";
const TEXT_STYLE_KEY = "pdf-flex:text-style";
const DEFAULT_TEXT_STYLE: TextStyle = { family: "Helvetica", bold: false, italic: false, size: 12, color: "#000000", align: "left" };


function createEditor() {
  const [library, setLibrary] = createStore<Signature[]>([]);
  const [activeId, setActiveId] = createSignal<string | null>(null);
  /** The document being worked on: everything per-document below acts on it. */
  const [doc, setDoc] = createSignal<DocState>(createDocState([]));
  const selection = () => doc().selection();
  const setSelection = (v: string[] | ((prev: string[]) => string[])) => doc().setSelection(v);
  const editing = () => doc().editing();
  const setEditing = (id: string | null) => doc().setEditing(id);
  const setPlacements: SetStoreFunction<Placement[]> = ((...args: unknown[]) =>
    (doc().setPlacements as (...a: unknown[]) => void)(...args)) as SetStoreFunction<Placement[]>;
  /** The active document's page sizes. */
  const pageAt = (page: number): PageSize | undefined => doc().slots()[page - 1];
  const nextId = () => `p${doc().nextPlacementId++}`;
  /** The selected placement when exactly one is: what handles, style panels and editing act on. */
  const selected = () => {
    const ids = selection();
    return ids.length === 1 ? ids[0] : null;
  };
  const setSelected = (id: string | null) => setSelection(id ? [id] : []);
  /** Sets the selection; picking several switches to the Select tool, whose panel then shows them. */
  function setMany(ids: string[]) {
    setSelection(ids);
    if (ids.length > 1 && tool() !== "select") {
      setToolSignal("select");
      saveTool("select");
    }
  }
  const deselect = (id: string) => setSelection((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids));
  const [tool, setToolSignal] = createSignal<Tool>(savedTool());
  const [lastPanelTool, setLastPanelTool] = createSignal<PanelTool>(isPanelTool(tool()) ? (tool() as PanelTool) : savedPanelTool());
  const [creatingSignature, setCreatingSignature] = createSignal(false);
  const [textStyle, setTextStyleSignal] = createSignal<TextStyle>(load(TEXT_STYLE_KEY, DEFAULT_TEXT_STYLE));
  const [shapeStyle, setShapeStyleSignal] = createSignal<ShapeStyle>(load(SHAPE_STYLE_KEY, DEFAULT_SHAPE_STYLE));
  const savedShape = load<string>(SHAPE_TOOL_KEY, "rect");
  const [shapeTool, setShapeToolSignal] = createSignal<ShapeKind>(
    SHAPE_KINDS.find((k) => k === savedShape) ?? "rect",
  );
  const snapshot = () => stateOf(doc());
  /** Call before every change to the pages or placements. `tag` merges a run of changes into one undo step. */
  const checkpoint = (tag?: string) => doc().history.checkpoint(snapshot(), tag);
  /** Puts back an undo step: the page list and the placements. */
  function restore(state: PagesState | undefined) {
    if (!state) return;
    endEdit();
    // A signature may have been deleted from the library since; its placements can't come back.
    const placements = state.placements.filter((p) => p.kind !== "image" || library.some((s) => s.id === p.signatureId));
    doc().setSlots(state.slots);
    setPlacements(placements);
    setSelection((ids) => ids.filter((id) => placements.some((p) => p.id === id)));
  }
  /** Applies a page operation as one undo step. */
  function changePages(next: PagesState | undefined): boolean {
    if (!next) return false;
    restore(next);
    return true;
  }

  const signature = (id: string | null | undefined) => library.find((s) => s.id === id);
  const usesSignature = (id: string) => doc().placements.some((p) => p.kind === "image" && p.signatureId === id);
  /** Store records are proxies (including nested ones like a recipe), which IndexedDB can't clone. */
  const toStored = (sig: Signature): StoredSignature => {
    const { url: _url, ...stored } = unwrap(sig);
    return stored;
  };
  const save = (sig: Signature) => signatureStore.put(toStored(sig));

  const shapePlacement = (id: string | null | undefined) =>
    doc().placements.find((p): p is ShapePlacement => p.id === id && p.kind === "shape");

  /** Sets a shape's box (and a line's ends), kept on its page. */
  function setGeometry(p: ShapePlacement, box: Box, ends?: [Point, Point]) {
    const size = pageAt(p.page);
    const placed = size ? (ends ? keptOnPage(box, size) : clampToPage(box, size)) : box;
    setPlacements((q) => q.id === p.id, { ...placed, ...(ends ? { ends } : {}) });
  }

  const textPlacement = (id: string | null | undefined) =>
    doc().placements.find((p): p is TextPlacement => p.id === id && p.kind === "text");

  /** Changes a text placement's text or style, re-laying it out with `anchor` fixed. */
  function setText(p: TextPlacement, text: string, style: TextStyle, anchor: Corner = "nw") {
    const size = pageAt(p.page);
    const box = relaidOut(p, text, style, anchor);
    setPlacements((q) => q.id === p.id, { text, style, ...(size ? keptOnPage(box, size) : box) });
  }

  /** Ends the in-place edit, if any: empty text is removed, and a change becomes one undo step. */
  function endEdit() {
    const d = doc();
    const current = d.session;
    if (!current) return;
    d.session = undefined;
    setEditing(null);
    const p = textPlacement(current.id);
    if (!p) return;
    const empty = !p.text.trim();
    const before = current.before.find((q): q is TextPlacement => q.id === p.id && q.kind === "text");
    const changed = current.isNew
      ? !empty
      : before?.text !== p.text || JSON.stringify(before.style) !== JSON.stringify(p.style);
    if (changed || (empty && !current.isNew)) d.history.checkpoint({ slots: d.slots(), placements: current.before });
    if (empty) {
      setPlacements((list) => list.filter((q) => q.id !== p.id));
      deselect(p.id);
    }
  }

  const boxesOf = (ids: string[]): GroupBox[] =>
    doc().placements.filter((p) => ids.includes(p.id)).map(({ id, page, x, y, width, height }) => ({ id, page, x, y, width, height }));

  /**
   * Moves boxes together by the same (dx, dy), each on its own page. The move
   * is limited so that none of them leaves its page, keeping their arrangement.
   */
  function moveGroup(starts: GroupBox[], dx: number, dy: number, tag?: string) {
    const limited = limitGroupMove(starts, dx, dy, (page) => pageAt(page));
    if (!limited) return;
    const moves = starts.filter((b) => {
      const p = doc().placements.find((q) => q.id === b.id);
      return p && (p.x !== b.x + limited.dx || p.y !== b.y + limited.dy);
    });
    if (!moves.length) return;
    checkpoint(tag);
    for (const b of moves) setPlacements((p) => p.id === b.id, { x: b.x + limited.dx, y: b.y + limited.dy });
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
    /** The signature that clicks on a page place (drags carry their own). */
    active: () => signature(activeId()),
    setActive: setActiveId,
    /** The active document's placements. */
    get placements() {
      return doc().placements;
    },
    selected,
    select,

    /** The active tool: it decides what clicking a page does. */
    tool,
    setTool(next: Tool) {
      endEdit();
      setToolSignal(next);
      saveTool(next);
      if (isPanelTool(next)) {
        setLastPanelTool(next);
        savePanelTool(next);
      }
    },
    /** The panel tool used most recently (the quick bar offers it). */
    lastPanelTool,

    /** Whether the New signature dialog is open. */
    creatingSignature,
    setCreatingSignature,

    /** Sets the whole selection (e.g. from a box dragged over the page). */
    selectIds(ids: string[]) {
      endEdit();
      const same = ids.length === selection().length && ids.every((id, i) => selection()[i] === id);
      if (!same) setMany(ids);
    },

    /** The selected placement, if it's a shape. */
    selectedShape: () => shapePlacement(selected()),
    /** The style the next shape gets. */
    shapeStyle,
    /** What the Shapes tool draws next. */
    shapeTool,
    setShapeTool(next: ShapeKind) {
      setShapeToolSignal(next);
      store(SHAPE_TOOL_KEY, next);
    },

    /**
     * Adds a shape of the current shape tool. Its drawing (see `drawShape`)
     * continues the same undo step, until `endChange`.
     */
    addShape(page: number, geometry: { box: Box; ends?: [Point, Point] }): string | undefined {
      const size = pageAt(page);
      if (!size) return;
      endEdit();
      const id = nextId();
      checkpoint(`draw:${id}`);
      const p: ShapePlacement = { id, kind: "shape", shape: shapeTool(), style: shapeStyle(), page, ...geometry.box };
      if (geometry.ends) p.ends = geometry.ends;
      setPlacements(doc().placements.length, p);
      setGeometry(p, geometry.box, geometry.ends);
      setSelected(id);
      return id;
    },

    /** Reshapes a shape being drawn. */
    drawShape(id: string, geometry: { box: Box; ends?: [Point, Point] }) {
      const p = shapePlacement(id);
      if (!p) return;
      checkpoint(`draw:${id}`);
      setGeometry(p, geometry.box, geometry.ends);
    },

    /** Moves one end of a line to a page point. One drag is one undo step. */
    moveLineEnd(id: string, end: 0 | 1, to: Point) {
      const p = shapePlacement(id);
      if (!p?.ends) return;
      const ends = lineEnds(p, p.ends);
      ends[end] = to;
      checkpoint(`end:${id}`);
      const line = lineBox(ends[0], ends[1], p.style.strokeWidth);
      setGeometry(p, line.box, line.ends);
    },

    /**
     * Changes the style of the selected shape, if any, and of the next one.
     * Changes with the same `tag` (e.g. typing a width) undo as one step.
     */
    setShapeStyle(change: Partial<ShapeStyle>, tag?: string) {
      const next = { ...shapeStyle(), ...change };
      setShapeStyleSignal(next);
      store(SHAPE_STYLE_KEY, next);
      const p = shapePlacement(selected());
      if (!p) return;
      const style = { ...p.style, ...change };
      if (JSON.stringify(style) === JSON.stringify(p.style)) return;
      checkpoint(tag && `style:${p.id}:${tag}`);
      setPlacements((q) => q.id === p.id, { style });
      // A line's box leaves room for its width.
      if (p.ends) {
        const [a, b] = lineEnds(p, p.ends);
        const line = lineBox(a, b, style.strokeWidth);
        setGeometry(p, line.box, line.ends);
      }
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

    /** The document being worked on. */
    doc,
    /**
     * Makes `d` the document being worked on. An edit in progress on the
     * previous one is finished first, so it lands in its own undo history.
     */
    activate(d: DocState) {
      if (d === doc()) return;
      endEdit();
      setDoc(d);
    },
    /** The signatures a document's placements use, as stored records. */
    usedSignatures(d: DocState = doc()): StoredSignature[] {
      const ids = new Set(d.placements.flatMap((p) => (p.kind === "image" ? [p.signatureId] : [])));
      return [...ids].flatMap((id) => {
        const sig = signature(id);
        return sig ? [toStored(sig)] : [];
      });
    },

    /**
     * Puts back a draft's pages (if they were changed) and placements on a
     * document. Signatures it uses that have since left the library are added
     * back to it. The pages' sources must already be in the document's sources;
     * pages whose source isn't are left out, with what's placed on them.
     */
    async restoreDraft(saved: Placement[], signatures: StoredSignature[], d: DocState = doc(), pages?: NewSlot[]) {
      if (d === doc()) endEdit();
      const missing = signatures.filter((s) => !library.some((l) => l.id === s.id));
      if (missing.length) await addToLibrary(missing);
      let usable = saved.filter((p) => p.kind !== "image" || library.some((s) => s.id === p.signatureId));
      if (pages) {
        const slots = pages.map((p) => ({ ...p, key: `s${d.nextSlotKey++}` }));
        const restored = rearrange({ slots, placements: usable }, slots.filter((s) => d.sources.has(s.source)));
        if (restored.slots.length) {
          d.setSlots(restored.slots);
          usable = restored.placements;
        }
      }
      d.setPlacements(structuredClone(usable));
      d.setSelection([]);
      d.history.clear();
      // New placements must not reuse the restored ones' ids.
      const used = usable.map((p) => Number(p.id.slice(1))).filter(Number.isFinite);
      d.nextPlacementId = Math.max(d.nextPlacementId, ...used.map((n) => n + 1));
    },

    /** Adds the signatures from an export file; returns how many were added. */
    async importLibrary(text: string): Promise<number> {
      const sigs = parseSignatureExport(text);
      await addToLibrary(sigs);
      return sigs.length;
    },

    /** Size of a page in points (1-based), if it exists. */
    pageSize: (page: number): PageSize | undefined => pageAt(page),

    /** Whether there are placements that haven't been downloaded. */
    dirty: () => isDirty(doc()),
    /** Call after a document's edited PDF has been downloaded. */
    markSaved(d: DocState = doc()) {
      d.setSavedState(savedKey(d.slots(), d.placements));
    },

    canUndo: () => (doc().historyVersion(), doc().history.canUndo()),
    canRedo: () => (doc().historyVersion(), doc().history.canRedo()),
    undo: () => restore(doc().history.undo(snapshot())),
    redo: () => restore(doc().history.redo(snapshot())),
    /** Ends a merged change (a drag), so the next one is a separate undo step. */
    endChange: () => doc().history.seal(),

    /** The active document's page list. */
    slots: () => doc().slots(),
    /**
     * Makes a PDF available for inserting pages from, and returns the source to use:
     * if the same file is already there, that one (and the new copy is closed).
     */
    addSource(source: Source): Source {
      const d = doc();
      const existing = d.sources.get(source.id);
      if (existing) {
        if (existing !== source) void source.pdf.close();
        return existing;
      }
      d.sources.set(source.id, source);
      return source;
    },
    /** Inserts pages before 0-based position `at` (the page count: at the end). One undo step. */
    insertPages(at: number, pages: NewSlot[]) {
      if (!pages.length) return;
      const d = doc();
      endEdit();
      const added = pages.map((p) => ({ ...p, key: `s${d.nextSlotKey++}` }));
      checkpoint();
      changePages(insertSlots(snapshot(), at, added));
    },
    /**
     * Deletes pages (1-based), and what's placed on them, as one undo step.
     * Returns false, changing nothing, if that would delete every page.
     */
    deletePages(pages: number[]): boolean {
      endEdit();
      const next = deletePages(snapshot(), pages);
      if (!next) return false;
      checkpoint();
      return changePages(next);
    },
    /** Moves pages (1-based), keeping their order, to before 0-based position `at`. One undo step. */
    movePages(pages: number[], at: number) {
      endEdit();
      const next = movePages(snapshot(), pages, at);
      // Moving pages to where they already are isn't a change.
      if (next.slots.every((s, i) => s.key === doc().slots()[i].key)) return;
      checkpoint();
      changePages(next);
    },

    /** Places a signature (default: the active one) centred on `center` in points, or the page centre. */
    add(page: number, center?: Point, signatureId = activeId()) {
      const sig = signature(signatureId);
      const size = pageAt(page);
      if (!sig || !size) return;
      setActiveId(sig.id);

      const width = Math.min(DEFAULT_WIDTH, size.width / 2);
      const box = centeredAt(center ?? { x: size.width / 2, y: size.height / 2 }, width, sig.width / sig.height, size);
      const id = nextId();
      checkpoint();
      setPlacements(doc().placements.length, { id, kind: "image", signatureId: sig.id, page, ...box });
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
      const current = doc().placements.find((p) => p.id === id);
      if (!current) return;
      const target = page ?? current.page;
      const size = pageAt(target);
      if (!size) return;
      const next = { ...(fixedSize(current) ? keptOnPage(box, size) : clampToPage(box, size)), page: target };
      const same = (Object.keys(next) as (keyof typeof next)[]).every((k) => next[k] === current[k]);
      if (same) return;
      checkpoint(tag);
      setPlacements((p) => p.id === id, next);
    },

    /** Moves the selected placements by (dx, dy) points; a run of nudges undoes as one step. */
    nudge(dx: number, dy: number) {
      const ids = selection();
      if (!ids.length) return;
      if (ids.length > 1) {
        moveGroup(boxesOf(ids), dx, dy, `nudge:${ids.join()}`);
        return;
      }
      const current = doc().placements.find((p) => p.id === ids[0]);
      const size = current && pageAt(current.page);
      if (!current || !size) return;
      checkpoint(`nudge:${current.id}`);
      const box = { x: current.x + dx, y: current.y + dy, width: current.width, height: current.height };
      setPlacements((p) => p.id === current.id, fixedSize(current) ? keptOnPage(box, size) : moved(current, dx, dy, size));
    },

    selection,
    isSelected: (id: string) => selection().includes(id),
    /** Adds a placement to the selection, or takes it out if it's in it (Ctrl/Cmd/Shift + click). */
    toggleSelect(id: string) {
      endEdit();
      const ids = selection();
      setMany(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
    },
    /** Selects everything on a page. */
    selectAll(page: number) {
      endEdit();
      setMany(doc().placements.filter((p) => p.page === page).map((p) => p.id));
    },
    /** Removes every selected placement, as one undo step. */
    removeSelected() {
      const ids = selection();
      if (!ids.length) return;
      endEdit();
      const remaining = doc().placements.filter((p) => !ids.includes(p.id));
      if (remaining.length === doc().placements.length) return;
      checkpoint();
      setPlacements(remaining.map((p) => unwrap(p)));
      setSelection([]);
    },
    /** The starting boxes for moving the selection together (see `moveGroup`). */
    selectionBoxes: () => boxesOf(selection()),
    /** Moves placements together by (dx, dy) from their starting boxes; changes with the same `tag` undo as one step. */
    moveGroup: (starts: GroupBox[], dx: number, dy: number, tag?: string) => moveGroup(starts, dx, dy, tag),
    /** Lines the selection up on one edge or centre of its bounding box, as one undo step. */
    align(edge: AlignEdge) {
      const ids = selection();
      const items = doc().placements.filter((p) => ids.includes(p.id));
      if (items.length < 2) return;
      const target = alignTarget(items, edge);
      checkpoint();
      for (const p of items) {
        const size = pageAt(p.page);
        if (!size) continue;
        const box = { ...alignedBox(p, edge, target), width: p.width, height: p.height };
        setPlacements((q) => q.id === p.id, keptOnPage(box, size));
      }
    },

    /**
     * Adds an empty text box and starts editing it. `at` (points) is where the
     * middle of its first line goes; by default, the middle of the page.
     */
    addText(page: number, at?: Point) {
      const size = pageAt(page);
      if (!size) return;
      endEdit();
      const style = textStyle();
      const point = at ?? { x: size.width / 2, y: size.height / 2 };
      const half = (style.size * LINE_HEIGHT) / 2;
      const box = relaidOut({ x: point.x, y: point.y - half, width: 0, height: 2 * half }, "", style);
      const id = nextId();
      doc().session = { id, before: snapshotOf(doc()), isNew: true };
      setPlacements(doc().placements.length, { id, kind: "text", text: "", style, page, ...keptOnPage(box, size) });
      setSelected(id);
      setEditing(id);
    },

    /** Starts editing a text placement in place. */
    beginEdit(id: string) {
      if (!textPlacement(id) || editing() === id) return;
      endEdit();
      doc().session = { id, before: snapshotOf(doc()), isNew: false };
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
      store(TEXT_STYLE_KEY, next);
      const p = textPlacement(selected());
      if (!p) return;
      const style = { ...p.style, ...change };
      if (JSON.stringify(style) === JSON.stringify(p.style)) return;
      // Mid-edit, the change is part of the edit's undo step.
      if (!doc().session) checkpoint(tag && `style:${p.id}:${tag}`);
      setText(p, p.text, style);
      setTextStyleSignal({ ...style });
      store(TEXT_STYLE_KEY, style);
    },

    /** Resizes a text box by dragging `corner`: its font size follows. One drag is one undo step. */
    resizeText(id: string, start: TextPlacement, corner: Corner, pointer: Point) {
      const p = textPlacement(id);
      const size = pageAt(start.page);
      if (!p || !size) return;
      const fontSize = resizedTextSize(start, start.style.size, corner, pointer, size);
      if (fontSize === p.style.size) return;
      checkpoint(`resize:${id}`);
      const style = { ...p.style, size: fontSize };
      // Laid out from the starting box, so the opposite corner stays put.
      setPlacements((q) => q.id === id, { style, ...keptOnPage(relaidOut(start, p.text, style, opposite(corner)), size) });
    },

    remove(id: string) {
      if (!doc().placements.some((p) => p.id === id)) return;
      if (editing() === id) {
        // Removing mid-edit: the removal is the undo step, from before the edit.
        const before = doc().session!.before;
        doc().session = undefined;
        setEditing(null);
        if (before.some((p) => p.id === id)) doc().history.checkpoint({ slots: doc().slots(), placements: before });
        setPlacements((list) => list.filter((p) => p.id !== id));
        deselect(id);
        return;
      }
      checkpoint();
      setPlacements((list) => list.filter((p) => p.id !== id));
      deselect(id);
    },
  };
}

export type Editor = ReturnType<typeof createEditor>;
export { createDocState, isDirty, snapshotOf, stateOf, type DocState };

const EditorContext = createContext<Editor>();

export function EditorProvider(props: ParentProps) {
  return <EditorContext.Provider value={createEditor()}>{props.children}</EditorContext.Provider>;
}

export function useEditor(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error("useEditor must be used inside <EditorProvider>");
  return editor;
}
