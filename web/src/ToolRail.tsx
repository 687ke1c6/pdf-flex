// The strip of tool buttons on the far left. Each tool has its own panel next to it.
import { For, type JSX } from "solid-js";

export type Tool = "signatures" | "text";

interface ToolInfo {
  id: Tool;
  label: string;
  icon: () => JSX.Element;
}

/** Stroke icons on a 24 × 24 grid, drawn in the button's text colour. */
const icon = (path: string) => () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={path} />
  </svg>
);

export const TOOLS: ToolInfo[] = [
  { id: "signatures", label: "Signatures", icon: icon("M3 17c3-1 4-8 6-8s0 7 2 7 3-4 4-4 1 3 3 3 2-1 3-1M3 21h18") },
  { id: "text", label: "Text", icon: icon("M5 6V4h14v2M12 4v16M9 20h6") },
];

const STORAGE_KEY = "pdf-flex:tool";

/** The tool open last time, or the first one. Storage may be unavailable (private mode, blocked). */
export function savedTool(): Tool {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return TOOLS.find((t) => t.id === saved)?.id ?? TOOLS[0].id;
  } catch {
    return TOOLS[0].id;
  }
}

export function saveTool(tool: Tool) {
  try {
    localStorage.setItem(STORAGE_KEY, tool);
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

interface Props {
  active: Tool;
  /** Whether the active tool's panel is showing. */
  open: boolean;
  /** Clicking the active tool toggles its panel; clicking another tool opens that one. */
  onSelect(tool: Tool): void;
}

export function ToolRail(props: Props) {
  return (
    <nav class="tool-rail" aria-label="Tools">
      <For each={TOOLS}>
        {(tool) => (
          <button
            classList={{ active: props.active === tool.id }}
            title={tool.label}
            aria-label={tool.label}
            aria-pressed={props.active === tool.id && props.open}
            onClick={() => props.onSelect(tool.id)}
          >
            {tool.icon()}
          </button>
        )}
      </For>
    </nav>
  );
}
