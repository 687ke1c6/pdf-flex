// Dark mode (Settings): a data-theme attribute on <html> that switches the colour variables in styles.css.
// public/theme.js applies the saved choice before the first paint, so a dark start screen doesn't flash white;
// it's applied here too, so the app is right even if that script didn't run.
import { createSignal } from "solid-js";

const DARK_MODE_KEY = "pdf-flex:dark-mode";

function loadDarkMode(): boolean {
  try {
    return localStorage.getItem(DARK_MODE_KEY) === "on";
  } catch {
    return false;
  }
}

/** Whether the app is dark. Off unless turned on. */
export const [darkMode, setDarkModeSignal] = createSignal(loadDarkMode());
document.documentElement.dataset.theme = darkMode() ? "dark" : "light";

export function setDarkMode(on: boolean) {
  setDarkModeSignal(on);
  document.documentElement.dataset.theme = on ? "dark" : "light";
  try {
    localStorage.setItem(DARK_MODE_KEY, on ? "on" : "off");
  } catch {
    // Not remembered; the choice still applies for this session.
  }
}
