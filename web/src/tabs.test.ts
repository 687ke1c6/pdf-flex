import { expect, test } from "bun:test";
import { createDocState, isDirty, snapshotOf } from "./docState";
import { arrangeTabs, docTab, emptyTab, isEmptyTab, pendingTab, saveTabs, savedTabs, tabDocId, tabName, type DocSession } from "./tabs";

test("each document has its own placements, selection and undo history", () => {
  const a = createDocState([{ width: 612, height: 792 }]);
  const b = createDocState([{ width: 612, height: 792 }]);
  a.history.checkpoint(snapshotOf(a));
  a.setPlacements([{ id: "p0", kind: "image", signatureId: "s", page: 1, x: 0, y: 0, width: 10, height: 10 }]);
  a.setSelection(["p0"]);
  expect(a.placements).toHaveLength(1);
  expect(b.placements).toHaveLength(0);
  expect(b.selection()).toEqual([]);
  expect(a.history.canUndo()).toBe(true);
  expect(b.history.canUndo()).toBe(false);
  expect(isDirty(a)).toBe(true);
  expect(isDirty(b)).toBe(false);
});

test("tabs are named after their document, and empty ones aren't remembered", () => {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  } as Storage;
  const doc = docTab({ id: "abc", name: "form.pdf" } as DocSession);
  const empty = emptyTab();
  const later = pendingTab("def", "lease.pdf");
  expect([tabName(doc), tabName(empty), tabName(later)]).toEqual(["form.pdf", "New tab", "lease.pdf"]);
  expect(tabDocId(empty)).toBeUndefined();

  saveTabs([doc, empty, later], later.key);
  expect(savedTabs()).toEqual({ ids: ["abc", "def"], active: 1 });
});

test("there's at most one empty tab, and it's always last", () => {
  const a = docTab({ id: "a", name: "a.pdf" } as DocSession);
  const b = pendingTab("b", "b.pdf");
  const e1 = emptyTab();
  const e2 = emptyTab();
  expect(arrangeTabs([e1, a, e2, b]).map((t) => t.key)).toEqual([a.key, b.key, e1.key]);
  // The empty tab in front is the one kept.
  expect(arrangeTabs([e1, a, e2], e2.key).map((t) => t.key)).toEqual([a.key, e2.key]);
  expect(arrangeTabs([a, b])).toEqual([a, b]);
  // Never no tabs at all.
  expect(arrangeTabs([])).toHaveLength(1);
  expect(isEmptyTab(arrangeTabs([])[0])).toBe(true);
});
