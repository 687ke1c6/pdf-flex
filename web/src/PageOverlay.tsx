// The interactive layer over a rendered page: placed signatures you can move, resize and delete.
import { For, Show } from "solid-js";
import { SIGNATURE_DRAG_TYPE, useEditor } from "./editor";
import type { PageSize } from "./pdf";
import { moved, resized, toCss, toPoints, type Corner, type Placement } from "./placement";

interface Props {
  pageNumber: number;
  size: PageSize;
  /** CSS pixels per point. */
  scale: number;
}

const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

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
    editor.add(props.pageNumber, pointerOnPage(e, e.currentTarget as Element));
  }

  return (
    <div
      class="page-overlay"
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

  /** Tracks one pointer drag on `el`, calling `onMove` with each event until release. */
  function track(e: PointerEvent, el: HTMLElement, onMove: (e: PointerEvent) => void) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    editor.select(props.placement.id);
    el.setPointerCapture(e.pointerId);
    const end = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  function startMove(e: PointerEvent) {
    const start = { x: e.clientX, y: e.clientY, box: { ...props.placement } };
    track(e, e.currentTarget as HTMLElement, (m) => {
      // Screen y is down, display space is up.
      const dx = (m.clientX - start.x) / props.scale;
      const dy = -(m.clientY - start.y) / props.scale;
      editor.update(props.placement.id, moved(start.box, dx, dy, props.size));
    });
  }

  function startResize(e: PointerEvent, corner: Corner) {
    const handle = e.currentTarget as HTMLElement;
    const layer = handle.closest(".page-overlay")!;
    const start = { ...props.placement };
    track(e, handle, (m) => editor.update(props.placement.id, resized(start, corner, props.pointerOnPage(m, layer), props.size)));
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
      <Show when={editor.signature()}>{(sig) => <img src={sig().url} alt="Signature" draggable={false} />}</Show>
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
