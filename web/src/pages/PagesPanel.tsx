// The Pages tool (behind the "pages" feature flag): insert pages from other PDFs,
// add blank pages, delete pages. Being built in the spike; see docs/pages-plan.md.
import { createSignal } from "solid-js";
import { useEditor } from "../document/editor";
import { sourceFrom } from "./source";

export function PagesPanel(props: { onError(message: string): void }) {
  const editor = useEditor();
  const [busy, setBusy] = createSignal(false);
  let fileInput!: HTMLInputElement;

  /** Adds every page of a PDF at the end of the document. Scaffolding until the panel's own insert (chunk 5). */
  async function append(file: File) {
    setBusy(true);
    try {
      const source = editor.addSource(await sourceFrom(file, editor.doc().sources));
      editor.insertPages(
        editor.slots().length,
        source.pdf.pages.map(({ width, height }, index) => ({ source: source.id, index, width, height })),
      );
    } catch (err) {
      props.onError(`Couldn't add “${file.name}”: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="pages-panel">
      <h2>Pages</h2>
      <p class="hint">Experimental. Inserting pages from other PDFs, adding blank pages and deleting pages will appear here.</p>
      <button disabled={busy()} onClick={() => fileInput.click()}>
        {busy() ? "Adding…" : "Append PDF…"}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) void append(file);
        }}
      />
    </section>
  );
}
