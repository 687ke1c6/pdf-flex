import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { download, signedName } from "./download";
import { SIGNATURE_DRAG_TYPE, useEditor } from "./editor";
import { openPdf, type LoadedPdf } from "./pdf";
import { Sidebar } from "./Sidebar";
import { stampPdf } from "./stamper";
import { clampZoom, stepZoom } from "./zoom";
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
  let viewer: ViewerApi | undefined;
  let fileInput!: HTMLInputElement;

  async function open(name: string, bytes: Uint8Array) {
    setError("");
    setLoading(true);
    try {
      const pdf = await openPdf(bytes);
      await file()?.pdf.close();
      setPage(1);
      editor.reset(pdf.pages);
      setFile({ name, bytes, pdf });
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

  const zoomTo = (z: number) => setZoom(clampZoom(z));

  // Drag and drop anywhere in the window.
  // Chrome also reports "Files" when an <img> is dragged, so exclude our own signature drag.
  const isFileDrag = (e: DragEvent) => {
    const types = e.dataTransfer?.types ?? [];
    return types.includes("Files") && !types.includes(SIGNATURE_DRAG_TYPE);
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
    const sig = editor.signature();
    if (!f || !sig || !editor.placements.length) return;
    setError("");
    setSaving(true);
    try {
      download(await stampPdf(f.bytes, sig.bytes, editor.placements), signedName(f.name));
    } catch (err) {
      setError(`Couldn't save: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    // Delete / Escape act on the selected placement.
    const selected = editor.selected();
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
    onCleanup(() => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("drop", endDrag, { capture: true });
      window.removeEventListener("keydown", onKeyDown);
    });
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
            <For each={samples()}>{(s) => <option value={s}>{s}</option>}</For>
          </select>
        </Show>

        <Show when={file()}>
          {(f) => (
            <>
              <span class="name" title={f().name}>
                {f().name}
              </span>
              <span class="spacer" />
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
      </header>

      <Show when={error()}>
        <div class="error" role="alert">
          {error()}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      </Show>

      <div class="body">
        <Show when={file()}>
          <Sidebar
            currentPage={page()}
            saving={saving()}
            onSave={save}
            onGoToPage={(n) => viewer?.goToPage(n)}
            onError={setError}
          />
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
    </div>
  );
}
