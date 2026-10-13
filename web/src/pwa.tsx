// Installable-app support: service worker registration, the update prompt, and the About dialog.
import { createSignal, onMount, Show } from "solid-js";
import { registerSW } from "virtual:pwa-register";
import { draftsEnabled, setDraftsEnabled } from "./autosave";
import { draftStore } from "./draftStore";

/**
 * Registers the service worker. A new version is never activated under the
 * user (they may be mid-edit): it waits until they choose to reload.
 */
export function UpdatePrompt() {
  const [needsReload, setNeedsReload] = createSignal(false);
  let update: ((reload?: boolean) => Promise<void>) | undefined;
  onMount(() => {
    // Dev serves no service worker; registering would only log errors.
    if (import.meta.env.DEV) return;
    update = registerSW({ onNeedRefresh: () => setNeedsReload(true) });
  });
  return (
    <Show when={needsReload()}>
      <div class="update" role="status">
        A new version is available.
        <button class="primary" onClick={() => void update?.(true)}>
          Reload
        </button>
        <button onClick={() => setNeedsReload(false)}>Later</button>
      </div>
    </Show>
  );
}

export function AboutDialog(props: { onClose(): void; onDraftsDeleted(): void }) {
  let dialog!: HTMLDialogElement;
  onMount(() => dialog.showModal());
  const [deleted, setDeleted] = createSignal(false);

  async function deleteAllDrafts() {
    if (!confirm("Delete every draft kept in this browser? This can't be undone.")) return;
    await draftStore.clear();
    props.onDraftsDeleted();
    setDeleted(true);
  }

  return (
    <dialog ref={dialog} class="dialog" onClose={() => props.onClose()}>
      <h2>About pdf-flex</h2>
      <p>
        Sign PDFs and add to them in your browser. Your PDFs and signatures stay on this device: opening, editing and saving all happen
        here, and nothing is uploaded. Once loaded, the app also works offline and can be installed.
      </p>
      <h3>Drafts</h3>
      <p class="hint">
        Your work on each document is saved as a draft in this browser as you go, so a closed tab or a crash doesn't lose it. Drafts stay on
        this device, including the PDFs, until you discard them.
      </p>
      <label class="row">
        <input type="checkbox" checked={draftsEnabled()} onChange={(e) => setDraftsEnabled(e.currentTarget.checked)} />
        Keep drafts of my work in this browser
      </label>
      <div class="row">
        <button onClick={deleteAllDrafts} disabled={deleted()}>
          {deleted() ? "All drafts deleted" : "Delete all drafts"}
        </button>
      </div>
      <p>
        <a href={`${import.meta.env.BASE_URL}licenses.txt`} target="_blank" rel="noopener">
          Third-party licences
        </a>
      </p>
      <div class="dialog-actions">
        <button class="primary" onClick={() => dialog.close()}>
          Close
        </button>
      </div>
    </dialog>
  );
}
