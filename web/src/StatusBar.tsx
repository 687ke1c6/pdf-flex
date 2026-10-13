// The bar along the bottom: how many items are placed (click for the list),
// whether they've been downloaded, and a hint for what you can do next.
import { createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { draftsEnabled, type AutosaveState } from "./autosave";
import { formatSavedAt } from "./draftStore";
import { useEditor } from "./editor";
import type { Placement } from "./placement";
import { isSymbol, type ShapeKind } from "./shapes";

const SHAPE_NAMES: Record<ShapeKind, string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  check: "✓ Tick",
  cross: "✗ Cross",
  dot: "● Dot",
  circle: "○ Circle",
};

const DRAW_HINTS: Record<ShapeKind, string> = {
  rect: "Drag on a page to draw a rectangle (Shift: square), or click for a default size",
  ellipse: "Drag on a page to draw an ellipse (Shift: circle), or click for a default size",
  line: "Drag on a page to draw a line (Shift: straight or 45°), or click for a default line",
  check: "Click on a page to place a tick, or drag to size it",
  cross: "Click on a page to place a cross, or drag to size it",
  dot: "Click on a page to place a dot, or drag to size it",
  circle: "Click on a page to place a circle, or drag to size it",
};

interface Props {
  onGoToPage(page: number): void;
  autosave: AutosaveState;
}

export function StatusBar(props: Props) {
  const editor = useEditor();
  const [listOpen, setListOpen] = createSignal(false);
  let bar!: HTMLElement;

  // The list closes on Escape or a click anywhere outside the status bar.
  const onPointerDown = (e: PointerEvent) => bar.contains(e.target as Node) || setListOpen(false);
  const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && setListOpen(false);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("keydown", onKeyDown);
  onCleanup(() => {
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("keydown", onKeyDown);
  });

  /** How a placement is named in the list. */
  const label = (p: Placement) => {
    switch (p.kind) {
      case "image":
        return editor.signature(p.signatureId)?.name ?? "Signature";
      case "text": {
        const first = p.text.trim().split("\n")[0];
        return first ? `“${first.length > 24 ? `${first.slice(0, 23)}…` : first}”` : "Text";
      }
      case "shape":
        return SHAPE_NAMES[p.shape];
    }
  };

  const count = () => editor.placements.length;

  const hint = () => {
    if (editor.editing()) return "Escape or click elsewhere to finish editing";
    const many = editor.selection().length;
    if (many > 1) return `${many} selected · Delete removes them · Arrow keys move them · Ctrl+click adds or removes`;
    if (editor.selectedText()) return "Enter or double-click to edit · Arrow keys nudge (Shift: 10 pt) · Delete removes";
    const shape = editor.selectedShape();
    if (shape?.ends) return "Drag the ends to change the line · Arrow keys nudge (Shift: 10 pt) · Delete removes";
    if (shape && !isSymbol(shape.shape)) return "Drag a corner to resize (Shift: keep proportions) · Arrow keys nudge · Delete removes";
    if (editor.selected()) return "Arrow keys nudge (Shift: 10 pt) · Delete removes · Ctrl+click another to select both";
    if (editor.tool() === "text") return "Click on a page to add text";
    if (editor.tool() === "shapes") return DRAW_HINTS[editor.shapeTool()];
    return "Drag a signature onto a page to place it";
  };

  return (
    <footer class="status-bar" ref={bar}>
      <button
        class="status-items"
        classList={{ open: listOpen() }}
        aria-expanded={listOpen()}
        onClick={() => setListOpen((o) => !o)}
      >
        {count()} {count() === 1 ? "item" : "items"} <span aria-hidden="true">{listOpen() ? "▾" : "▴"}</span>
      </button>
      <Show
        when={draftsEnabled()}
        fallback={
          <Show when={editor.dirty()} fallback={<Show when={count()}><span class="status-saved">Downloaded</span></Show>}>
            <span class="status-unsaved">Unsaved changes</span>
          </Show>
        }
      >
        <DraftStatus state={props.autosave} />
        <Show when={!editor.dirty() && count()}>
          <span class="status-saved">Downloaded</span>
        </Show>
      </Show>
      <span class="spacer" />
      <span class="status-hint">{hint()}</span>

      <Show when={listOpen()}>
        <div class="status-popover" role="dialog" aria-label="On this document">
          <h2>On this document</h2>
          <Show when={count()} fallback={<p class="hint">Nothing placed yet.</p>}>
            <ul class="placements">
              <For each={editor.placements}>
                {(p) => (
                  <li classList={{ selected: editor.isSelected(p.id) }}>
                    <button
                      class="link"
                      title="Click to select · Ctrl+click to add to the selection"
                      onClick={(e) => {
                        if (e.ctrlKey || e.metaKey || e.shiftKey) {
                          editor.toggleSelect(p.id);
                          return;
                        }
                        editor.select(p.id);
                        props.onGoToPage(p.page);
                      }}
                    >
                      {label(p)} · page {p.page}
                    </button>
                    <button class="icon" title="Remove" aria-label={`Remove ${label(p)}`} onClick={() => editor.remove(p.id)}>
                      ×
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </Show>
    </footer>
  );
}

/** Where the draft of the open document stands. */
function DraftStatus(props: { state: AutosaveState }) {
  const saved = () => (props.state.status === "saved" ? props.state : undefined);
  const failed = () => (props.state.status === "error" ? props.state : undefined);
  return (
    <Switch>
      <Match when={props.state.status === "saving"}>
        <span class="status-draft">Saving…</span>
      </Match>
      <Match when={saved()}>{(s) => <span class="status-draft">Saved in this browser · {formatSavedAt(s().at)}</span>}</Match>
      <Match when={failed()}>
        {(f) => (
          <span class="status-unsaved" title="Your work is only in this tab until it's downloaded">
            Couldn't save a draft: {f().message}
          </span>
        )}
      </Match>
    </Switch>
  );
}
