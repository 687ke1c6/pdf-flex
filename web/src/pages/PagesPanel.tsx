// The Pages tool (behind the "pages" feature flag): the document's pages as
// thumbnails, to delete pages and to insert blank pages or pages from other PDFs
// between them. See docs/pages-plan.md.
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { SIGNATURE_DRAG_TYPE, useEditor } from "../document/editor";
import type { NewSlot, Slot, Source } from "../document/pages";
import { PageRangeDialog } from "./PageRangeDialog";
import { blankSource, sourceFrom } from "./source";
import { Thumbnail } from "./Thumbnail";

interface Props {
  /** The page in view (1-based). */
  page: number;
  onGoToPage(page: number): void;
  onError(message: string): void;
}

const pagesOf = (source: Source): NewSlot[] =>
  source.pdf.pages.map(({ width, height }, index) => ({ source: source.id, index, width, height }));

export function PagesPanel(props: Props) {
  const editor = useEditor();
  const slots = () => editor.slots();
  /** The selected pages, by slot key. */
  const [picked, setPicked] = createSignal<string[]>([]);
  /** Where Shift+click ranges start from: the last page clicked without Shift (0-based). */
  let anchor = 0;
  /** The gap whose insert actions are showing (0-based position to insert at), if any. */
  const [openGap, setOpenGap] = createSignal<number | null>(null);
  /** Where dropped PDFs would go (0-based), while files are dragged over the list. */
  const [dropAt, setDropAt] = createSignal<number | null>(null);
  /** The PDF whose pages are being chosen, and where the choice goes. */
  const [choosing, setChoosing] = createSignal<{ source: Source; resolve(pages: number[] | null): void } | null>(null);
  const [busy, setBusy] = createSignal(false);
  /** Where a chosen PDF goes (0-based). */
  let insertAt = 0;
  let fileInput!: HTMLInputElement;
  let list!: HTMLOListElement;

  const isPicked = (slot: Slot) => picked().includes(slot.key);
  // Keys are only unique within a document: another tab's selection must not carry over.
  createEffect(
    on(
      editor.doc,
      () => {
        setPicked([]);
        setOpenGap(null);
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

  /** Deletes pages (1-based). */
  function remove(pages: number[]) {
    if (!pages.length) return;
    if (!editor.deletePages(pages)) {
      props.onError("A document needs at least one page, so its last page can't be deleted.");
      return;
    }
    const left = new Set(slots().map((s) => s.key));
    setPicked((keys) => keys.filter((k) => left.has(k)));
  }

  /** The × on a page: deletes the selected pages if it's one of them, else just that page. */
  function removeFrom(i: number) {
    const slot = slots()[i];
    if (!isPicked(slot)) return remove([i + 1]);
    remove(slots().flatMap((s, j) => (isPicked(s) ? [j + 1] : [])));
  }

  /** Delete removes the selected pages; Up and Down move the selection. Kept from the document's own shortcuts. */
  function onKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      remove(slots().flatMap((s, j) => (isPicked(s) ? [j + 1] : [])));
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
    setOpenGap(null);
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

  /** A blank page the size of its neighbour: the page before it, or after it at the start. */
  function insertBlank(at: number) {
    const next = slots()[at > 0 ? at - 1 : 0];
    void insert(at, "a blank page", () => blankSource(next.width, next.height, editor.doc().sources));
  }

  function choosePdf(at: number) {
    insertAt = at;
    fileInput.click();
  }

  /** The space before page `at + 1` (or after the last page): ＋ opens what can be inserted there. */
  const Gap = (gap: { at: () => number }) => {
    const open = () => openGap() === gap.at();
    const dropping = () => dropAt() === gap.at();
    const where = () => (gap.at() < slots().length ? `before page ${gap.at() + 1}` : "at the end");
    return (
      <li class="page-gap" classList={{ open: open(), drop: dropping() }}>
        <button
          class="gap-plus"
          title={`Insert ${where()}`}
          aria-label={`Insert ${where()}`}
          aria-expanded={open()}
          disabled={busy()}
          onClick={() => setOpenGap(open() ? null : gap.at())}
        >
          +
        </button>
        <Show when={open()}>
          <span class="gap-actions">
            <button onClick={() => insertBlank(gap.at())}>Blank page</button>
            <button onClick={() => choosePdf(gap.at())}>PDF…</button>
          </span>
        </Show>
      </li>
    );
  };

  return (
    <section class="pages-panel">
      <div class="section-head">
        <h2>Pages</h2>
        <span class="hint">{busy() ? "Adding…" : `${slots().length} ${slots().length === 1 ? "page" : "pages"}`}</span>
      </div>
      <button class="block" disabled={busy()} onClick={() => choosePdf(slots().length)}>
        Add PDF at the end…
      </button>
      <p class="hint">Drop PDFs between pages to insert them there.</p>
      <ol
        class="page-list"
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
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) void insert(insertAt, `“${file.name}”`, loadFile(file));
        }}
      />
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
