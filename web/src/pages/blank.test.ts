import { expect, test } from "bun:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { blankId, blankPdf } from "./blank";

test("a blank page opens at the size asked for", async () => {
  for (const [w, h] of [
    [612, 792],
    [841.89, 595.28],
  ]) {
    const doc = await getDocument({ data: blankPdf(w, h), verbosity: 0 }).promise;
    expect(doc.numPages).toBe(1);
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    expect([viewport.width, viewport.height]).toEqual([w, h]);
    expect((await page.getTextContent()).items).toHaveLength(0);
  }
});

test("the cross-reference table points at each object", () => {
  const text = new TextDecoder().decode(blankPdf(612, 792));
  const xref = Number(text.match(/startxref\n(\d+)/)![1]);
  expect(text.slice(xref, xref + 4)).toBe("xref");
  const entries = text.slice(xref).split("\n").slice(3, 6);
  entries.forEach((entry, i) => {
    expect(entry).toHaveLength(19); // 20 bytes with the newline
    expect(text.slice(Number(entry.slice(0, 10)))).toStartWith(`${i + 1} 0 obj`);
  });
});

test("blank sources are named by size", () => {
  expect(blankId(612, 792)).toBe("blank:612x792");
  expect(blankId(841.8898, 595.2756)).toBe("blank:841.89x595.28");
});
