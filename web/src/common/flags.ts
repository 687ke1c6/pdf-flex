// Feature flags: unfinished features, hidden until turned on in Settings →
// Experimental. Remembered in this browser.
import { createSignal } from "solid-js";

export type Flag = "pages";

/** Every flag, with its label in Settings. */
export const FLAGS: Record<Flag, string> = {
  pages: "Page tools: insert pages from other PDFs, add blank pages, delete pages",
};

const KEY = "pdf-flex:flags";

/** The known flags in a comma-separated list; unknown ones are ignored. */
export const parseFlags = (list: string): Flag[] => {
  const names = list.split(",").map((s) => s.trim());
  return (Object.keys(FLAGS) as Flag[]).filter((f) => names.includes(f));
};

function load(): Flag[] {
  try {
    return parseFlags(localStorage.getItem(KEY) ?? "");
  } catch {
    // Storage may be unavailable (private mode, blocked).
    return [];
  }
}

const [enabled, setEnabled] = createSignal<Flag[]>(load());

/** Whether a flag is on. Reactive. */
export const flag = (name: Flag) => enabled().includes(name);

export function setFlag(name: Flag, on: boolean) {
  const next = (Object.keys(FLAGS) as Flag[]).filter((f) => (f === name ? on : flag(f)));
  setEnabled(next);
  try {
    localStorage.setItem(KEY, next.join(","));
  } catch {
    // Not remembered; the flag lasts until the page is reloaded.
  }
}
