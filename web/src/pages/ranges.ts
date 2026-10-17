// Page ranges as people type them: "1-3, 5". Pages are 1-based in the text and
// 0-based in the arrays.

/**
 * The pages a range text names, as sorted 0-based indices without repeats, or
 * a user-facing message saying what's wrong. "3-" runs to the last page, and a
 * backwards range ("5-3") means the same as "3-5".
 */
export function parseRanges(text: string, count: number): number[] | string {
  const parts = text
    .replace(/\s*[-–]\s*/g, "-")
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (!parts.length) return "Choose at least one page.";
  const pages = new Set<number>();
  for (const part of parts) {
    const m = part.match(/^(\d+)(?:-(\d*))?$/);
    if (!m) return `“${part}” isn't a page or a range of pages, like 1-3.`;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : m[2] === "" ? count : Number(m[2]);
    const [from, to] = [Math.min(a, b), Math.max(a, b)];
    if (from < 1 || to > count) return `There's no page ${from < 1 ? from : to}: this PDF has ${count} ${count === 1 ? "page" : "pages"}.`;
    for (let p = from; p <= to; p++) pages.add(p - 1);
  }
  return [...pages].sort((x, y) => x - y);
}

/** Pages (0-based) as range text: [0, 1, 2, 4] is "1-3, 5". */
export function formatRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((x, y) => x - y);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j === i ? `${sorted[i] + 1}` : `${sorted[i] + 1}-${sorted[j] + 1}`);
    i = j + 1;
  }
  return parts.join(", ");
}
