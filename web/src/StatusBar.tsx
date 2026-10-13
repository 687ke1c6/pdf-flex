// The bar along the bottom: how many items are placed (click for the list),
// whether they've been downloaded, and a hint for what you can do next.
import { createSignal, For, onCleanup, Show } from "solid-js";
import { useEditor } from "./editor";
import type { Placement } from "./placement";

interface Props {
  onGoToPage(page: number): void;
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
    }
  };

  const count = () => editor.placements.length;

  const hint = () => {
    if (editor.editing()) return "Escape or click elsewhere to finish editing";
    if (editor.selectedText()) return "Enter or double-click to edit · Arrow keys nudge (Shift: 10 pt) · Delete removes";
    if (editor.selected()) return "Arrow keys nudge (Shift: 10 pt) · Delete removes";
    if (editor.tool() === "text") return "Click on a page to add text";
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
      <Show when={editor.dirty()} fallback={<Show when={count()}><span class="status-saved">Downloaded</span></Show>}>
        <span class="status-unsaved">Unsaved changes</span>
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
                  <li classList={{ selected: editor.selected() === p.id }}>
                    <button
                      class="link"
                      onClick={() => {
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
