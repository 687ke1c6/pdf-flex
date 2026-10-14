// The Signatures tool: the signature library and making new signatures. Placing is by dragging or clicking on a page.
import { createSignal, For, Show } from "solid-js";
import { download } from "../common/download";
import { SIGNATURE_DRAG_TYPE, useEditor, type Signature } from "../document/editor";

interface Props {
  onError(message: string): void;
}

export function SignaturesPanel(props: Props) {
  const editor = useEditor();
  let libraryInput!: HTMLInputElement;

  async function exportLibrary() {
    const json = await editor.exportLibrary();
    download(new TextEncoder().encode(json), "pdf-flex-signatures.json", "application/json");
  }

  async function importLibrary(file: File) {
    try {
      await editor.importLibrary(await file.text());
    } catch (err) {
      props.onError(`Couldn't import ${file.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return (
    <>
      <section>
        <h2>Signatures</h2>
        <p class="panel-link">
          <button class="link" onClick={() => editor.setCreatingSignature(true)}>
            New signature
          </button>
        </p>
        <Show when={editor.library.length} fallback={<p class="hint">No saved signatures yet.</p>}>
          <ul class="library">
            <For each={editor.library}>{(sig) => <LibraryItem sig={sig} onError={props.onError} />}</For>
          </ul>
        </Show>
        <div class="library-file">
          <button class="link" disabled={!editor.library.length} onClick={exportLibrary}>
            Export library
          </button>
          <span>·</span>
          <button class="link" onClick={() => libraryInput.click()}>
            Import library
          </button>
          <input
            ref={libraryInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file) void importLibrary(file);
            }}
          />
        </div>
      </section>

    </>
  );
}

function LibraryItem(props: { sig: Signature; onError(message: string): void }) {
  const editor = useEditor();
  const [renaming, setRenaming] = createSignal(false);
  const inUse = () => editor.isInUse(props.sig.id);

  // Removing the input fires blur, so Escape marks the edit cancelled before closing it.
  let cancelled = false;
  function startRename() {
    cancelled = false;
    setRenaming(true);
  }
  async function finishRename(input: HTMLInputElement) {
    setRenaming(false);
    if (!cancelled) await editor.renameSignature(props.sig.id, input.value);
  }

  return (
    <li classList={{ active: editor.active()?.id === props.sig.id }}>
      <img
        class="checkerboard"
        src={props.sig.url}
        alt={props.sig.name}
        title="Click to select, drag onto a page to place"
        draggable={true}
        onClick={() => editor.setActive(props.sig.id)}
        onDragStart={(e) => {
          editor.setActive(props.sig.id);
          e.dataTransfer!.setData(SIGNATURE_DRAG_TYPE, props.sig.id);
          e.dataTransfer!.effectAllowed = "copy";
        }}
      />
      <div class="library-meta">
        <Show
          when={renaming()}
          fallback={
            <span class="library-name" title={props.sig.name}>
              {props.sig.name}
            </span>
          }
        >
          <input
            type="text"
            value={props.sig.name}
            ref={(el) => queueMicrotask(() => el.select())}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                cancelled = true;
                setRenaming(false);
              }
            }}
            onBlur={(e) => void finishRename(e.currentTarget)}
          />
        </Show>
        <button class="icon" title="Rename" onClick={startRename}>
          ✎
        </button>
        <button
          class="icon"
          title={inUse() ? "Placed in this document; remove those placements first" : "Delete from library"}
          disabled={inUse()}
          onClick={async () => {
            if (!(await editor.deleteSignature(props.sig.id))) props.onError("Couldn't delete that signature.");
          }}
        >
          ×
        </button>
      </div>
    </li>
  );
}
