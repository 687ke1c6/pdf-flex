// The Shapes tool: what to draw next, and the style of the selected shape (or of the next one).
import { For, Show, type JSX } from "solid-js";
import { useEditor } from "./editor";
import { isSymbol, MAX_STROKE, MIN_STROKE, type ShapeKind } from "./shapes";

const COLORS = [
  { name: "Black", value: "#000000" },
  { name: "Dark blue", value: "#1e3a8a" },
  { name: "Red", value: "#b91c1c" },
];

const icon = (d: string, filled = false) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" classList={{ filled }}>
    <path d={d} />
  </svg>
);

const SHAPES: { tool: ShapeKind; label: string; icon: JSX.Element }[] = [
  { tool: "rect", label: "Rectangle", icon: icon("M4 6h16v12H4z") },
  { tool: "ellipse", label: "Ellipse", icon: icon("M3 12a9 6 0 1 0 18 0a9 6 0 1 0 -18 0") },
  { tool: "line", label: "Line", icon: icon("M5 19 19 5") },
];

const SYMBOL_TOOLS: { tool: ShapeKind; label: string; icon: JSX.Element }[] = [
  { tool: "check", label: "Tick", icon: icon("M5 12.5 9.5 17 19 7") },
  { tool: "cross", label: "Cross", icon: icon("M6 6l12 12M6 18 18 6") },
  { tool: "dot", label: "Dot", icon: icon("M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0", true) },
  { tool: "circle", label: "Circle", icon: icon("M6 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0") },
];

/** A row of colour choices, optionally with "none". */
function ColorChoice(props: {
  label: string;
  value: string | null;
  allowNone: boolean;
  extra?: { name: string; value: string }[];
  onChange(color: string | null, tag?: string): void;
}) {
  const editor = useEditor();
  return (
    <div class="shape-row">
      <span class="shape-label">{props.label}</span>
      <span class="colors" role="group" aria-label={props.label}>
        <Show when={props.allowNone}>
          <button
            class="swatch none"
            classList={{ active: props.value === null }}
            title="None"
            aria-label={`No ${props.label.toLowerCase()}`}
            onClick={() => props.onChange(null)}
          />
        </Show>
        <For each={[...(props.extra ?? []), ...COLORS]}>
          {(color) => (
            <button
              class="swatch"
              classList={{ active: props.value === color.value }}
              style={{ "--swatch": color.value }}
              title={color.name}
              aria-label={color.name}
              onClick={() => props.onChange(color.value)}
            />
          )}
        </For>
        <input
          type="color"
          title="Other colour"
          aria-label={`Other ${props.label.toLowerCase()} colour`}
          value={props.value ?? "#000000"}
          onInput={(e) => props.onChange(e.currentTarget.value, props.label)}
          onChange={() => editor.endChange()}
        />
      </span>
    </div>
  );
}

export function ShapesPanel() {
  const editor = useEditor();
  const selected = () => editor.selectedShape();
  /** What the controls show: the selected shape's style, or the style for the next one. */
  const style = () => selected()?.style ?? editor.shapeStyle();
  /** The kind the controls apply to. */
  const kind = () => selected()?.shape ?? editor.shapeTool();

  const toolButton = (item: { tool: ShapeKind; label: string; icon: JSX.Element }) => (
    <button
      classList={{ active: editor.shapeTool() === item.tool }}
      title={item.label}
      aria-label={item.label}
      aria-pressed={editor.shapeTool() === item.tool}
      onClick={() => editor.setShapeTool(item.tool)}
    >
      {item.icon}
    </button>
  );

  return (
    <section class="shapes-panel">
      <h2>Shapes</h2>
      <div class="shape-tools" role="group" aria-label="Shapes">
        <For each={SHAPES}>{toolButton}</For>
      </div>
      <h3>Symbols</h3>
      <div class="shape-tools" role="group" aria-label="Symbols">
        <For each={SYMBOL_TOOLS}>{toolButton}</For>
      </div>

      <h3>{selected() ? "Selected shape" : "New shapes"}</h3>
      <Show
        when={!isSymbol(kind())}
        fallback={
          <ColorChoice
            label="Colour"
            value={style().stroke}
            allowNone={false}
            onChange={(stroke, tag) => editor.setShapeStyle({ stroke }, tag)}
          />
        }
      >
        <ColorChoice
          label="Outline"
          value={style().stroke}
          allowNone={kind() !== "line" && !!style().fill}
          onChange={(stroke, tag) => editor.setShapeStyle({ stroke }, tag)}
        />
        <div class="shape-row">
          <span class="shape-label">Width</span>
          <label class="size">
            <input
              type="number"
              min={MIN_STROKE}
              max={MAX_STROKE}
              step="0.5"
              value={style().strokeWidth}
              aria-label="Outline width in points"
              disabled={!style().stroke && kind() !== "line"}
              onInput={(e) => {
                const width = e.currentTarget.valueAsNumber;
                if (Number.isFinite(width) && width >= MIN_STROKE && width <= MAX_STROKE)
                  editor.setShapeStyle({ strokeWidth: width }, "width");
              }}
              onChange={(e) => {
                e.currentTarget.value = String(style().strokeWidth);
                editor.endChange();
              }}
            />
            pt
          </label>
        </div>
        <Show when={kind() !== "line"}>
          <ColorChoice
            label="Fill"
            value={style().fill}
            allowNone={!!style().stroke}
            extra={[{ name: "White", value: "#ffffff" }]}
            onChange={(fill, tag) => editor.setShapeStyle({ fill }, tag)}
          />
        </Show>
      </Show>
    </section>
  );
}
