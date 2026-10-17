// Opening a draft's PDFs again, from where they're stored with it, to continue it.
import { sourcesUsed, type Draft } from "../drafts/draftStore";
import type { Source } from "../document/pages";
import { openPdf } from "../viewer/pdf";
import { isBlankSource } from "./blank";
import { blankSource } from "./source";

/**
 * Opens the PDFs a draft's pages come from into `sources` (blank pages are made
 * again). Resolves to the names of the ones that couldn't be read; their pages
 * can't be restored.
 */
export async function openDraftSources(
  draft: Draft,
  sources: Map<string, Source>,
  read: (sourceId: string) => Promise<Uint8Array | undefined>,
): Promise<string[]> {
  const missing: string[] = [];
  for (const id of sourcesUsed(draft)) {
    if (sources.has(id)) continue;
    const name = draft.sources.find((s) => s.id === id)?.name ?? "a PDF";
    try {
      if (isBlankSource(id)) {
        const { width, height } = draft.pages!.find((p) => p.source === id)!;
        const blank = await blankSource(width, height, sources);
        sources.set(blank.id, blank);
        continue;
      }
      const bytes = await read(id).catch(() => undefined);
      if (!bytes) {
        missing.push(name);
        continue;
      }
      sources.set(id, { id, name, bytes, pdf: await openPdf(bytes) });
    } catch {
      missing.push(name);
    }
  }
  return missing;
}
