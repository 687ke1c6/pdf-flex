// A small picture of a page, rendered by pdf.js the first time it comes near the screen.
import { createEffect, onCleanup, onMount } from "solid-js";
import { RenderingCancelledException, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import type { PageSize } from "../viewer/pdf";

/** Width of a thumbnail in CSS px. Keep in sync with `.thumb` in styles.css. */
export const THUMB_WIDTH = 112;

interface Props {
  /** The PDF the page comes from, and its 1-based page number there. */
  doc: PDFDocumentProxy;
  sourcePage: number;
  size: PageSize;
}

export function Thumbnail(props: Props) {
  let holder!: HTMLDivElement;
  let seen = false;
  let task: RenderTask | undefined;

  async function render() {
    const page = await props.doc.getPage(props.sourcePage);
    const viewport = page.getViewport({ scale: (THUMB_WIDTH * (window.devicePixelRatio || 1)) / props.size.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    task = page.render({ canvas, viewport });
    await task.promise;
    holder.replaceChildren(canvas);
  }

  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (seen || !entries.some((e) => e.isIntersecting)) return;
        seen = true;
        observer.disconnect();
        render().catch((err) => {
          if (!(err instanceof RenderingCancelledException)) console.error(`thumbnail of page ${props.sourcePage}:`, err);
        });
      },
      { rootMargin: "300px 0px" },
    );
    observer.observe(holder);
    onCleanup(() => {
      observer.disconnect();
      task?.cancel();
    });
  });

  // The holder keeps the page's proportions before (and while) it renders.
  createEffect(() => (holder.style.aspectRatio = `${props.size.width} / ${props.size.height}`));

  return <div class="thumb" ref={holder} />;
}
