// Drafts kept in this browser, listed on the empty screen to pick up where you left off.
import { createResource, For, Show } from "solid-js";
import { askConfirm } from "./ConfirmDialog";
import { draftStore, formatSavedAt, formatSize, type DraftSummary } from "./draftStore";

interface Props {
  /** Documents already open in a tab: shown as such, and clicking one switches to it. */
  openIds: string[];
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
    const ok = await askConfirm({
      title: "Discard draft?",
      message: `Your work on ${draft.name} will be deleted from this browser. This can't be undone.`,
      confirm: "Discard",
      danger: true,
    });
    if (!ok) return;
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
                  <span class="recent-name">
                    {draft.name}
                    <Show when={props.openIds.includes(draft.id)}>
                      <span class="recent-badge">open in a tab</span>
                    </Show>
                  </span>
                  <span class="recent-meta">
                    {draft.items} {draft.items === 1 ? "item" : "items"} · {draft.pageCount} {draft.pageCount === 1 ? "page" : "pages"} ·{" "}
                    {formatSize(draft.size)} · saved {formatSavedAt(draft.savedAt)}
                  </span>
                </button>
                <button
                  class="icon"
                  title={props.openIds.includes(draft.id) ? "Close its tab first" : "Discard this draft"}
                  aria-label={`Discard draft of ${draft.name}`}
                  disabled={props.openIds.includes(draft.id)}
                  onClick={() => discard(draft)}
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}
