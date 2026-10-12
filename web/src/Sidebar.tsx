import { For, Show } from "solid-js";
import { SIGNATURE_DRAG_TYPE, useEditor } from "./editor";

interface Props {
  currentPage: number;
  saving: boolean;
  onSave(): void;
  onGoToPage(page: number): void;
  onError(message: string): void;
}

export function Sidebar(props: Props) {
  const editor = useEditor();
  let input!: HTMLInputElement;

  async function onPick(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    try {
      await editor.loadSignature(file);
    } catch {
      props.onError(`Couldn't read ${file.name} as an image. Use a PNG or JPEG.`);
    }
  }

  return (
    <aside class="sidebar">
      <section>
        <h2>Signature</h2>
        <input ref={input} type="file" accept="image/png,image/jpeg" hidden onChange={onPick} />
        <Show
          when={editor.signature()}
          fallback={
            <>
              <button class="primary block" onClick={() => input.click()}>
                Load signature…
              </button>
              <p class="hint">A PNG with a transparent background looks best.</p>
            </>
          }
        >
          {(sig) => (
            <>
              <img
                class="signature-thumb"
                src={sig().url}
                alt={`Signature: ${sig().name}`}
                title="Drag onto a page"
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer!.setData(SIGNATURE_DRAG_TYPE, "1");
                  e.dataTransfer!.effectAllowed = "copy";
                }}
              />
              <p class="hint">Drag onto a page, or:</p>
              <button class="block" onClick={() => editor.add(props.currentPage)}>
                Place on page {props.currentPage}
              </button>
              <button class="link" onClick={() => input.click()}>
                Replace image…
              </button>
            </>
          )}
        </Show>
      </section>

      <section class="grow">
        <h2>Placed ({editor.placements.length})</h2>
        <Show when={editor.placements.length} fallback={<p class="hint">Nothing placed yet.</p>}>
          <ul class="placements">
            <For each={editor.placements}>
              {(p, i) => (
                <li classList={{ selected: editor.selected() === p.id }}>
                  <button
                    class="link"
                    onClick={() => {
                      editor.select(p.id);
                      props.onGoToPage(p.page);
                    }}
                  >
                    #{i() + 1} on page {p.page}
                  </button>
                  <button class="icon" title="Remove" onClick={() => editor.remove(p.id)}>
                    ×
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <section>
        <button
          class="primary block"
          disabled={!editor.signature() || !editor.placements.length || props.saving}
          onClick={() => props.onSave()}
        >
          {props.saving ? "Saving…" : "Download signed PDF"}
        </button>
        <p class="hint">The original file is not changed.</p>
      </section>
    </aside>
  );
}
