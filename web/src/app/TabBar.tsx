// The row of tabs above the top bar: one per open document, and + for a new one.
import { createEffect, For, Show } from "solid-js";
import { tabName, type Tab } from "./tabs";

interface Props {
  tabs: Tab[];
  activeKey: number;
  /** Off while there's already an empty tab (there's only ever one). */
  canAdd: boolean;
  onSelect(key: number): void;
  onClose(key: number): void;
  onNew(): void;
}

export function TabBar(props: Props) {
  let row!: HTMLDivElement;

  // Keep the active tab in view when there are more than fit.
  createEffect(() => {
    const key = props.activeKey;
    queueMicrotask(() => row.querySelector<HTMLElement>(`[data-tab="${key}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  });

  return (
    <nav class="tab-bar" aria-label="Open documents">
      <div class="tabs-row" role="tablist" ref={row}>
        <For each={props.tabs}>
          {(tab, i) => {
            const active = () => tab.key === props.activeKey;
            const risk = () => tab.session?.atRisk() ?? false;
            return (
              <div
                class="tab"
                classList={{ active: active(), empty: !tab.session && !tab.pending }}
                role="tab"
                aria-selected={active()}
                tabIndex={active() ? 0 : -1}
                data-tab={tab.key}
                title={`${tabName(tab)}${i() < 9 ? ` (Alt+${i() + 1})` : ""}`}
                onClick={() => props.onSelect(tab.key)}
                // Middle click closes, as in a browser.
                onAuxClick={(e) => e.button === 1 && props.onClose(tab.key)}
                onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && props.onSelect(tab.key)}
              >
                <span class="tab-name">{tabName(tab)}</span>
                <Show when={risk()}>
                  <span class="tab-dot" title="Not saved yet" aria-label="Not saved yet" />
                </Show>
                <button
                  class="tab-close"
                  title="Close tab"
                  aria-label={`Close ${tabName(tab)}`}
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onClose(tab.key);
                  }}
                >
                  ×
                </button>
              </div>
            );
          }}
        </For>
      </div>
      <button
        class="tab-new"
        title={props.canAdd ? "New tab" : "There's already a new tab"}
        aria-label="New tab"
        disabled={!props.canAdd}
        onClick={() => props.onNew()}
      >
        +
      </button>
    </nav>
  );
}
