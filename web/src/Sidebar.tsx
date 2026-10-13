// The left side: the tool rail, the active tool's panel, and below it what every
// tool shares (what's placed on the document, undo/redo, and saving).
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { useEditor } from "./editor";
import type { Placement } from "./placement";
import { SignaturesPanel } from "./SignaturesPanel";
import { saveTool, savedTool, ToolRail, type Tool } from "./ToolRail";

interface Props {
  currentPage: number;
  saving: boolean;
  onSave(): void;
  onGoToPage(page: number): void;
  onError(message: string): void;
}

/** Below this width the panel floats over the document and starts closed. Matches styles.css. */
const NARROW = "(max-width: 640px)";

export function Sidebar(props: Props) {
  const editor = useEditor();
  const [tool, setTool] = createSignal<Tool>(savedTool());
  const [open, setOpen] = createSignal(!matchMedia(NARROW).matches);

  function select(next: Tool) {
    if (next === tool()) {
      setOpen((o) => !o);
      return;
    }
    setTool(next);
    saveTool(next);
    setOpen(true);
  }

  /** How a placement is named in the list. */
  const label = (p: Placement) => {
    switch (p.kind) {
      case "image":
        return editor.signature(p.signatureId)?.name ?? "Signature";
    }
  };

  return (
    <aside class="sidebar">
      <ToolRail active={tool()} open={open()} onSelect={select} />
      <Show when={open()}>
        <div class="sidebar-panel">
          <section class="tool-panel">
            <Switch>
              <Match when={tool() === "signatures"}>
                <SignaturesPanel currentPage={props.currentPage} onError={props.onError} />
              </Match>
            </Switch>
          </section>

          <section class="grow">
            <div class="section-head">
              <h2>On this document ({editor.placements.length})</h2>
              <span>
                <button class="icon" title="Undo (Ctrl Z)" aria-label="Undo" disabled={!editor.canUndo()} onClick={() => editor.undo()}>
                  ↶
                </button>
                <button class="icon" title="Redo (Ctrl Shift Z)" aria-label="Redo" disabled={!editor.canRedo()} onClick={() => editor.redo()}>
                  ↷
                </button>
              </span>
            </div>
            <Show when={editor.placements.length} fallback={<p class="hint">Nothing placed yet.</p>}>
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
                      <button class="icon" title="Remove" onClick={() => editor.remove(p.id)}>
                        ×
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </section>

          <section>
            <button class="primary block" disabled={!editor.placements.length || props.saving} onClick={() => props.onSave()}>
              {props.saving ? "Saving…" : "Download PDF"}
            </button>
            <p class="hint">
              The original file is not changed.
              <Show when={editor.placements.length}> Select an item and use the arrow keys to nudge it (Shift for bigger steps).</Show>
            </p>
          </section>
        </div>
      </Show>
    </aside>
  );
}
