// What to insert at a gap between pages: a blank page, or a PDF (chosen or dropped).
// A PDF is read and checked here, so a refusal shows in the dialog and another can be tried.
import { createSignal, onMount, Show } from "solid-js";
import type { Source } from "../document/pages";

export type InsertChoice = { kind: "blank" } | { kind: "pdf"; source: Source };

interface Props {
  /** "Insert before page 3", "Insert at the end". */
  title: string;
  /** What the blank page will be like, e.g. "Same size as page 2". */
  blankNote: string;
  /** Reads a PDF file as a source; rejects with a user-facing message. */
  load(file: File): Promise<Source>;
  /** What was chosen, or null if cancelled. Called once. */
  onDone(choice: InsertChoice | null): void;
}

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

export function InsertDialog(props: Props) {
  let dialog!: HTMLDialogElement;
  let fileInput!: HTMLInputElement;
  let choice: InsertChoice | null = null;
  const [over, setOver] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  onMount(() => dialog.showModal());

  function choose(c: InsertChoice) {
    choice = c;
    dialog.close();
  }

  async function open(file: File | undefined) {
    if (!file || loading()) return;
    if (!isPdf(file)) return setError(`“${file.name}” doesn't look like a PDF.`);
    setError("");
    setLoading(true);
    try {
      choose({ kind: "pdf", source: await props.load(file) });
    } catch (err) {
      setError(`Couldn't add “${file.name}”: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      class="dialog insert-dialog"
      onClose={() => props.onDone(choice)}
      // Not while a PDF is being read: it has to land somewhere.
      onCancel={(e) => loading() && e.preventDefault()}
      // A PDF dropped anywhere on the dialog is taken, so a near miss doesn't make the browser open it.
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!dialog.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        void open(e.dataTransfer?.files[0]);
      }}
    >
      <h2>{props.title}</h2>
      <button class="insert-blank" disabled={loading()} onClick={() => choose({ kind: "blank" })}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 2.5h8l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4a1.5 1.5 0 0 1 1-1.5z" />
          <path d="M14 2.5V7.5h5" />
        </svg>
        <span>
          <strong>Blank page</strong>
          <span class="hint">{props.blankNote}</span>
        </span>
      </button>
      <div class="drop-zone insert-drop" classList={{ over: over() }} onClick={() => fileInput.click()}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
        </svg>
        <span class="drop-label">{loading() ? "Opening…" : over() ? "Drop to insert" : "Drop a PDF here"}</span>
        <button type="button" disabled={loading()}>
          Choose a PDF…
        </button>
      </div>
      <Show when={error()}>
        <p class="dialog-error" role="alert">
          {error()}
        </p>
      </Show>
      <div class="dialog-actions">
        <button disabled={loading()} onClick={() => dialog.close()}>
          Cancel
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          void open(file);
        }}
      />
    </dialog>
  );
}
