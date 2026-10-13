// Drafts kept in this browser, listed on the empty screen to pick up where you left off.
import { createResource, For, Show } from "solid-js";
import { draftStore, formatSavedAt, formatSize, type DraftSummary } from "./draftStore";

interface Props {
  onOpen(draft: DraftSummary): void;
  onError(message: string): void;
}

export function RecentDrafts(props: Props) {
  const [drafts, { refetch }] = createResource(() =>
    draftStore.list().catch((err) => {
      props.onError(`Couldn't read saved drafts: ${err instanceof Error ? err.message : err}`);
      return [] as DraftSummary[];
    }),
  );

  async function discard(draft: DraftSummary) {
    if (!confirm(`Discard your work on ${draft.name}? This can't be undone.`)) return;
    await draftStore.remove(draft.id);
    await refetch();
  }

  return (
    <Show when={drafts()?.length}>
      <section class="recent">
        <h2>Continue where you left off</h2>
        <ul>
          <For each={drafts()}>
            {(draft) => (
              <li>
                <button class="recent-open" onClick={() => props.onOpen(draft)}>
                  <span class="recent-name">{draft.name}</span>
                  <span class="recent-meta">
                    {draft.items} {draft.items === 1 ? "item" : "items"} · {draft.pageCount} {draft.pageCount === 1 ? "page" : "pages"} ·{" "}
                    {formatSize(draft.size)} · saved {formatSavedAt(draft.savedAt)}
                  </span>
                </button>
                <button class="icon" title="Discard this draft" aria-label={`Discard draft of ${draft.name}`} onClick={() => discard(draft)}>
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
        <p class="hint">Drafts are kept in this browser on this device until you discard them.</p>
      </section>
    </Show>
  );
}
