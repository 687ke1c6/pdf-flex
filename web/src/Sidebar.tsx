// The left side: the tool rail and the active tool's panel.
import { createEffect, createSignal, Match, onCleanup, Switch } from "solid-js";
import { useEditor } from "./editor";
import { ShapesPanel } from "./ShapesPanel";
import { SignaturesPanel } from "./SignaturesPanel";
import { TextPanel } from "./TextPanel";
import { isPanelTool, ToolRail, type PanelTool } from "./ToolRail";

interface Props {
  currentPage: number;
  onError(message: string): void;
}

/** Below this width the panel would cover most of the page, so it opens and closes on its own (see below). */
const NARROW = "(max-width: 640px)";

/**
 * A panel tool's panel is open exactly while that tool is active: opening one
 * selects the tool, closing it goes back to Select. On narrow screens the panel
 * covers the page, so there it opens and closes on its own, and a tool picked
 * from the quick bar is used with its panel closed.
 */
export function Sidebar(props: Props) {
  const editor = useEditor();
  const media = matchMedia(NARROW);
  const [narrow, setNarrow] = createSignal(media.matches);
  const onMedia = () => setNarrow(media.matches);
  media.addEventListener("change", onMedia);
  onCleanup(() => media.removeEventListener("change", onMedia));
  const [narrowOpen, setNarrowOpen] = createSignal(false);

  const open = () => isPanelTool(editor.tool()) && (narrow() ? narrowOpen() : true);
  let panel!: HTMLDivElement;
  // Closed, the panel can't be tabbed into or read out.
  createEffect(() => (panel.inert = !open()));

  /** Whose settings the panel shows: the active tool's, or while it slides closed, the last one's. */
  const shown = () => {
    const tool = editor.tool();
    return isPanelTool(tool) ? tool : editor.lastPanelTool();
  };

  function select(next: PanelTool) {
    if (narrow()) {
      if (next === editor.tool() && narrowOpen()) setNarrowOpen(false);
      else {
        editor.setTool(next);
        setNarrowOpen(true);
      }
      return;
    }
    editor.setTool(next === editor.tool() ? "select" : next);
  }

  return (
    <aside class="sidebar">
      <ToolRail active={editor.tool()} open={open()} onSelect={select} />
      {/* Always there, so it can slide in and out; closed, it's out of reach of the keyboard and screen readers. */}
      <div class="sidebar-panel" classList={{ open: open() }} ref={panel}>
        <section class="tool-panel">
          <Switch>
            <Match when={shown() === "signatures"}>
              <SignaturesPanel currentPage={props.currentPage} onError={props.onError} />
            </Match>
            <Match when={shown() === "text"}>
              <TextPanel currentPage={props.currentPage} />
            </Match>
            <Match when={shown() === "shapes"}>
              <ShapesPanel />
            </Match>
          </Switch>
        </section>
      </div>
    </aside>
  );
}
