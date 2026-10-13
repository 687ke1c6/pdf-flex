// A text placement on the page: previewed from its layout, or edited in place.
import { createMemo, For, onMount } from "solid-js";
import { useEditor } from "./editor";
import "./fonts";
import type { TextPlacement } from "./placement";
import { layoutText, LINE_HEIGHT, PREVIEW_FONTS, type TextStyle } from "./textLayout";
import { winAnsiByte } from "./winansi";

/** Splits text into runs of characters that can and can't be written. */
function runs(text: string): { text: string; bad: boolean }[] {
  const out: { text: string; bad: boolean }[] = [];
  for (const char of text) {
    const bad = char !== "\n" && winAnsiByte(char) === undefined;
    const last = out.at(-1);
    if (last && last.bad === bad) last.text += char;
    else out.push({ text: char, bad });
  }
  return out;
}

const fontCss = (style: TextStyle) => ({
  "font-family": PREVIEW_FONTS[style.family].css,
  "font-weight": style.bold ? "bold" : "normal",
  "font-style": style.italic ? "italic" : "normal",
});

/**
 * The finished look, drawn in points from the same layout `pdf-stamp` gets.
 * Each line is stretched to its exact width in the standard font, so the
 * preview font's tiny differences never show.
 */
export function TextPreview(props: { placement: TextPlacement }) {
  const layout = createMemo(() => layoutText(props.placement.text, props.placement.style));
  return (
    <svg
      class="text-preview"
      viewBox={`0 0 ${layout().width} ${layout().height}`}
      preserveAspectRatio="none"
      aria-label={props.placement.text}
    >
      <For each={layout().lines.filter((l) => l.text)}>
        {(line) => (
          <text
            x={line.x}
            y={layout().height - line.y}
            font-size={String(props.placement.style.size)}
            fill={props.placement.style.color}
            textLength={line.width}
            lengthAdjust="spacingAndGlyphs"
            style={fontCss(props.placement.style)}
          >
            <For each={runs(line.text)}>{(run) => <tspan class={run.bad ? "bad" : undefined}>{run.text}</tspan>}</For>
          </text>
        )}
      </For>
    </svg>
  );
}

/**
 * A textarea over the box in the same font, size and line spacing, so the
 * text stays where the preview draws it. A backdrop behind it underlines
 * characters that can't be written.
 */
export function TextEditor(props: { placement: TextPlacement; scale: number }) {
  const editor = useEditor();
  let textarea!: HTMLTextAreaElement;
  const style = () => props.placement.style;
  const px = (pt: number) => `${pt * props.scale}px`;

  onMount(() => {
    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  });

  return (
    <div
      class="text-editor"
      style={{
        ...fontCss(style()),
        "font-size": px(style().size),
        "line-height": px(style().size * LINE_HEIGHT),
        "text-align": style().align,
        color: style().color,
        // Room for the caret either side, outside the text area itself.
        "--pad": px(style().size / 2),
      }}
    >
      <div class="text-backdrop" aria-hidden="true">
        <For each={runs(props.placement.text)}>{(run) => (run.bad ? <mark>{run.text}</mark> : run.text)}</For>
        {/* A trailing newline needs a character after it to take up a line. */}
        {"​"}
      </div>
      <textarea
        ref={textarea}
        value={props.placement.text}
        wrap="off"
        spellcheck={false}
        autocapitalize="off"
        aria-label="Text"
        onInput={(e) => editor.typeText(props.placement.id, e.currentTarget.value)}
        onBlur={() => editor.endEdit()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Escape finishes editing but keeps the box selected.
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
