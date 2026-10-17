// Which pages of a PDF to insert: all of them, or a range typed or picked from thumbnails.
import { createSignal, For, onMount, Show } from "solid-js";
import type { Source } from "../document/pages";
import { formatRanges, parseRanges } from "./ranges";
import { Thumbnail } from "./Thumbnail";

interface Props {
  source: Source;
  /** The chosen pages (0-based, in order), or null if cancelled. Called once. */
  onDone(pages: number[] | null): void;
}

export function PageRangeDialog(props: Props) {
  let dialog!: HTMLDialogElement;
  let rangeInput!: HTMLInputElement;
  let result: number[] | null = null;
  onMount(() => dialog.showModal());

  const count = props.source.pdf.pages.length;
  const all = Array.from({ length: count }, (_, i) => i);
  const [some, setSome] = createSignal(false);
  const [text, setText] = createSignal(`1-${count}`);
  /** The chosen pages, or what's wrong with the typed range. */
  const chosen = (): number[] | string => (some() ? parseRanges(text(), count) : all);
  const pages = () => {
    const c = chosen();
    return typeof c === "string" ? [] : c;
  };

  /** A click on a thumbnail adds or removes its page, switching to a range. */
  function toggle(i: number) {
    const now = pages();
    setText(formatRanges(now.includes(i) ? now.filter((p) => p !== i) : [...now, i]));
    setSome(true);
  }

  return (
    <dialog ref={dialog} class="dialog page-range-dialog" onClose={() => props.onDone(result)}>
      <form
        method="dialog"
        onSubmit={(e) => {
          if (typeof chosen() === "string") return e.preventDefault();
          result = pages();
        }}
      >
        <h2>Insert pages from “{props.source.name}”</h2>
        <p class="hint">
          It has {count} pages. Insert all of them, or type which ones, or click pages to pick them.
        </p>
        <label class="row">
          <input type="radio" name="which" checked={!some()} onChange={() => setSome(false)} />
          All pages
        </label>
        <label class="row">
          <input
            type="radio"
            name="which"
            checked={some()}
            onChange={() => {
              setSome(true);
              rangeInput.focus();
            }}
          />
          Pages
          <input
            ref={rangeInput}
            type="text"
            value={text()}
            placeholder="e.g. 1-3, 5"
            aria-label="Pages to insert"
            onFocus={() => setSome(true)}
            onInput={(e) => {
              setText(e.currentTarget.value);
              setSome(true);
            }}
          />
        </label>
        <Show when={typeof chosen() === "string"}>
          <p class="dialog-error" role="alert">
            {chosen() as string}
          </p>
        </Show>
        <ol class="range-thumbs" aria-label="Pages">
          <For each={props.source.pdf.pages}>
            {(size, i) => (
              <li>
                <button
                  type="button"
                  classList={{ picked: pages().includes(i()) }}
                  aria-pressed={pages().includes(i())}
                  aria-label={`Page ${i() + 1}`}
                  onClick={() => toggle(i())}
                >
                  <Thumbnail doc={props.source.pdf.doc} sourcePage={i() + 1} size={size} />
                  <span class="page-number">{i() + 1}</span>
                </button>
              </li>
            )}
          </For>
        </ol>
        <div class="dialog-actions">
          <button type="button" onClick={() => dialog.close()}>
            Cancel
          </button>
          <button type="submit" class="primary" disabled={!pages().length}>
            Insert {pages().length} {pages().length === 1 ? "page" : "pages"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
