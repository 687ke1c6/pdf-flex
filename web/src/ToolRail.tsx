// Tools: exactly one is active, and it decides what a click on the page does.
// Select and Hand have no settings; the others have a panel, opened from the
// rail on the far left.
import { createEffect, createSignal, For, on, onCleanup, onMount, type JSX } from "solid-js";

export type PanelTool = "signatures" | "text" | "shapes";
export type Tool = "select" | "hand" | PanelTool;

interface ToolInfo {
  label: string;
  /** Keyboard shortcut (a letter). */
  key: string;
  icon: () => JSX.Element;
}

/** Stroke icons on a 24 × 24 grid, drawn in the button's text colour. */
const icon = (path: string) => () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={path} />
  </svg>
);

export const TOOL_INFO: Record<Tool, ToolInfo> = {
  select: { label: "Select", key: "V", icon: icon("M6 3l12 9-5.5 1.2L15 19l-2.4 1.1-2.5-5.6L6 18z") },
  hand: {
    label: "Hand",
    key: "H",
    icon: icon(
      "M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-.5V6a1.5 1.5 0 0 1 3 0v5m0-1.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6.5 6.5 0 0 1-5.4-2.9L4 14.2a1.5 1.5 0 0 1 2.4-1.8L8 14.5",
    ),
  },
  signatures: { label: "Signatures", key: "S", icon: icon("M3 17c3-1 4-8 6-8s0 7 2 7 3-4 4-4 1 3 3 3 2-1 3-1M3 21h18") },
  text: { label: "Text", key: "T", icon: icon("M5 6V4h14v2M12 4v16M9 20h6") },
  shapes: { label: "Shapes", key: "R", icon: icon("M3 3h9v9H3zM17.5 11a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9M6 21l5-7") },
};

export const PANEL_TOOLS: PanelTool[] = ["signatures", "text", "shapes"];
export const isPanelTool = (tool: Tool): tool is PanelTool => (PANEL_TOOLS as Tool[]).includes(tool);

/** The tool for a shortcut key, if any. */
export const toolForKey = (key: string): Tool | undefined =>
  (Object.keys(TOOL_INFO) as Tool[]).find((t) => TOOL_INFO[t].key === key.toUpperCase());

const TOOL_KEY = "pdf-flex:tool";
const LAST_PANEL_TOOL_KEY = "pdf-flex:last-tool";

function load<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return valid.find((t) => t === saved) ?? fallback;
  } catch {
    // Storage may be unavailable (private mode, blocked).
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

/** The tool in use last time; Select the first time. */
export const savedTool = () => load(TOOL_KEY, Object.keys(TOOL_INFO) as Tool[], "select");
export const saveTool = (tool: Tool) => store(TOOL_KEY, tool);
/** The panel tool used most recently: the quick bar's third button. */
export const savedPanelTool = () => load(LAST_PANEL_TOOL_KEY, PANEL_TOOLS, "signatures");
export const savePanelTool = (tool: PanelTool) => store(LAST_PANEL_TOOL_KEY, tool);

/** A tool's tooltip: its name and shortcut. */
export const toolTitle = (tool: Tool) => `${TOOL_INFO[tool].label} (${TOOL_INFO[tool].key})`;

interface Props {
  active: Tool;
  /** Whether the active tool's panel is showing. */
  open: boolean;
  onSelect(tool: PanelTool): void;
}

/** The panel tools, down the left edge. */
export function ToolRail(props: Props) {
  return (
    <nav class="tool-rail" aria-label="Tools">
      <For each={PANEL_TOOLS}>
        {(tool) => (
          <button
            classList={{ active: props.active === tool }}
            title={toolTitle(tool)}
            aria-label={TOOL_INFO[tool].label}
            aria-pressed={props.active === tool && props.open}
            onClick={() => props.onSelect(tool)}
          >
            {TOOL_INFO[tool].icon()}
          </button>
        )}
      </For>
    </nav>
  );
}

/** Select, Hand, and the last panel tool used, floating at the bottom of the document. Icons only. */
/** How long the quick bar stays up after the mouse last moved. */
const QUICK_BAR_IDLE_MS = 3000;

/**
 * Slides away once the mouse has been still for a while, and back when it moves. Scrolling with the
 * wheel doesn't bring it back, so reading the document leaves the page clear. It stays while the
 * pointer is on it or one of its buttons has keyboard focus, and comes back when the tool changes.
 */
export function QuickBar(props: { active: Tool; last: PanelTool; onSelect(tool: Tool): void }) {
  const [shown, setShown] = createSignal(true);
  let hovered = false;
  let focused = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wake = () => {
    setShown(true);
    clearTimeout(timer);
    if (!hovered && !focused) timer = setTimeout(() => setShown(false), QUICK_BAR_IDLE_MS);
  };
  // After a wheel scroll the browser sends a mousemove with the pointer where it was; only a real move counts.
  let lastX = NaN;
  let lastY = NaN;
  const onMove = (e: PointerEvent) => {
    if (e.screenX === lastX && e.screenY === lastY) return;
    lastX = e.screenX;
    lastY = e.screenY;
    wake();
  };
  onMount(() => {
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", wake);
    wake();
  });
  onCleanup(() => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", wake);
    clearTimeout(timer);
  });
  createEffect(on(() => props.active, wake, { defer: true }));

  const button = (tool: Tool) => (
    <button
      classList={{ active: props.active === tool }}
      title={toolTitle(tool)}
      aria-label={TOOL_INFO[tool].label}
      aria-pressed={props.active === tool}
      onClick={() => props.onSelect(tool)}
    >
      {TOOL_INFO[tool].icon()}
    </button>
  );
  return (
    <div
      class="quick-bar"
      classList={{ hidden: !shown() }}
      role="toolbar"
      aria-label="Quick tools"
      onPointerEnter={() => {
        hovered = true;
        wake();
      }}
      onPointerLeave={() => {
        hovered = false;
        wake();
      }}
      // Only keyboard focus keeps it up: a clicked button keeps focus too, and a click on the page doesn't take it away.
      onFocusIn={(e) => {
        focused = e.target.matches(":focus-visible");
        wake();
      }}
      onFocusOut={() => {
        focused = false;
        wake();
      }}
    >
      {button("select")}
      {button("hand")}
      <span class="separator" aria-hidden="true" />
      {/* Re-created when the last tool changes, so its icon follows. */}
      <For each={[props.last]}>{(tool) => button(tool)}</For>
    </div>
  );
}
