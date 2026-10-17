import { expect, test } from "bun:test";
import type { Draft } from "./draftStore";
import { migrateDraft, migrateFileKey } from "./migrate";

const v1 = (extra: Partial<Draft> = {}): Draft => ({
  id: "hash-a",
  version: 1,
  name: "a.pdf",
  pageCount: 2,
  size: 100,
  placements: [],
  signatures: [],
  createdAt: 1,
  savedAt: 2,
  ...extra,
} as Draft);

test("a draft without page changes gets its document as its only source", () => {
  const d = migrateDraft(v1());
  expect(d.version).toBe(2);
  expect(d.id).toBe("hash-a");
  expect(d.sources).toEqual([{ id: "hash-a", name: "a.pdf" }]);
  expect(d.pages).toBeUndefined();
});

test("a draft with inserted PDFs keeps them, after its document", () => {
  const pages = [{ source: "hash-b", index: 0, width: 612, height: 792 }];
  const d = migrateDraft(v1({ pages, sources: [{ id: "hash-b", name: "b.pdf" }] }));
  expect(d.sources).toEqual([
    { id: "hash-a", name: "a.pdf" },
    { id: "hash-b", name: "b.pdf" },
  ]);
  expect(d.pages).toEqual(pages);
});

test("a migrated draft is left alone", () => {
  const d = migrateDraft(v1());
  expect(migrateDraft(d)).toBe(d);
});

test("a draft's own PDF moves to the new key; inserted ones are already there", () => {
  expect(migrateFileKey("hash-a")).toBe("hash-a:hash-a");
  expect(migrateFileKey("hash-a:hash-b")).toBeNull();
});
