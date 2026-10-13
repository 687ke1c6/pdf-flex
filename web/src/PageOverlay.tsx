// The interactive layer over a rendered page: placed items you can move, resize, edit and delete.
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { boxContains } from "./arrange";
import { SIGNATURE_DRAG_TYPE, useEditor } from "./editor";
import type { PageSize } from "./pdf";
import { keepsAspect, resized, resizedFree, toCss, toPoints, type Box, type Corner, type Placement, type Point } from "./placement";
import { ShapePreview } from "./ShapeBox";
import { clickGeometry, dragGeometry, isSymbol } from "./shapes";
import { TextEditor, TextPreview } from "./TextBox";
import { unsupportedChars } from "./winansi";

interface Props {
  pageNumber: number;
  size: PageSize;
  /** CSS pixels per point. */
  scale: number;
}

const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

/** The page overlay under a screen point, if any (ignoring the placement being dragged). */
function overlayAt(clientX: number, clientY: number): HTMLElement | undefined {
  return document
    .elementsFromPoint(clientX, clientY)
    .map((el) => el.closest<HTMLElement>(".page-overlay"))
    .find((el) => el !== null) ?? undefined;
}

export function PageOverlay(props: Props) {
  const editor = useEditor();
  const onThisPage = () => editor.placements.filter((p) => p.page === props.pageNumber);

  /** Pointer position in display-space points on this page. */
  const pointerOnPage = (e: { clientX: number; clientY: number }, layer: Element) => {
    const rect = layer.getBoundingClientRect();
    return toPoints(e.clientX - rect.left, e.clientY - rect.top, props.size, props.scale);
  };

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes(SIGNATURE_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  /** A pointer position on this page, kept within it. */
  const onPage = (e: { clientX: number; clientY: number }, layer: Element): Point => {
    const pt = pointerOnPage(e, layer);
    return { x: Math.min(Math.max(pt.x, 0), props.size.width), y: Math.min(Math.max(pt.y, 0), props.size.height) };
  };

  /**
   * A press on empty page space does what the active tool does: Select drags a
   * selection box (a click clears the selection), Signatures places the active
   * signature, Text adds a text box, Shapes draws a shape. Hand never gets
   * here: the viewer pans instead.
   */
  function onEmptySpace(e: PointerEvent) {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    const layer = e.currentTarget as Element;
    // Ctrl/Cmd/Shift adds to the selection.
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    // Keeps focus where it is: a new text box's textarea takes it next.
    e.preventDefault();
    switch (editor.tool()) {
      case "select":
        boxSelect(e, layer, additive);
        return;
      case "hand":
        return;
    }
    // With a modifier held, a click is about the selection: it leaves it alone.
    if (additive) return;
    switch (editor.tool()) {
      case "signatures":
        if (editor.active()) editor.add(props.pageNumber, pointerOnPage(e, layer));
        else editor.setCreatingSignature(true);
        return;
      case "text":
        editor.addText(props.pageNumber, pointerOnPage(e, layer));
        return;
      case "shapes":
        drawShape(e, layer);
        return;
    }
  }

  /** The box being dragged out to select with, in points on this page. */
  const [selectBox, setSelectBox] = createSignal<Box | null>(null);

  /**
   * Drags a box on this page that selects every item entirely inside it (added
   * to the selection with `additive`). A click without dragging clears the selection.
   */
  function boxSelect(e: PointerEvent, layer: Element, additive: boolean) {
    const start = onPage(e, layer);
    const base = additive ? editor.selection() : [];
    let dragged = false;
    const move = (m: PointerEvent) => {
      if (m.pointerId !== e.pointerId) return;
      if (!dragged && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < 4) return;
      dragged = true;
      const at = onPage(m, layer);
      const box = { x: Math.min(start.x, at.x), y: Math.min(start.y, at.y), width: Math.abs(at.x - start.x), height: Math.abs(at.y - start.y) };
      setSelectBox(box);
      const hits = onThisPage()
        .filter((p) => boxContains(box, p))
        .map((p) => p.id);
      editor.selectIds([...base, ...hits.filter((id) => !base.includes(id))]);
    };
    const end = (u: PointerEvent) => {
      if (u.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setSelectBox(null);
      if (!dragged && !additive) editor.select(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  /** Drags out a new shape from where the pointer went down; a click adds a default-sized one. */
  function drawShape(e: PointerEvent, layer: Element) {
    const shape = editor.shapeTool();
    const strokeWidth = editor.shapeStyle().strokeWidth;
    const start = onPage(e, layer);
    const page = props.pageNumber;
    let id: string | undefined;
    const move = (m: PointerEvent) => {
      if (m.pointerId !== e.pointerId) return;
      // A few pixels of movement before it counts as a drag rather than a click.
      if (!id && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < 4) return;
      const geometry = dragGeometry(shape, start, onPage(m, layer), m.shiftKey, strokeWidth);
      if (id) editor.drawShape(id, geometry);
      else id = editor.addShape(page, geometry);
    };
    const end = (u: PointerEvent) => {
      if (u.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!id && u.type === "pointerup") editor.addShape(page, clickGeometry(shape, start, strokeWidth));
      editor.endChange();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  function onDrop(e: DragEvent) {
    if (!e.dataTransfer?.types.includes(SIGNATURE_DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    const signatureId = e.dataTransfer.getData(SIGNATURE_DRAG_TYPE) || undefined;
    editor.add(props.pageNumber, pointerOnPage(e, e.currentTarget as Element), signatureId);
  }

  return (
    <div
      class="page-overlay"
      classList={{
        "add-text": editor.tool() === "text",
        "draw-shape": editor.tool() === "shapes",
        "place-signature": editor.tool() === "signatures",
      }}
      data-page={props.pageNumber}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPointerDown={onEmptySpace}
    >
      <For each={onThisPage()}>
        {(placement) => (
          <PlacementBox placement={placement} size={props.size} scale={props.scale} pointerOnPage={pointerOnPage} onPage={onPage} />
        )}
      </For>
      <Show when={selectBox()}>
        {(box) => {
          const css = () => toCss(box(), props.size, props.scale);
          return (
            <div
              class="select-box"
              style={{ left: `${css().left}px`, top: `${css().top}px`, width: `${css().width}px`, height: `${css().height}px` }}
            />
          );
        }}
      </Show>
    </div>
  );
}

interface BoxProps {
  placement: Placement;
  size: PageSize;
  scale: number;
  pointerOnPage(e: PointerEvent, layer: Element): { x: number; y: number };
  /** Like `pointerOnPage`, kept within the page. */
  onPage(e: PointerEvent, layer: Element): Point;
}

function PlacementBox(props: BoxProps) {
  const editor = useEditor();
  const isSelected = () => editor.isSelected(props.placement.id);
  /** The only selected item: it gets the handles and the remove button. */
  const isSole = () => editor.selected() === props.placement.id;
  const css = () => toCss(props.placement, props.size, props.scale);

  /**
   * Tracks one pointer drag, calling `onMove` with each event until release.
   * Listens on the window: a placement dragged onto another page is re-created
   * there, and the element that started the drag goes away.
   */
  function track(e: PointerEvent, onMove: (e: PointerEvent) => void, keepSelection = false) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const id = props.placement.id;
    // A drag ends any text edit, so the two undo separately.
    editor.endEdit();
    if (!keepSelection) editor.select(id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const end = (u: PointerEvent) => {
      if (u.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      editor.endChange();
    };
    const move = (m: PointerEvent) => m.pointerId === e.pointerId && onMove(m);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  function startMove(e: PointerEvent) {
    const id = props.placement.id;
    if (e.button !== 0) return;
    // Ctrl/Cmd/Shift + click adds the item to the selection, or takes it out.
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      editor.toggleSelect(id);
      return;
    }
    // Dragging one of several selected items moves them all, each on its own page.
    if (editor.selection().length > 1 && editor.isSelected(id)) {
      const starts = editor.selectionBoxes();
      const scale = props.scale;
      const tag = `group:${Date.now()}`;
      track(e, (m) => editor.moveGroup(starts, (m.clientX - e.clientX) / scale, -(m.clientY - e.clientY) / scale, tag), true);
      return;
    }
    const layer = (e.currentTarget as HTMLElement).closest(".page-overlay")!;
    // Where the box was grabbed, relative to its bottom-left corner, in points.
    const grab = props.pointerOnPage(e, layer);
    const offset: Point = { x: grab.x - props.placement.x, y: grab.y - props.placement.y };
    const { width, height } = props.placement;
    // Captured now: this component is disposed if the placement moves to another page.
    const scale = props.scale;
    let page = props.placement.page;
    track(e, (m) => {
      // Follow the pointer onto whichever page it's over; between pages, stay put.
      const over = overlayAt(m.clientX, m.clientY);
      const overPage = Number(over?.dataset.page);
      const size = editor.pageSize(overPage);
      if (over && size) page = overPage;
      const target = over && size ? over : document.querySelector(`.page-overlay[data-page="${page}"]`);
      const targetSize = editor.pageSize(page);
      if (!target || !targetSize) return;
      const rect = target.getBoundingClientRect();
      const pt = toPoints(m.clientX - rect.left, m.clientY - rect.top, targetSize, scale);
      editor.update(id, { x: pt.x - offset.x, y: pt.y - offset.y, width, height }, page, `drag:${id}`);
    });
  }

  function startResize(e: PointerEvent, corner: Corner) {
    const layer = (e.currentTarget as HTMLElement).closest(".page-overlay")!;
    const start = { ...props.placement };
    const id = start.id;
    if (start.kind === "text") {
      track(e, (m) => editor.resizeText(id, start, corner, props.pointerOnPage(m, layer)));
      return;
    }
    track(e, (m) => {
      const pointer = props.pointerOnPage(m, layer);
      // Rectangles and ellipses keep their proportions only while Shift is held.
      const box =
        keepsAspect(start) || m.shiftKey
          ? resized(start, corner, pointer, props.size, start.kind === "shape" && isSymbol(start.shape) ? 6 : undefined)
          : resizedFree(start, corner, pointer, props.size);
      editor.update(id, box, undefined, `resize:${id}`);
    });
  }

  /** Drags one end of a line. */
  function startEnd(e: PointerEvent, end: 0 | 1) {
    const layer = (e.currentTarget as HTMLElement).closest(".page-overlay")!;
    const id = props.placement.id;
    track(e, (m) => editor.moveLineEnd(id, end, props.onPage(m, layer)));
  }

  const lineEnds = () => (props.placement.kind === "shape" ? props.placement.ends : undefined);

  return (
    <div
      class="placement"
      classList={{
        selected: isSelected(),
        text: props.placement.kind === "text",
        line: !!lineEnds(),
        invalid: props.placement.kind === "text" && unsupportedChars(props.placement.text).length > 0,
      }}
      style={{
        left: `${css().left}px`,
        top: `${css().top}px`,
        width: `${css().width}px`,
        height: `${css().height}px`,
      }}
      onPointerDown={startMove}
      onDblClick={() => props.placement.kind === "text" && editor.tool() !== "hand" && editor.beginEdit(props.placement.id)}
      // On a Mac, Ctrl + click is also a right click: keep the menu away while selecting.
      onContextMenu={(e) => e.ctrlKey && e.preventDefault()}
    >
      <Switch>
        <Match when={props.placement.kind === "image" && editor.signature(props.placement.signatureId)}>
          {(sig) => <img src={sig().url} alt={sig().name} draggable={false} />}
        </Match>
        <Match when={props.placement.kind === "shape" && props.placement}>{(shape) => <ShapePreview placement={shape()} />}</Match>
        <Match when={props.placement.kind === "text" && props.placement}>
          {(text) => (
            <Show when={editor.editing() === text().id} fallback={<TextPreview placement={text()} />}>
              <TextEditor placement={text()} scale={props.scale} />
            </Show>
          )}
        </Match>
      </Switch>
      <Show when={isSole()}>
        <Show
          when={lineEnds()}
          fallback={<For each={CORNERS}>{(corner) => <div class={`handle ${corner}`} onPointerDown={(e) => startResize(e, corner)} />}</For>}
        >
          {(ends) => (
            <For each={[0, 1] as const}>
              {(end) => (
                <div
                  class="handle end"
                  style={{
                    left: `${ends()[end].x * props.scale}px`,
                    top: `${(props.placement.height - ends()[end].y) * props.scale}px`,
                  }}
                  onPointerDown={(e) => startEnd(e, end)}
                />
              )}
            </For>
          )}
        </Show>
        <button
          class="remove"
          title="Remove (Delete)"
          aria-label="Remove"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => editor.remove(props.placement.id)}
        >
          {/* Drawn rather than a "×" character, so it sits dead centre whatever the font. */}
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
          </svg>
        </button>
      </Show>
    </div>
  );
}
