import { createEffect, createSignal, For, on, onCleanup, onMount } from "solid-js";
import { PageView } from "./PageView";
import type { LoadedPdf } from "./pdf";
import { clampZoom, CSS_PX_PER_PT, fitWidthZoom } from "./zoom";

/** Delay before re-rendering at a new zoom; layout updates immediately. */
const RENDER_DEBOUNCE_MS = 150;
/** Horizontal padding around pages, in CSS px. Keep in sync with `.pages` in styles.css. */
const PAGE_PADDING = 24;

export interface ViewerApi {
  goToPage(page: number): void;
  fitWidth(): void;
}

interface Props {
  pdf: LoadedPdf;
  zoom: number;
  onZoom(zoom: number): void;
  onPageChange(page: number): void;
  api(api: ViewerApi): void;
}

/** A point in the document to hold still across a zoom: page, fraction within it, and where it sits on screen. */
interface Anchor {
  index: number;
  fx: number;
  fy: number;
  viewX: number;
  viewY: number;
}

export function Viewer(props: Props) {
  let scroller!: HTMLDivElement;
  let pagesEl!: HTMLDivElement;
  const pageEls: HTMLDivElement[] = [];

  const scale = () => props.zoom * CSS_PX_PER_PT;
  const [renderScale, setRenderScale] = createSignal(scale());
  const [active, setActive] = createSignal(new Set<number>(), { equals: false });
  const [dprTick, setDprTick] = createSignal(0);
  let anchor: Anchor | undefined;

  // Debounce re-rendering while the zoom is changing.
  createEffect(
    on(
      scale,
      (s) => {
        const timer = setTimeout(() => setRenderScale(s), RENDER_DEBOUNCE_MS);
        onCleanup(() => clearTimeout(timer));
      },
      { defer: true },
    ),
  );

  /** Finds the page under a point in the viewport (scroller-relative CSS px). */
  function anchorAt(viewX: number, viewY: number): Anchor | undefined {
    const y = scroller.scrollTop + viewY;
    const index = pageEls.findIndex((el) => el.offsetTop + el.offsetHeight + PAGE_PADDING / 2 > y);
    if (index < 0) return undefined;
    const el = pageEls[index];
    return {
      index,
      fy: (y - el.offsetTop) / el.offsetHeight,
      fx: (scroller.scrollLeft + viewX) / pagesEl.offsetWidth,
      viewX,
      viewY,
    };
  }

  const centerAnchor = () => anchorAt(scroller.clientWidth / 2, scroller.clientHeight / 2);

  // After a zoom has been laid out, scroll so the anchored point is back where it was.
  createEffect(
    on(
      scale,
      () => {
        if (!anchor) return;
        const el = pageEls[anchor.index];
        scroller.scrollTop = el.offsetTop + anchor.fy * el.offsetHeight - anchor.viewY;
        scroller.scrollLeft = anchor.fx * pagesEl.offsetWidth - anchor.viewX;
      },
      { defer: true },
    ),
  );

  function onScroll() {
    anchor = centerAnchor();
    if (anchor) props.onPageChange(anchor.index + 1);
  }

  // Ctrl/Cmd + wheel (and trackpad pinch, which Chrome reports as ctrl+wheel) zooms around the cursor.
  function onWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const rect = scroller.getBoundingClientRect();
    anchor = anchorAt(e.clientX - rect.left, e.clientY - rect.top);
    props.onZoom(clampZoom(props.zoom * Math.exp(-e.deltaY * 0.002)));
  }

  function fitWidth() {
    anchor = centerAnchor();
    const widest = Math.max(...props.pdf.pages.map((p) => p.width));
    props.onZoom(fitWidthZoom(scroller.clientWidth - 2 * PAGE_PADDING, widest));
  }

  onMount(() => {
    // Render only pages within about a screen of the viewport.
    const observer = new IntersectionObserver(
      (entries) => {
        const next = active();
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.page) - 1;
          if (entry.isIntersecting) next.add(index);
          else next.delete(index);
        }
        setActive(next);
      },
      { root: scroller, rootMargin: "100% 0px" },
    );
    pageEls.forEach((el) => observer.observe(el));

    // Re-render when devicePixelRatio changes, e.g. the window moves to another monitor.
    let media: MediaQueryList | undefined;
    const watchDpr = () => {
      media?.removeEventListener("change", onDprChange);
      media = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      media.addEventListener("change", onDprChange);
    };
    const onDprChange = () => {
      setDprTick((t) => t + 1);
      watchDpr();
    };
    watchDpr();

    scroller.addEventListener("wheel", onWheel, { passive: false });
    onCleanup(() => {
      observer.disconnect();
      media?.removeEventListener("change", onDprChange);
      scroller.removeEventListener("wheel", onWheel);
    });

    props.api({
      goToPage(page) {
        pageEls[page - 1]?.scrollIntoView({ block: "start" });
      },
      fitWidth,
    });
    // Every document opens at actual size (100%), whatever the previous one was zoomed to.
    props.onZoom(1);
  });

  return (
    <div class="scroller" ref={scroller} onScroll={onScroll}>
      <div class="pages" ref={pagesEl}>
        <For each={props.pdf.pages}>
          {(size, i) => (
            <PageView
              doc={props.pdf.doc}
              pageNumber={i() + 1}
              size={size}
              scale={scale()}
              renderScale={renderScale()}
              active={active().has(i())}
              dprTick={dprTick()}
              ref={(el) => (pageEls[i()] = el)}
            />
          )}
        </For>
      </div>
    </div>
  );
}
