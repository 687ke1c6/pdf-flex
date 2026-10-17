// The Pages tool: the document's pages as
// thumbnails, to delete pages and to insert blank pages or pages from other PDFs
// between them. See docs/pages-plan.md.
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { SIGNATURE_DRAG_TYPE, useEditor } from "../document/editor";
import { pagesOf, type Slot, type Source } from "../document/pages";
import type { PageSize } from "../viewer/pdf";
import { InsertDialog } from "./InsertDialog";
import { PageRangeDialog } from "./PageRangeDialog";
import { blankSource, sourceFrom } from "./source";
import { Thumbnail } from "./Thumbnail";
import { thumbsSmall, ThumbSizeSwitch } from "./ThumbSizeSwitch";

interface Props {
  /** The page in view (1-based). */
  page: number;
  onGoToPage(page: number): void;
  onError(message: string): void;
  /** Something to know about the document that isn't an error (shown with its other warnings). */
  onWarning(message: string): void;
}


/** A page size as people know it: "Letter", "A4 landscape", or points. */
function sizeName({ width, height }: PageSize): string {
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  const named = [
    { name: "Letter", w: 612, h: 792 },
    { name: "A4", w: 595.28, h: 841.89 },
    { name: "Legal", w: 612, h: 1008 },
  ].find((p) => (near(width, p.w) && near(height, p.h)) || (near(width, p.h) && near(height, p.w)));
  if (named) return width > height ? `${named.name} landscape` : named.name;
  return `${Math.round(width)} × ${Math.round(height)} pt`;
}

