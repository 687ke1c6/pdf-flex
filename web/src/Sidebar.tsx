// The left side: the tool rail and the active tool's panel.
import { createSignal, Match, Show, Switch } from "solid-js";
import { useEditor } from "./editor";
import { SignaturesPanel } from "./SignaturesPanel";
import { TextPanel } from "./TextPanel";
import { ToolRail, type Tool } from "./ToolRail";

interface Props {
  currentPage: number;
  onError(message: string): void;
}

/** Below this width the panel floats over the document and starts closed. Matches styles.css. */
const NARROW = "(max-width: 640px)";

export function Sidebar(props: Props) {
  const editor = useEditor();
  const [open, setOpen] = createSignal(!matchMedia(NARROW).matches);

  function select(next: Tool) {
    if (next === editor.tool()) {
      setOpen((o) => !o);
      return;
    }
    editor.setTool(next);
    setOpen(true);
  }

  return (
    <aside class="sidebar">
      <ToolRail active={editor.tool()} open={open()} onSelect={select} />
      <Show when={open()}>
        <div class="sidebar-panel">
          <section class="tool-panel">
            <Switch>
              <Match when={editor.tool() === "signatures"}>
                <SignaturesPanel currentPage={props.currentPage} onError={props.onError} />
              </Match>
              <Match when={editor.tool() === "text"}>
                <TextPanel currentPage={props.currentPage} />
              </Match>
            </Switch>
          </section>
        </div>
      </Show>
    </aside>
  );
}
