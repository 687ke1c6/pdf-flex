// Asks what to call the edited PDF before downloading it.
import { createSignal, onMount, Show, type JSX } from "solid-js";
import { cleanFileName, suggestedName } from "../common/download";

/** The Download button, in the top bar and in this dialog: the download icon and a label. */
export function DownloadButton(props: {
  label: JSX.Element;
  type?: "button" | "submit";
  title?: string;
  disabled?: boolean;
  onClick?(): void;
}) {
  return (
    <button
      type={props.type ?? "button"}
      class="primary download"
      title={props.title}
      disabled={props.disabled}
      onClick={() => props.onClick?.()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />
      </svg>
      <span class="label">{props.label}</span>
    </button>
  );
}

interface Props {
  /** The document's own file name. */
  name: string;
  /** `deleteDraft`: the user ticked the box to delete the document's draft once it's downloaded. */
  onDownload(filename: string, deleteDraft: boolean): void;
  onClose(): void;
}

export function DownloadDialog(props: Props) {
  let dialog!: HTMLDialogElement;
  let input!: HTMLInputElement;
  const suggestion = suggestedName(props.name);
  const [typed, setTyped] = createSignal(suggestion.name);
  const [deleteDraft, setDeleteDraft] = createSignal(false);
  const filename = () => cleanFileName(typed());

  onMount(() => {
    dialog.showModal();
    // Just the suffix is selected, so typing replaces it and keeps the name.
    input.focus();
    input.setSelectionRange(suggestion.suffixStart, suggestion.suffixEnd);
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const name = filename();
    if (!name) return;
    dialog.close();
    props.onDownload(name, deleteDraft());
  }

  return (
    <dialog ref={dialog} class="dialog download-dialog" onClose={() => props.onClose()}>
      <form onSubmit={submit}>
        <h2>Download PDF</h2>
        <label class="field">
          <span>File name</span>
          <input
            ref={input}
            type="text"
            value={typed()}
            spellcheck={false}
            autocomplete="off"
            onInput={(e) => setTyped(e.currentTarget.value)}
          />
        </label>
        <Show when={filename() && filename() !== typed().trim()}>
          <p class="hint">Saved as {filename()}</p>
        </Show>
        <label class="row">
          <input type="checkbox" checked={deleteDraft()} onChange={(e) => setDeleteDraft(e.currentTarget.checked)} />
          Delete the draft after downloading
        </label>
        <div class="dialog-actions">
          <button type="button" onClick={() => dialog.close()}>
            Cancel
          </button>
          <DownloadButton type="submit" label="Download" disabled={!filename()} />
        </div>
      </form>
    </dialog>
  );
}
