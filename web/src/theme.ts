// Dark mode (Settings): a data-theme attribute on <html> that switches the colour variables in styles.css.
// index.html applies the saved choice before the first paint, so a dark start screen doesn't flash white.
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

export function setDarkMode(on: boolean) {
  setDarkModeSignal(on);
  document.documentElement.dataset.theme = on ? "dark" : "light";
  try {
    localStorage.setItem(DARK_MODE_KEY, on ? "on" : "off");
  } catch {
    // Not remembered; the choice still applies for this session.
  }
}
