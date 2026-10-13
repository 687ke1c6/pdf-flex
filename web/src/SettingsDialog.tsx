// Settings: everything about the app itself rather than a document. Opened
// from the status bar. One section per topic, so more can be added.
import { createSignal, onMount } from "solid-js";
import { draftsEnabled, setDraftsEnabled } from "./autosave";
import { draftStore } from "./draftStore";
import { tabsMode } from "./tabs";

/** The cog wheel, for the Settings button. */
export const CogIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" class="cog">
    <path d="M10.3 3.2h3.4l.5 2.4 1.6.9 2.3-.8 1.7 2.9-1.8 1.6v1.8l1.8 1.6-1.7 2.9-2.3-.8-1.6.9-.5 2.4h-3.4l-.5-2.4-1.6-.9-2.3.8-1.7-2.9 1.8-1.6v-1.8L4.2 8.6l1.7-2.9 2.3.8 1.6-.9z" />
    <circle cx="12" cy="12" r="2.8" />
  </svg>
);

export function SettingsDialog(props: {
  onClose(): void;
  onDraftsDeleted(): void;
  /** Turns tab mode on or off; resolves to whether it changed (turning off can be cancelled). */
  onTabsMode(on: boolean): Promise<boolean>;
}) {
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
    <dialog ref={dialog} class="dialog settings" onClose={() => props.onClose()}>
      <h2>Settings</h2>

      <section>
        <h3>Tabs</h3>
        <p class="hint">
          With tabs, several documents can be open at once, each in its own tab. Without, there's one document at a time, and opening another
          takes its place (its draft is kept).
        </p>
        <label class="row">
          <input
            type="checkbox"
            checked={tabsMode()}
            onChange={async (e) => {
              const box = e.currentTarget;
              const changed = await props.onTabsMode(box.checked);
              if (!changed) box.checked = tabsMode();
            }}
          />
          Open documents in tabs
        </label>
      </section>

      <section>
        <h3>Drafts</h3>
        <p class="hint">
          Your work on each document is saved as a draft in this browser as you go, so a closed tab or a crash doesn't lose it. Drafts stay
          on this device, including the PDFs, until you discard them.
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
      </section>

      <section>
        <h3>About pdf-flex</h3>
        <p class="hint">
          Sign PDFs and add to them in your browser. Your PDFs and signatures stay on this device: opening, editing and saving all happen
          here, and nothing is uploaded. Once loaded, the app also works offline and can be installed.
        </p>
        <p class="hint">
          <a href={`${import.meta.env.BASE_URL}licenses.txt`} target="_blank" rel="noopener">
            Third-party licences
          </a>
        </p>
      </section>

      <div class="dialog-actions">
        <button class="primary" onClick={() => dialog.close()}>
          Close
        </button>
      </div>
    </dialog>
  );
}
