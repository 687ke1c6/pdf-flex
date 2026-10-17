// Blank pages: a minimal one-page PDF, made here, inserted like any other source.

/** Rounds to what a PDF number needs; sizes are in points. */
const num = (n: number) => String(Math.round(n * 100) / 100);

/** A one-page PDF with an empty page of this size, in points. */
export function blankPdf(width: number, height: number): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] /Resources << >> >>`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  // Each cross-reference entry is exactly 20 bytes, its end of line included.
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // ASCII only, so one byte per character.
  return new TextEncoder().encode(pdf);
}

/** The source id for blank pages of this size. The same size is always the same source. */
export const blankId = (width: number, height: number) => `blank:${num(width)}x${num(height)}`;
