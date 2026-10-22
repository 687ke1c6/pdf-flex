// Settings: everything about the app itself rather than a document. Opened
// from the status bar. One section per topic, so more can be added.
import { For, onMount, Show } from "solid-js";
import { flag, FLAGS, setFlag, type Flag } from "../common/flags";
import { confirmDiscard, draftsEnabled, setConfirmDiscard, setDraftsEnabled } from "../drafts/autosave";
import { tabsMode } from "./tabs";
import { darkMode, setDarkMode } from "./theme";

/** The cog wheel, for the Settings button. */
export const CogIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" class="cog">
    <path d="M10.3 3.2h3.4l.5 2.4 1.6.9 2.3-.8 1.7 2.9-1.8 1.6v1.8l1.8 1.6-1.7 2.9-2.3-.8-1.6.9-.5 2.4h-3.4l-.5-2.4-1.6-.9-2.3.8-1.7-2.9 1.8-1.6v-1.8L4.2 8.6l1.7-2.9 2.3.8 1.6-.9z" />
    <circle cx="12" cy="12" r="2.8" />
  </svg>
);

const SunIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" class="sun">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </svg>
);

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" class="moon">
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>
);

export function SettingsDialog(props: {
  onClose(): void;
  /** Turns tab mode on or off; resolves to whether it changed (turning off can be cancelled). */
  onTabsMode(on: boolean): Promise<boolean>;
}) {
  let dialog!: HTMLDialogElement;
  onMount(() => dialog.showModal());

  // A click on the backdrop closes it. Clicks there land on the dialog itself, so it's told apart by
  // position; the press has to start outside too, so selecting text and letting go outside doesn't close it.
  const outside = (e: MouseEvent) => {
    if (e.target !== dialog) return false;
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let downOutside = false;

  return (
    <dialog
      ref={dialog}
      class="dialog settings"
      onClose={() => props.onClose()}
      onPointerDown={(e) => (downOutside = outside(e))}
      onClick={(e) => {
        if (downOutside && outside(e)) dialog.close();
      }}
    >
      <h2>Settings</h2>

      <section>
        <h3>Appearance</h3>
        <label class="row">
          {/* A sun/moon switch: the knob slides over to the theme in use and shows its icon. */}
          <button type="button" role="switch" class="theme-switch" aria-checked={darkMode()} onClick={() => setDarkMode(!darkMode())}>
            <SunIcon />
            <MoonIcon />
            <span class="theme-knob">{darkMode() ? <MoonIcon /> : <SunIcon />}</span>
          </button>
          Dark mode
        </label>
      </section>

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
        <label class="row">
          <input type="checkbox" checked={confirmDiscard()} onChange={(e) => setConfirmDiscard(e.currentTarget.checked)} />
          Ask before discarding a draft
        </label>
      </section>

      <Show when={Object.keys(FLAGS).length}>
        <section>
          <h3>Experimental</h3>
          <p class="hint">Unfinished features, for trying out. They may change or go away.</p>
          <For each={Object.keys(FLAGS) as Flag[]}>
            {(name) => (
              <label class="row">
                <input type="checkbox" checked={flag(name)} onChange={(e) => setFlag(name, e.currentTarget.checked)} />
                {FLAGS[name]}
              </label>
            )}
          </For>
        </section>
      </Show>

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
