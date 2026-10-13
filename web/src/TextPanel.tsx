// The Text tool: adding text boxes, and the style of the selected one (or of the next one).
import { For, Show } from "solid-js";
import { useEditor } from "./editor";
import { clampSize, MAX_SIZE, MIN_SIZE, PREVIEW_FONTS, type TextAlign, type TextFamily } from "./textLayout";
import { unsupportedChars } from "./winansi";

const FAMILIES: TextFamily[] = ["Helvetica", "Times", "Courier"];
const COLORS = [
  { name: "Black", value: "#000000" },
  { name: "Dark blue", value: "#1e3a8a" },
  { name: "Red", value: "#b91c1c" },
];
const ALIGNS: { value: TextAlign; label: string; icon: string }[] = [
  { value: "left", label: "Align left", icon: "M4 6h16M4 10h10M4 14h16M4 18h10" },
  { value: "center", label: "Centre", icon: "M4 6h16M7 10h10M4 14h16M7 18h10" },
  { value: "right", label: "Align right", icon: "M4 6h16M10 10h10M4 14h16M10 18h10" },
];

export function TextPanel(props: { currentPage: number }) {
  const editor = useEditor();
  /** What the controls show: the selected text box's style, or the style for the next one. */
  const style = () => editor.selectedText()?.style ?? editor.textStyle();
  const unsupported = () => unsupportedChars(editor.selectedText()?.text ?? "");

  return (
    <section class="text-panel">
      <h2>Text</h2>
      <button class="block" onClick={() => editor.addText(props.currentPage)}>
        Add text to page {props.currentPage}
      </button>

      <h3>{editor.selectedText() ? "Selected text" : "New text"}</h3>
      <div class="segmented" role="group" aria-label="Font">
        <For each={FAMILIES}>
          {(family) => (
            <button
              classList={{ active: style().family === family }}
              style={{ "font-family": PREVIEW_FONTS[family].css }}
              aria-pressed={style().family === family}
              onClick={() => editor.setTextStyle({ family })}
            >
              {family}
            </button>
          )}
        </For>
      </div>

      <div class="text-row">
        <div class="segmented" role="group" aria-label="Font style">
          <button
            class="bold"
            classList={{ active: style().bold }}
            title="Bold"
            aria-pressed={style().bold}
            onClick={() => editor.setTextStyle({ bold: !style().bold })}
          >
            B
          </button>
          <button
            class="italic"
            classList={{ active: style().italic }}
            title="Italic"
            aria-pressed={style().italic}
            onClick={() => editor.setTextStyle({ italic: !style().italic })}
          >
            I
          </button>
        </div>
        <label class="size">
          <input
            type="number"
            min={MIN_SIZE}
            max={MAX_SIZE}
            step="0.5"
            value={style().size}
            aria-label="Font size in points"
            onInput={(e) => {
              const size = e.currentTarget.valueAsNumber;
              if (Number.isFinite(size) && size >= MIN_SIZE && size <= MAX_SIZE) editor.setTextStyle({ size: clampSize(size) }, "size");
            }}
            onChange={(e) => {
              // Out-of-range or empty input snaps back to what's in use.
              e.currentTarget.value = String(style().size);
              editor.endChange();
            }}
          />
          pt
        </label>
      </div>

      <div class="text-row">
        <div class="segmented" role="group" aria-label="Alignment">
          <For each={ALIGNS}>
            {(align) => (
              <button
                classList={{ active: style().align === align.value }}
                title={align.label}
                aria-label={align.label}
                aria-pressed={style().align === align.value}
                onClick={() => editor.setTextStyle({ align: align.value })}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={align.icon} />
                </svg>
              </button>
            )}
          </For>
        </div>
        <span class="colors" role="group" aria-label="Colour">
          <For each={COLORS}>
            {(color) => (
              <button
                class="swatch"
                classList={{ active: style().color === color.value }}
                style={{ "--swatch": color.value }}
                title={color.name}
                aria-label={color.name}
                onClick={() => editor.setTextStyle({ color: color.value })}
              />
            )}
          </For>
          <input
            type="color"
            title="Other colour"
            aria-label="Other colour"
            value={style().color}
            onInput={(e) => editor.setTextStyle({ color: e.currentTarget.value }, "color")}
            onChange={() => editor.endChange()}
          />
        </span>
      </div>

      <Show when={unsupported().length}>
        <p class="text-warning" role="alert">
          Can't be saved as text in {style().family}: {unsupported().join(" ")}. Remove {unsupported().length > 1 ? "them" : "it"}{" "}
          before downloading.
        </p>
      </Show>
    </section>
  );
}
