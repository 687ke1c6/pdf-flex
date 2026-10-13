import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { download, editedName } from "./download";
import { SIGNATURE_DRAG_TYPE, useEditor } from "./editor";
import { openPdf, type LoadedPdf } from "./pdf";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { inspectPdf, sameLayout, stampPdf } from "./stamper";
import { clampZoom, stepZoom } from "./zoom";
import { AboutDialog, UpdatePrompt } from "./pwa";
import { Viewer, type ViewerApi } from "./Viewer";

/** An opened file. `bytes` is the untouched original, which is what gets stamped. */
interface OpenFile {
  name: string;
  bytes: Uint8Array;
  pdf: LoadedPdf;
}

export function App() {
  const editor = useEditor();
  const [file, setFile] = createSignal<OpenFile | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [zoom, setZoom] = createSignal(1);
  const [page, setPage] = createSignal(1);
  const [dragging, setDragging] = createSignal(false);
  const [samples, setSamples] = createSignal<string[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [about, setAbout] = createSignal(false);
  let viewer: ViewerApi | undefined;
  let fileInput!: HTMLInputElement;

  async function open(name: string, bytes: Uint8Array) {
    if (editor.dirty() && !confirm("Your changes haven't been downloaded. Open another PDF and discard them?")) return;
    setError("");
    setLoading(true);
    try {
      const pdf = await openPdf(bytes);
      await file()?.pdf.close();
      setPage(1);
      editor.reset(pdf.pages);
      const opened = { name, bytes, pdf };
      setFile(opened);
      // In the background: warn now, not at save time, if this PDF can't be edited.
      inspectPdf(bytes).then(
        ({ pages, digitallySigned }) => {
          if (file() !== opened) return;
          const warnings = [];
          if (digitallySigned)
            warnings.push("This PDF is digitally signed. Saving changes to it will make the existing digital signature invalid.");
          if (!sameLayout(pdf.pages, pages))
            warnings.push("This PDF's page layout is unusual, so items may not land exactly where you place them. Check the downloaded file.");
          if (warnings.length) setError(warnings.join(" "));
        },
        (err) => {
          if (file() === opened) setError(`You can view this PDF, but not edit it. ${err instanceof Error ? err.message : err}`);
        },
      );
    } catch (err) {
      setError(`Couldn't open ${name}: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  }

  const openFile = async (f: File) => open(f.name, new Uint8Array(await f.arrayBuffer()));

  async function openSample(path: string) {
    const res = await fetch(`/samples/${path}`);
    await open(path.split("/").pop()!, new Uint8Array(await res.arrayBuffer()));
  }

  /** Samples grouped by folder, e.g. "corpus/real" → ["corpus/real/a.pdf", …]. */
  const sampleGroups = () => {
    const groups = new Map<string, string[]>();
    for (const path of samples()) {
      const group = path.slice(0, path.lastIndexOf("/"));
      groups.set(group, [...(groups.get(group) ?? []), path]);
    }
    return [...groups];
  };

  const zoomTo = (z: number) => setZoom(clampZoom(z));

  // Drag and drop anywhere in the window.
  // Chrome also reports "Files" when an <img> is dragged, so exclude our own signature drag.
  // While a dialog is open, it handles its own drops (e.g. importing a signature image).
  const isFileDrag = (e: DragEvent) => {
    const types = e.dataTransfer?.types ?? [];
    return types.includes("Files") && !types.includes(SIGNATURE_DRAG_TYPE) && !document.querySelector("dialog[open]");
  };
  // Capture phase: runs even if a drop target (e.g. a page) stops propagation.
  const endDrag = () => setDragging(false);
  function onDragOver(e: DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setDragging(true);
  }
  function onDragLeave(e: DragEvent) {
    // Only when leaving the window, not when moving between child elements.
    if (!e.relatedTarget) setDragging(false);
  }
  async function onDrop(e: DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setDragging(false);
    const f = [...(e.dataTransfer?.files ?? [])].find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (f) await openFile(f);
    else setError("That doesn't look like a PDF.");
  }

  async function save() {
    const f = file();
    editor.endEdit();
    if (!f || !editor.placements.length) return;
    setError("");
    setSaving(true);
    try {
      const images = new Map<string, Uint8Array>();
      for (const p of editor.placements) {
        if (p.kind !== "image" || images.has(p.signatureId)) continue;
        const sig = editor.signature(p.signatureId);
        if (sig) images.set(p.signatureId, new Uint8Array(await sig.png.arrayBuffer()));
      }
      download(await stampPdf(f.bytes, editor.placements, images), editedName(f.name));
      editor.markSaved();
    } catch (err) {
      setError(`Couldn't save: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const typing =
      e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    // Dialogs (new signature) handle their own keys.
    if (document.querySelector("dialog[open]")) return;
    const mod = e.ctrlKey || e.metaKey;

    // Undo / redo placements. In text fields, the field's own undo applies.
    if (mod && !typing && file()) {
      const key = e.key.toLowerCase();
      if (key === "z" || key === "y") {
        e.preventDefault();
        if (key === "y" || e.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
    }

    // Arrow keys nudge the selected placement: 1 pt, or 10 pt with Shift.
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1], // display space has y up
      ArrowDown: [0, -1],
    };
    if (editor.selected() && !typing && !mod && e.key in arrows) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      const step = e.shiftKey ? 10 : 1;
      editor.nudge(dx * step, dy * step);
      return;
    }

    // Delete / Escape act on the selected placement; Enter edits selected text.
    const selected = editor.selected();
    if (selected && !typing && !mod && e.key === "Enter" && editor.selectedText()) {
      e.preventDefault();
      editor.beginEdit(selected);
      return;
    }
    if (selected && !typing && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      editor.remove(selected);
      return;
    }
    if (e.key === "Escape") editor.select(null);

    // Ctrl/Cmd + plus, minus, 0 zoom the document instead of the browser UI.
    if (!(e.ctrlKey || e.metaKey) || !file()) return;
    if (e.key === "=" || e.key === "+") zoomTo(stepZoom(zoom(), 1));
    else if (e.key === "-") zoomTo(stepZoom(zoom(), -1));
    else if (e.key === "0") zoomTo(1);
    else return;
    e.preventDefault();
  }

  onMount(() => {
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("drop", endDrag, { capture: true });
    window.addEventListener("keydown", onKeyDown);
    // Arrow-key nudges in a row undo as one step; releasing the key ends the run.
    const onKeyUp = (e: KeyboardEvent) => e.key.startsWith("Arrow") && editor.endChange();
    window.addEventListener("keyup", onKeyUp);
    // Closing or reloading the tab with placements not yet downloaded asks first.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!editor.dirty()) return;
      e.preventDefault();
      e.returnValue = ""; // older browsers need this as well
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    onCleanup(() => {
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("drop", endDrag, { capture: true });
      window.removeEventListener("keydown", onKeyDown);
    });
    editor.loadLibrary().catch((err) => setError(`Couldn't load saved signatures: ${err instanceof Error ? err.message : err}`));
    if (import.meta.env.DEV) {
      fetch("/samples/index.json")
        .then((r) => (r.ok ? r.json() : []))
        .then(setSamples)
        .catch(() => {});
    }
  });

  return (
    <div class="app">
      <header class="toolbar">
        <button onClick={() => fileInput.click()}>Open PDF…</button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={async (e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (f) await openFile(f);
          }}
        />
        <Show when={samples().length}>
          <select
            title="Dev only: test PDFs from out/"
            onChange={async (e) => {
              const path = e.currentTarget.value;
              e.currentTarget.value = "";
              if (path) await openSample(path);
            }}
          >
            <option value="">Samples…</option>
            <For each={sampleGroups()}>
              {([group, paths]) => (
                <optgroup label={group}>
                  <For each={paths}>{(path) => <option value={path}>{path.slice(group.length + 1)}</option>}</For>
                </optgroup>
              )}
            </For>
          </select>
        </Show>

        <Show when={file()}>
          {(f) => (
            <>
              <span class="name" title={f().name}>
                {f().name}
              </span>
              <span class="spacer" />
              <span class="edit-actions">
                <button class="icon-button" title="Undo (Ctrl Z)" aria-label="Undo" disabled={!editor.canUndo()} onClick={() => editor.undo()}>
                  ↶
                </button>
                <button class="icon-button" title="Redo (Ctrl Shift Z)" aria-label="Redo" disabled={!editor.canRedo()} onClick={() => editor.redo()}>
                  ↷
                </button>
                <button
                  class="primary download"
                  title="Download a copy with your changes. The original file is not changed."
                  disabled={!editor.placements.length || saving()}
                  onClick={save}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />
                  </svg>
                  <span class="label">{saving() ? "Saving…" : "Download PDF"}</span>
                </button>
              </span>
              <span class="separator" aria-hidden="true" />
              <label class="page-nav">
                Page
                <input
                  type="number"
                  min="1"
                  max={f().pdf.pages.length}
                  value={page()}
                  onChange={(e) => viewer?.goToPage(Number(e.currentTarget.value))}
                />
                / {f().pdf.pages.length}
              </label>
              <span class="zoom">
                <button title="Zoom out (Ctrl −)" onClick={() => zoomTo(stepZoom(zoom(), -1))}>
                  −
                </button>
                <span class="zoom-value">{Math.round(zoom() * 100)}%</span>
                <button title="Zoom in (Ctrl +)" onClick={() => zoomTo(stepZoom(zoom(), 1))}>
                  +
                </button>
                <button title="Actual size (Ctrl 0)" onClick={() => zoomTo(1)}>
                  100%
                </button>
                <button onClick={() => viewer?.fitWidth()}>Fit width</button>
              </span>
            </>
          )}
        </Show>
        <Show when={!file()}>
          <span class="spacer" />
        </Show>
        <button class="link" onClick={() => setAbout(true)}>
          About
        </button>
      </header>

      <UpdatePrompt />
      <Show when={about()}>
        <AboutDialog onClose={() => setAbout(false)} />
      </Show>

      <Show when={error()}>
        <div class="error" role="alert">
          {error()}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      </Show>

      <div class="body">
        <Show when={file()}>
          <Sidebar currentPage={page()} onError={setError} />
        </Show>
        <main class="main">
          <Show
            when={file()}
            keyed
            fallback={
              <div class="empty">
                <p>Open a PDF to get started.</p>
                <button class="primary" onClick={() => fileInput.click()}>
                  Open PDF…
                </button>
                <p class="hint">or drop a file anywhere in this window</p>
                <p class="hint">Your file stays on this device. Nothing is uploaded.</p>
              </div>
            }
          >
            {(f) => (
              <Viewer pdf={f.pdf} zoom={zoom()} onZoom={zoomTo} onPageChange={setPage} api={(api) => (viewer = api)} />
            )}
          </Show>
          <Show when={loading()}>
            <div class="overlay">Opening…</div>
          </Show>
          <Show when={dragging()}>
            <div class="overlay drop">Drop to open</div>
          </Show>
        </main>
      </div>
      <Show when={file()}>
        <StatusBar onGoToPage={(n) => viewer?.goToPage(n)} />
      </Show>
    </div>
  );
}
