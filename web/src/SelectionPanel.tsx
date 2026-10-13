// The Select tool's panel, shown while two or more items are selected: arranging them together.
import { For } from "solid-js";
import type { AlignEdge } from "./arrange";
import { useEditor } from "./editor";

/** Each icon: a thin line for the edge or centre lined up on, and two bars for the items. */
interface AlignButton {
  edge: AlignEdge;
  label: string;
  axis: string;
  bars: string;
}

const SIDEWAYS: AlignButton[] = [
  { edge: "left", label: "Left", axis: "M4 3v18", bars: "M8 8h11M8 16h6" },
  { edge: "centre", label: "Centre", axis: "M12 3v18", bars: "M6.5 8h11M9 16h6" },
  { edge: "right", label: "Right", axis: "M20 3v18", bars: "M5 8h11M10 16h6" },
];

const UP_DOWN: AlignButton[] = [
  { edge: "top", label: "Top", axis: "M3 4h18", bars: "M8 8v11M16 8v6" },
  { edge: "middle", label: "Middle", axis: "M3 12h18", bars: "M8 6.5v11M16 9v6" },
  { edge: "bottom", label: "Bottom", axis: "M3 20h18", bars: "M8 5v11M16 10v6" },
];

export function SelectionPanel() {
  const editor = useEditor();

  const group = (label: string, buttons: AlignButton[]) => (
    <div class="align-group" role="group" aria-label={label}>
      <For each={buttons}>
        {(b) => (
          <button title={`Align ${b.label.toLowerCase()}`} onClick={() => editor.align(b.edge)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path class="axis" d={b.axis} />
              <path class="bars" d={b.bars} />
            </svg>
            <span>{b.label}</span>
          </button>
        )}
      </For>
    </div>
  );

  return (
    <section class="selection-panel">
      <h2>{editor.selection().length} selected</h2>
      <h3>Align</h3>
      {group("Align sideways", SIDEWAYS)}
      {group("Align up and down", UP_DOWN)}
      <p class="hint">Lines the items up on the edge or centre of the whole selection.</p>
      <button class="block danger" onClick={() => editor.removeSelected()}>
        Delete selected
      </button>
    </section>
  );
}
