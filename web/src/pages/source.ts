// Sources of pages to insert: a PDF file (checked like a PDF being opened), or blank pages.
import { documentId } from "../common/db";
import type { Source } from "../document/pages";
import { inspectPdf, sameLayout } from "../download/stamper";
import { openPdf } from "../viewer/pdf";
import { blankId, blankPdf } from "./blank";

/**
 * Reads a PDF file as a source of pages, or returns the one in `sources` if it's
 * the same file. Rejects with a user-facing message if it can't be edited
 * (encrypted, damaged, …) or the stamper and viewer disagree on its pages.
 */
export async function sourceFrom(file: File, sources: Map<string, Source>): Promise<Source> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = await documentId(bytes);
  const known = sources.get(id);
  if (known) return known;
  // The stamper's check first: pdf.js would open files the stamper refuses (owner-password restrictions).
  const { pages } = await inspectPdf(bytes);
  const pdf = await openPdf(bytes);
  if (!sameLayout(pdf.pages, pages)) {
    await pdf.close();
    throw new Error("Its page layout is unusual, so its pages can't be added.");
  }
  return { id, name: file.name, bytes, pdf };
}

/** A source with one blank page of this size, or the one in `sources` already. */
export async function blankSource(width: number, height: number, sources: Map<string, Source>): Promise<Source> {
  const id = blankId(width, height);
  const known = sources.get(id);
  if (known) return known;
  const bytes = blankPdf(width, height);
  return { id, name: "Blank page", bytes, pdf: await openPdf(bytes) };
}
