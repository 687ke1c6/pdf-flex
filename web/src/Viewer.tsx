import { createEffect, createSignal, For, on, onCleanup, onMount } from "solid-js";
import { useEditor } from "./editor";
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

/** Where a document was scrolled to, in CSS px at its zoom. */
export interface ScrollPosition {
  top: number;
  left: number;
}

interface Props {
  pdf: LoadedPdf;
  zoom: number;
  onZoom(zoom: number): void;
  onPageChange(page: number): void;
  api(api: ViewerApi): void;
  /** Coming back to a document (e.g. switching tabs): where it was left, at its current zoom. */
  scroll?: ScrollPosition;
  /** Called when the viewer goes away, with where it was scrolled to. */
  onLeave?(scroll: ScrollPosition): void;
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
  const editor = useEditor();
  let scroller!: HTMLDivElement;
  let pagesEl!: HTMLDivElement;
  const pageEls: HTMLDivElement[] = [];

  const scale = () => props.zoom * CSS_PX_PER_PT;
  const [renderScale, setRenderScale] = createSignal(scale());
  const [active, setActive] = createSignal(new Set<number>(), { equals: false });
  const [dprTick, setDprTick] = createSignal(0);
  /** Space is held: dragging pans instead of acting on the page. */
  const [spaceHeld, setSpaceHeld] = createSignal(false);
  /** Dragging pans: Space is held, or the Hand tool is active. */
  const panReady = () => spaceHeld() || editor.tool() === "hand";
  const [panning, setPanning] = createSignal(false);
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

  /**
   * Two-finger pinch zooms the document around the point between the fingers, which also pans as
   * they move. The page itself can't be pinch-zoomed (touch-action on <html>), so this is the only zoom.
   */
  let pinch: { distance: number; zoom: number; anchor: Anchor } | undefined;
  const touchesAt = (e: TouchEvent) => {
    const [a, b] = [e.touches[0], e.touches[1]];
    const rect = scroller.getBoundingClientRect();
    return {
      distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      x: (a.clientX + b.clientX) / 2 - rect.left,
      y: (a.clientY + b.clientY) / 2 - rect.top,
    };
  };

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 2) return;
    const at = touchesAt(e);
    const start = anchorAt(at.x, at.y);
    pinch = start && at.distance > 0 ? { distance: at.distance, zoom: props.zoom, anchor: start } : undefined;
  }

  function onTouchMove(e: TouchEvent) {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const at = touchesAt(e);
    anchor = { ...pinch.anchor, viewX: at.x, viewY: at.y };
    props.onZoom(clampZoom(pinch.zoom * (at.distance / pinch.distance)));
  }

  function onTouchEnd(e: TouchEvent) {
    if (e.touches.length < 2) pinch = undefined;
  }

  // Older Safari pinch-zooms the page through its own gesture events, whatever touch-action says.
  const onGesture = (e: Event) => e.preventDefault();

  /** Whether a key press belongs to a text field or a dialog rather than the document. */
  const typingOrDialog = (e: KeyboardEvent) =>
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement ||
    e.target instanceof HTMLSelectElement ||
    !!document.querySelector("dialog[open]");

  function onKeyDown(e: KeyboardEvent) {
    if (e.code !== "Space" || typingOrDialog(e)) return;
    // Space would otherwise scroll the page, or press a focused button.
    e.preventDefault();
    setSpaceHeld(true);
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.code === "Space") setSpaceHeld(false);
  }

  /**
   * With Space held or the Hand tool, a drag pans the document. Caught before
   * it reaches the page, so it never moves, draws or adds anything.
   */
  function onPanStart(e: PointerEvent) {
    if (!panReady() || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
    scroller.setPointerCapture(e.pointerId);
    setPanning(true);
    const move = (m: PointerEvent) => {
      if (m.pointerId !== e.pointerId) return;
      scroller.scrollLeft = start.left - (m.clientX - start.x);
      scroller.scrollTop = start.top - (m.clientY - start.y);
    };
    const end = (u: PointerEvent) => {
      if (u.pointerId !== e.pointerId) return;
      scroller.removeEventListener("pointermove", move);
      scroller.removeEventListener("pointerup", end);
      scroller.removeEventListener("pointercancel", end);
      setPanning(false);
    };
    scroller.addEventListener("pointermove", move);
    scroller.addEventListener("pointerup", end);
    scroller.addEventListener("pointercancel", end);
  }

  // Letting go of Space while the window is in the background never arrives as a keyup.
  const onBlur = () => setSpaceHeld(false);

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
    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("touchend", onTouchEnd);
    scroller.addEventListener("touchcancel", onTouchEnd);
    document.addEventListener("gesturestart", onGesture);
    document.addEventListener("gesturechange", onGesture);
    // Capture phase: runs before the page overlays (and Solid's delegated handlers) see the press.
    scroller.addEventListener("pointerdown", onPanStart, { capture: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    onCleanup(() => {
      props.onLeave?.({ top: scroller.scrollTop, left: scroller.scrollLeft });
      scroller.removeEventListener("pointerdown", onPanStart, { capture: true });
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      observer.disconnect();
      media?.removeEventListener("change", onDprChange);
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
      document.removeEventListener("gesturestart", onGesture);
      document.removeEventListener("gesturechange", onGesture);
    });

    props.api({
      goToPage(page) {
        pageEls[page - 1]?.scrollIntoView({ block: "start" });
      },
      fitWidth,
    });
    // A document coming back is shown where it was left (its zoom is already in place);
    // a newly opened one starts at actual size (100%).
    const back = props.scroll;
    if (back) {
      requestAnimationFrame(() => {
        scroller.scrollTop = back.top;
        scroller.scrollLeft = back.left;
      });
    } else props.onZoom(1);
  });

  return (
    <div class="scroller" classList={{ "pan-ready": panReady(), panning: panning() }} ref={scroller} onScroll={onScroll}>
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
