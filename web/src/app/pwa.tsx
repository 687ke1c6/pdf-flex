// Installable-app support: service worker registration and the update prompt.
import { createSignal, onMount, Show } from "solid-js";
import { registerSW } from "virtual:pwa-register";

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