export function PagesPanel(props: Props) {
  const editor = useEditor();
  const slots = () => editor.slots();
  /** The selected pages, by slot key. */
  const [picked, setPicked] = createSignal<string[]>([]);
  /** Where Shift+click ranges start from: the last page clicked without Shift (0-based). */
  let anchor = 0;
  /** The gap whose Insert dialog is open (0-based position to insert at), if any. */
  const [inserting, setInserting] = createSignal<number | null>(null);
  /** Where dropped PDFs would go (0-based), while files are dragged over the list. */
  const [dropAt, setDropAt] = createSignal<number | null>(null);
  /** The PDF whose pages are being chosen, and where the choice goes. */
  const [choosing, setChoosing] = createSignal<{ source: Source; resolve(pages: number[] | null): void } | null>(null);
  const [busy, setBusy] = createSignal(false);
  let list!: HTMLOListElement;

  const isPicked = (slot: Slot) => picked().includes(slot.key);
  // Keys are only unique within a document: another tab's selection must not carry over.
  createEffect(
    on(
      editor.doc,
      () => {
        setPicked([]);
        anchor = 0;
      },
      { defer: true },
    ),
  );

  function click(e: MouseEvent, i: number) {
    const key = slots()[i].key;
    if (e.shiftKey) {
      const [from, to] = [Math.min(anchor, i), Math.max(anchor, i)];
      setPicked(slots().slice(from, to + 1).map((s) => s.key));
    } else if (e.ctrlKey || e.metaKey) {
      setPicked((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));
      anchor = i;
    } else {
      setPicked([key]);
      anchor = i;
      props.onGoToPage(i + 1);
    }
  }

  /** Deletes pages (1-based). Deleting every page leaves a blank page the size of the first. */
  async function remove(pages: number[]) {
    if (!pages.length) return;
    if (new Set(pages).size >= slots().length) {
      const { width, height } = slots()[0];
      try {
        const blank = editor.addSource(await blankSource(width, height, editor.doc().sources));
        editor.deletePages(pages, { source: blank.id, index: 0, width, height });
      } catch (err) {
        props.onError(`Couldn't delete the pages: ${err instanceof Error ? err.message : err}`);
      }
    } else editor.deletePages(pages);
    const left = new Set(slots().map((s) => s.key));
    setPicked((keys) => keys.filter((k) => left.has(k)));
  }

  /** The × on a page: deletes the selected pages if it's one of them, else just that page. */
  function removeFrom(i: number) {
    const slot = slots()[i];
    if (!isPicked(slot)) return void remove([i + 1]);
    void remove(slots().flatMap((s, j) => (isPicked(s) ? [j + 1] : [])));
  }

  /** Delete removes the selected pages; Up and Down move the selection. Kept from the document's own shortcuts. */
  function onKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      void remove(slots().flatMap((s, j) => (isPicked(s) ? [j + 1] : [])));
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      const last = slots().findIndex((s) => s.key === picked().at(-1));
      const i = Math.max(0, Math.min(slots().length - 1, (last < 0 ? props.page - 1 : last) + (e.key === "ArrowUp" ? -1 : 1)));
      setPicked([slots()[i].key]);
      anchor = i;
      props.onGoToPage(i + 1);
      list.querySelectorAll<HTMLButtonElement>(".page-item > button.select")[i]?.focus();
    }
  }

  /** Asks which pages of a PDF to insert; resolves to them (0-based), or null if cancelled. */
  const choosePages = (source: Source) => new Promise<number[] | null>((resolve) => setChoosing({ source, resolve }));

  /**
   * Inserts pages of a source at `at`: all of them, or for a PDF with several,
   * the ones chosen in the range dialog. `what` names it in an error. Resolves
   * to how many pages went in.
   */
  async function insert(at: number, what: string, load: () => Promise<Source>): Promise<number> {
    setBusy(true);
    try {
      const loaded = await load();
      const isNew = !editor.doc().sources.has(loaded.id);
      let pages = pagesOf(loaded);
      if (pages.length > 1) {
        const chosen = await choosePages(loaded);
        if (!chosen) {
          if (isNew) void loaded.pdf.close();
          return 0;
        }
        pages = chosen.map((i) => pages[i]);
      }
      editor.addSource(loaded);
      editor.insertPages(at, pages);
      if (isNew && loaded.digitallySigned)
        props.onWarning(`“${loaded.name}” is digitally signed. Saving changes will make its digital signature invalid.`);
      return pages.length;
    } catch (err) {
      props.onError(`Couldn't add ${what}: ${err instanceof Error ? err.message : err}`);
      return 0;
    } finally {
      setBusy(false);
    }
  }

  const loadFile = (file: File) => () => sourceFrom(file, editor.doc().sources);

  /** Inserts PDF files one after another, starting at `at`. */
  async function insertFiles(files: File[], at: number) {
    for (const file of files) at += await insert(at, `“${file.name}”`, loadFile(file));
  }

  // Dropping PDFs on the list inserts them where the line shows. Handled here (default prevented), the app
  // doesn't also open them in a tab.
  const isFileDrag = (e: DragEvent) => {
    const types = e.dataTransfer?.types ?? [];
    return types.includes("Files") && !types.includes(SIGNATURE_DRAG_TYPE);
  };
  /** The gap nearest a point: before the first page whose middle is below it. */
  function gapAt(clientY: number): number {
    const items = [...list.querySelectorAll<HTMLElement>(".page-item")];
    const i = items.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return clientY < r.top + r.height / 2;
    });
    return i < 0 ? items.length : i;
  }
  function onDragOver(e: DragEvent) {
    if (!isFileDrag(e) || busy()) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
    setDropAt(gapAt(e.clientY));
  }
  function onDragLeave(e: DragEvent) {
    if (!list.contains(e.relatedTarget as Node | null)) setDropAt(null);
  }
  function onDrop(e: DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    const at = dropAt() ?? gapAt(e.clientY);
    setDropAt(null);
    if (busy()) return;
    const pdfs = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (!pdfs.length) return props.onError("That doesn't look like a PDF.");
    void insertFiles(pdfs, at);
  }

  /** The page a blank page at `at` copies its size from (1-based): the one before it, or after it at the start. */
  const neighbour = (at: number) => (at > 0 ? at : 1);

  function insertBlank(at: number) {
    const { width, height } = slots()[neighbour(at) - 1];
    void insert(at, "a blank page", () => blankSource(width, height, editor.doc().sources));
  }

  const where = (at: number) => (at < slots().length ? `before page ${at + 1}` : "at the end");

  /** The space before page `at + 1` (or after the last page): ＋ asks what to insert there. */
  const Gap = (gap: { at: () => number }) => (
    <li class="page-gap" classList={{ open: inserting() === gap.at(), drop: dropAt() === gap.at() }}>
      <button
        class="gap-plus"
        title={`Insert ${where(gap.at())}`}
        aria-label={`Insert ${where(gap.at())}`}
        aria-haspopup="dialog"
        disabled={busy()}
        onClick={() => setInserting(gap.at())}
      >
        {/* Drawn, not a "+" character, so it sits exactly in the middle. */}
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 2v8M2 6h8" />
        </svg>
      </button>
    </li>
  );

  return (
    <section class="pages-panel">
      <div class="section-head">
        <h2>Pages</h2>
        <span class="hint">{busy() ? "Adding…" : `${slots().length} ${slots().length === 1 ? "page" : "pages"}`}</span>
        <ThumbSizeSwitch />
      </div>
      <p class="hint">＋ between pages inserts there. You can also drop PDFs between pages.</p>
      <ol
        class="page-list"
        classList={{ small: thumbsSmall() }}
        ref={list}
        aria-label="Pages"
        on:keydown={onKeyDown}
        on:dragover={onDragOver}
        on:dragleave={onDragLeave}
        on:drop={onDrop}
      >
        <Gap at={() => 0} />
        <For each={slots()}>
          {(slot, i) => {
            const source = () => editor.doc().sources.get(slot.source)!;
            return (
              <>
                <li class="page-item" classList={{ picked: isPicked(slot), current: props.page === i() + 1 }}>
                  <button
                    class="select"
                    title={`Page ${i() + 1} · ${source().name}`}
                    aria-label={`Page ${i() + 1}`}
                    aria-pressed={isPicked(slot)}
                    onClick={(e) => click(e, i())}
                  >
                    <Thumbnail doc={source().pdf.doc} sourcePage={slot.index + 1} size={slot} />
                    <span class="page-number">{i() + 1}</span>
                  </button>
                  <button
                    class="icon remove"
                    title={isPicked(slot) && picked().length > 1 ? "Delete the selected pages" : "Delete this page"}
                    aria-label={`Delete page ${i() + 1}`}
                    onClick={() => removeFrom(i())}
                  >
                    ×
                  </button>
                </li>
                <Gap at={() => i() + 1} />
              </>
            );
          }}
        </For>
      </ol>
      {/* Wrapped: position 0 (before page 1) would read as "nothing to show". */}
      <Show when={inserting() !== null && { at: inserting()! }} keyed>
        {({ at }) => (
          <InsertDialog
            title={`Insert ${where(at)}`}
            blankNote={`Same size as page ${neighbour(at)}: ${sizeName(slots()[neighbour(at) - 1])}`}
            load={(file) => sourceFrom(file, editor.doc().sources)}
            onDone={(choice) => {
              setInserting(null);
              if (choice?.kind === "blank") insertBlank(at);
              else if (choice?.kind === "pdf") void insert(at, `“${choice.source.name}”`, async () => choice.source);
            }}
          />
        )}
      </Show>
      <Show when={choosing()} keyed>
        {(c) => (
          <PageRangeDialog
            source={c.source}
            onDone={(pages) => {
              setChoosing(null);
              c.resolve(pages);
            }}
          />
        )}
      </Show>
    </section>
  );
}
