import { createEffect, onCleanup } from "solid-js";
import { RenderingCancelledException, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import { PageOverlay } from "./PageOverlay";
import type { PageSize } from "./pdf";

/** Upper bound on canvas pixels per page; beyond this, very high zoom renders slightly soft. */
const MAX_CANVAS_PIXELS = 4096 * 4096;

interface Props {
  doc: PDFDocumentProxy;
  pageNumber: number;
  size: PageSize;
  /** CSS pixels per point, for layout. Changes immediately while zooming. */
  scale: number;
  /** CSS pixels per point to render at. Lags `scale` so rapid zooming doesn't re-render every step. */
  renderScale: number;
  /** Near the viewport: render it. Otherwise its canvas is released to save memory. */
  active: boolean;
  /** Bumped when devicePixelRatio changes (e.g. window moved to another monitor). */
  dprTick: number;
  ref: (el: HTMLDivElement) => void;
}

export function PageView(props: Props) {
  let holder!: HTMLDivElement;

  createEffect(() => {
    const { active, renderScale, size, pageNumber } = props;
    void props.dprTick;
    if (!active) {
      holder.replaceChildren();
      return;
    }

    let cancelled = false;
    let task: RenderTask | undefined;
    onCleanup(() => {
      cancelled = true;
      task?.cancel();
    });

    (async () => {
      const page = await props.doc.getPage(pageNumber);
      if (cancelled) return;

      let pxPerPt = renderScale * (window.devicePixelRatio || 1);
      const area = size.width * size.height * pxPerPt * pxPerPt;
      if (area > MAX_CANVAS_PIXELS) pxPerPt *= Math.sqrt(MAX_CANVAS_PIXELS / area);

      const viewport = page.getViewport({ scale: pxPerPt });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      // Render off-screen and swap in when done, so zooming never flashes blank:
      // the previous canvas stays visible (CSS-stretched) until the sharp one is ready.
      task = page.render({ canvas, viewport });
      await task.promise;
      if (!cancelled) holder.replaceChildren(canvas);
    })().catch((err) => {
      if (!(err instanceof RenderingCancelledException)) console.error(`page ${pageNumber}:`, err);
    });
  });

  return (
    <div
      class="page"
      ref={props.ref}
      data-page={props.pageNumber}
      style={{ width: `${props.size.width * props.scale}px`, height: `${props.size.height * props.scale}px` }}
    >
      <div class="canvas-holder" ref={holder} />
      <PageOverlay pageNumber={props.pageNumber} size={props.size} scale={props.scale} />
    </div>
  );
}
