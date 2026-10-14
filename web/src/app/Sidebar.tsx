// The left side: the tool rail and the active tool's panel.
import { createEffect, createSignal, Match, onCleanup, Switch } from "solid-js";
import { useEditor } from "../document/editor";
import { SelectionPanel } from "../select/SelectionPanel";
import { ShapesPanel } from "../shapes/ShapesPanel";
import { SignaturesPanel } from "../signatures/SignaturesPanel";
import { TextPanel } from "../text/TextPanel";
import { isPanelTool, ToolRail, type PanelTool } from "./ToolRail";

/** What the panel can show: a tool's settings, or the selection. */
type Panel = PanelTool | "selection";

interface Props {
  onError(message: string): void;
}

/** Below this width the panel would cover most of the page, so it opens and closes on its own (see below). */
const NARROW = "(max-width: 640px)";

/**
 * A panel tool's panel is open exactly while that tool is active: opening one
 * selects the tool, closing it goes back to Select. On narrow screens the panel
 * covers the page, so there it opens and closes on its own, and Select and Hand
 * (in the rail there, as there's no quick bar) close it.
 */
export function Sidebar(props: Props) {
  const editor = useEditor();
  const media = matchMedia(NARROW);
  const [narrow, setNarrow] = createSignal(media.matches);
  const onMedia = () => setNarrow(media.matches);
  media.addEventListener("change", onMedia);
  onCleanup(() => media.removeEventListener("change", onMedia));
  const [narrowOpen, setNarrowOpen] = createSignal(false);

  /** Several items selected: the Select tool's panel shows them (on any screen: it's where aligning lives). */
  const selecting = () => editor.tool() === "select" && editor.selection().length > 1;
  /** What the panel shows right now, if it's open. */
  const current = (): Panel | null => {
    const tool = editor.tool();
    if (selecting()) return "selection";
    if (isPanelTool(tool) && (narrow() ? narrowOpen() : true)) return tool;
    return null;
  };
  const open = () => current() !== null;
  // While the panel slides closed, it keeps showing what it showed.
  const [lastShown, setLastShown] = createSignal<Panel>(editor.lastPanelTool());
  createEffect(() => {
    const now = current();
    if (now) setLastShown(now);
  });
  let panel!: HTMLDivElement;
  // Closed, the panel can't be tabbed into or read out.
  createEffect(() => (panel.inert = !open()));

  const shown = () => current() ?? lastShown();

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

  function pick(tool: "select" | "hand") {
    editor.setTool(tool);
    setNarrowOpen(false);
  }

  return (
    <aside class="sidebar">
      <ToolRail active={editor.tool()} open={open() && current() !== "selection"} onSelect={select} onPick={pick} />
      {/* Always there, so it can slide in and out; closed, it's out of reach of the keyboard and screen readers. */}
      <div class="sidebar-panel" classList={{ open: open() }} ref={panel}>
        <section class="tool-panel">
          <Switch>
            <Match when={shown() === "signatures"}>
              <SignaturesPanel onError={props.onError} />
            </Match>
            <Match when={shown() === "text"}>
              <TextPanel />
            </Match>
            <Match when={shown() === "shapes"}>
              <ShapesPanel />
            </Match>
            <Match when={shown() === "selection"}>
              <SelectionPanel />
            </Match>
          </Switch>
        </section>
      </div>
    </aside>
  );
}
