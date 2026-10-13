// The interactive layer over a rendered page: placed signatures you can move, resize and delete.
import { For, Show } from "solid-js";
import { SIGNATURE_DRAG_TYPE, useEditor } from "./editor";
import type { PageSize } from "./pdf";
import { resized, toCss, toPoints, type Corner, type Placement, type Point } from "./placement";

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
      data-page={props.pageNumber}
      onDragOver={onDragOver}
      onDrop={onDrop}
      // Clicking empty page space clears the selection.
      onPointerDown={(e) => e.target === e.currentTarget && editor.select(null)}
    >
      <For each={onThisPage()}>
        {(placement) => <PlacementBox placement={placement} size={props.size} scale={props.scale} pointerOnPage={pointerOnPage} />}
      </For>
    </div>
  );
}

interface BoxProps {
  placement: Placement;
  size: PageSize;
  scale: number;
  pointerOnPage(e: PointerEvent, layer: Element): { x: number; y: number };
}

function PlacementBox(props: BoxProps) {
  const editor = useEditor();
  const isSelected = () => editor.selected() === props.placement.id;
  const css = () => toCss(props.placement, props.size, props.scale);

  /**
   * Tracks one pointer drag, calling `onMove` with each event until release.
   * Listens on the window: a placement dragged onto another page is re-created
   * there, and the element that started the drag goes away.
   */
  function track(e: PointerEvent, onMove: (e: PointerEvent) => void) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const id = props.placement.id;
    editor.select(id);
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
    track(e, (m) => editor.update(id, resized(start, corner, props.pointerOnPage(m, layer), props.size), undefined, `resize:${id}`));
  }

  return (
    <div
      class="placement"
      classList={{ selected: isSelected() }}
      style={{
        left: `${css().left}px`,
        top: `${css().top}px`,
        width: `${css().width}px`,
        height: `${css().height}px`,
      }}
      onPointerDown={startMove}
    >
      <Show when={editor.signature(props.placement.signatureId)}>
        {(sig) => <img src={sig().url} alt={sig().name} draggable={false} />}
      </Show>
      <Show when={isSelected()}>
        <For each={CORNERS}>{(corner) => <div class={`handle ${corner}`} onPointerDown={(e) => startResize(e, corner)} />}</For>
        <button
          class="remove"
          title="Remove (Delete)"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => editor.remove(props.placement.id)}
        >
          ×
        </button>
      </Show>
    </div>
  );
}
