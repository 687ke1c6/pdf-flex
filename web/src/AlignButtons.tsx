// The align buttons in the top bar, shown while two or more items are selected.
import { For } from "solid-js";
import type { AlignEdge } from "./arrange";
import { useEditor } from "./editor";

/** Each icon: a thin line for the edge or centre lined up on, and two bars for the items. */
const BUTTONS: { edge: AlignEdge; label: string; axis: string; bars: string }[] = [
  { edge: "left", label: "Align left", axis: "M4 3v18", bars: "M8 8h11M8 16h6" },
  { edge: "centre", label: "Align centre", axis: "M12 3v18", bars: "M6.5 8h11M9 16h6" },
  { edge: "right", label: "Align right", axis: "M20 3v18", bars: "M5 8h11M10 16h6" },
  { edge: "top", label: "Align top", axis: "M3 4h18", bars: "M8 8v11M16 8v6" },
  { edge: "middle", label: "Align middle", axis: "M3 12h18", bars: "M8 6.5v11M16 9v6" },
  { edge: "bottom", label: "Align bottom", axis: "M3 20h18", bars: "M8 5v11M16 10v6" },
];

export function AlignButtons() {
  const editor = useEditor();
  return (
    <span class="align-buttons" role="group" aria-label="Align selected items">
      <For each={BUTTONS}>
        {(b) => (
          <button class="icon-button" title={b.label} aria-label={b.label} onClick={() => editor.align(b.edge)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path class="axis" d={b.axis} />
              <path class="bars" d={b.bars} />
            </svg>
          </button>
        )}
      </For>
    </span>
  );
}
