// Installable-app support: service worker registration, the update prompt, and the About dialog.
import { createSignal, onMount, Show } from "solid-js";
import { registerSW } from "virtual:pwa-register";

/**
 * Registers the service worker. A new version is never activated under the
 * user (they may be mid-signing): it waits until they choose to reload.
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

export function AboutDialog(props: { onClose(): void }) {
  let dialog!: HTMLDialogElement;
  onMount(() => dialog.showModal());
  return (
    <dialog ref={dialog} class="dialog" onClose={() => props.onClose()}>
      <h2>About pdf-flex</h2>
      <p>
        Sign PDFs in your browser. Your PDFs and signatures stay on this device: opening, signing and saving all happen
        here, and nothing is uploaded. Once loaded, the app also works offline and can be installed.
      </p>
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
