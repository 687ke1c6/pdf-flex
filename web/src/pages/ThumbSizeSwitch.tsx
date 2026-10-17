// Thumbnail size, Small or Large: one setting for the Pages panel and the page range
// dialog, remembered in this browser. Thumbnails render at the large size either way.
import { createSignal } from "solid-js";

const KEY = "pdf-flex:thumb-size";

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === "small";
  } catch {
    return false;
  }
}

const [small, setSmallSignal] = createSignal(load());
/** Whether thumbnails are small (about 30% smaller). Reactive. */
export const thumbsSmall = small;

function setSmall(on: boolean) {
  setSmallSignal(on);
  try {
    localStorage.setItem(KEY, on ? "small" : "large");
  } catch {
    // Not remembered; the size still applies for now.
  }
}

/** A magnifier with a minus or a plus. */
const Magnifier = (props: { plus?: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="7" cy="7" r="4.5" />
    <path d={props.plus ? "M14 14l-3.8-3.8M5 7h4M7 5v4" : "M14 14l-3.8-3.8M5 7h4"} />
  </svg>
);

export function ThumbSizeSwitch() {
  return (
    <div class="segmented thumb-size" role="group" aria-label="Thumbnail size">
      <button type="button" title="Small thumbnails" aria-label="Small thumbnails" aria-pressed={small()} classList={{ active: small() }} onClick={() => setSmall(true)}>
        <Magnifier />
      </button>
      <button type="button" title="Large thumbnails" aria-label="Large thumbnails" aria-pressed={!small()} classList={{ active: !small() }} onClick={() => setSmall(false)}>
        <Magnifier plus />
      </button>
    </div>
  );
}
