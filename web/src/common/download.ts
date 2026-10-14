/** Saves bytes as a file download. */
export function download(bytes: Uint8Array<ArrayBuffer>, filename: string, type = "application/pdf") {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  // Revoking in the same tick can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Added before `.pdf` in the suggested name for a download. */
export const EDITED_SUFFIX = "_edited";

/**
 * The suggested download name for a document, and where its suffix sits, so
 * it can be selected for retyping: `report.pdf` → `report_edited.pdf`.
 */
export function suggestedName(name: string): { name: string; suffixStart: number; suffixEnd: number } {
  const base = name.replace(/\.pdf$/i, "");
  return { name: `${base}${EDITED_SUFFIX}.pdf`, suffixStart: base.length, suffixEnd: base.length + EDITED_SUFFIX.length };
}

/**
 * A typed file name made safe to save: characters files can't have become
 * "-", spaces are trimmed, and it ends in `.pdf`. Empty if there's no name left.
 */
export function cleanFileName(typed: string): string {
  const base = typed
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .trim()
    .replace(/\.pdf$/i, "")
    .replace(/[. ]+$/, "");
  return base ? `${base}.pdf` : "";
}
