/** Saves bytes as a file download. */
export function download(bytes: Uint8Array<ArrayBuffer>, filename: string, type = "application/pdf") {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  // Revoking in the same tick can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `report.pdf` → `report-edited.pdf` */
export const editedName = (name: string) => `${name.replace(/\.pdf$/i, "")}-edited.pdf`;
