// pdf.js setup: worker and runtime assets are bundled locally, never fetched from a CDN.
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}pdfjs/`;

/** Page size in display-space points: after CropBox and /Rotate, as a viewer shows it. */
export interface PageSize {
  width: number;
  height: number;
}

export interface LoadedPdf {
  doc: PDFDocumentProxy;
  pages: PageSize[];
  /** Releases the document and its worker resources. */
  close(): Promise<void>;
}

/**
 * Opens a PDF from bytes. pdf.js transfers the buffer it is given to its
 * worker, so it gets a copy and the caller's bytes stay usable for stamping.
 */
export async function openPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const task = getDocument({
    data: bytes.slice(),
    cMapUrl: `${assets}cmaps/`,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
  });
  const doc = await task.promise;

  const pages = await Promise.all(
    Array.from({ length: doc.numPages }, async (_, i) => {
      const viewport = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
      return { width: viewport.width, height: viewport.height };
    }),
  );
  return { doc, pages, close: () => task.destroy() };
}
