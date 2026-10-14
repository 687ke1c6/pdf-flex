import { describe, expect, test } from "bun:test";
import { documentId } from "../common/db";
import { formatSavedAt, formatSize, summarize, usablePlacements, type Draft } from "./draftStore";
import type { Placement } from "../document/placement";

const draft = (placements: unknown[]): Draft => ({
  id: "abc",
  version: 1,
  name: "form.pdf",
  pageCount: 3,
  size: 2048,
  placements: placements as Placement[],
  signatures: [],
  createdAt: 1,
  savedAt: 2,
});

const box = { page: 1, x: 0, y: 0, width: 10, height: 10 };

test("documentId is the SHA-256 of the bytes, so the same file always matches", async () => {
  const abc = new TextEncoder().encode("abc");
  expect(await documentId(abc)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(await documentId(abc.slice())).toBe(await documentId(abc));
  expect(await documentId(new TextEncoder().encode("abd"))).not.toBe(await documentId(abc));
});

test("summarize gives what the Recent list shows", () => {
  const d = draft([{ id: "p0", kind: "image", signatureId: "s", ...box }]);
  expect(summarize(d)).toEqual({ id: "abc", name: "form.pdf", pageCount: 3, size: 2048, items: 1, savedAt: 2 });
});

test("placements of kinds this version doesn't know are left out, not fatal", () => {
  const d = draft([
    { id: "p0", kind: "image", signatureId: "s", ...box },
    { id: "p1", kind: "hologram", ...box },
    { id: "p2", kind: "shape", shape: "rect", style: { stroke: "#000000", strokeWidth: 1, fill: null }, ...box },
  ]);
  expect(usablePlacements(d).map((p) => p.id)).toEqual(["p0", "p2"]);
});

describe("formatting", () => {
  const now = new Date(2026, 9, 13, 18, 0).getTime();
  test("today shows a time, yesterday says so, older shows a date", () => {
    const today = formatSavedAt(new Date(2026, 9, 13, 14, 32).getTime(), now);
    expect(today).toMatch(/14.32|2.32/);
    expect(formatSavedAt(new Date(2026, 9, 12, 9, 5).getTime(), now)).toStartWith("Yesterday ");
    expect(formatSavedAt(new Date(2026, 8, 1).getTime(), now)).toContain("2026");
  });
  test("sizes", () => {
    expect(formatSize(100)).toBe("1 KB");
    expect(formatSize(820 * 1024)).toBe("820 KB");
    expect(formatSize(3.4 * 1024 * 1024)).toBe("3.4 MB");
  });
});
