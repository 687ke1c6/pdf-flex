import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { FLUSH_LIMIT_MS, SAVE_DELAY_MS, createAutosave, setDraftsEnabled, type DraftDocument } from "./autosave";
import type { Draft } from "./draftStore";
import type { NewSlot } from "../document/pages";
import type { Placement } from "../document/placement";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const document = (): DraftDocument => ({
  id: "abc",
  name: "abc.pdf",
  bytes: new Uint8Array(4),
  pageCount: 1,
  createdAt: 0,
  fileSaved: true,
});

/** Lets pending promise callbacks run. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/**
 * An autosave over a document whose version is a plain string, with a store
 * whose saves finish (or fail) only when the test says so.
 */
function setup(stored = "v0") {
  const [version, edit] = createSignal(stored);
  const writes: { version: string; done: boolean; finish(): void; fail(err: unknown): void }[] = [];
  const store = {
    save: (draft: Draft) =>
      new Promise<void>((resolve, reject) => {
        const write = {
          version: draft.placements[0].id,
          done: false,
          finish: () => ((write.done = true), resolve()),
          fail: (err: unknown) => ((write.done = true), reject(err)),
        };
        writes.push(write);
      }),
  };
  const autosave = createRoot(() =>
    createAutosave(document(), { version, placements: () => [{ id: version() } as Placement], signatures: () => [] }, store),
  );
  return {
    autosave,
    writes,
    edit,
    /** Lets the save delay pass. */
    wait: async () => {
      jest.advanceTimersByTime(SAVE_DELAY_MS);
      await settle();
    },
    /** Finishes the save that's running. */
    finish: async () => {
      writes.find((w) => !w.done)!.finish();
      await settle();
    },
  };
}

test("saves once the edits pause, then shows when", async () => {
  const { autosave, writes, edit, wait, finish } = setup();
  edit("v1");
  jest.advanceTimersByTime(SAVE_DELAY_MS / 2);
  edit("v2");
  jest.advanceTimersByTime(SAVE_DELAY_MS / 2);
  expect(writes).toHaveLength(0);
  await wait();
  expect(writes.map((w) => w.version)).toEqual(["v2"]);
  expect(autosave.state().status).toBe("saving");
  expect(autosave.upToDate()).toBe(false);
  await finish();
  expect(autosave.state().status).toBe("saved");
  expect(autosave.upToDate()).toBe(true);
  // Editing again means it's no longer saved; undoing back means it is.
  edit("v3");
  expect(autosave.state().status).toBe("idle");
  edit("v2");
  expect(autosave.state().status).toBe("saved");
  await wait();
  expect(writes).toHaveLength(1);
});

test("one save at a time: an edit during a save goes in the next one, after the wait", async () => {
  const { autosave, writes, edit, wait, finish } = setup();
  edit("v1");
  await wait();
  edit("v2");
  await wait();
  // The delay has passed, but v1's save is still running.
  expect(writes.map((w) => w.version)).toEqual(["v1"]);
  await finish();
  expect(autosave.state().status).toBe("idle");
  expect(writes).toHaveLength(1);
  await wait();
  expect(writes.map((w) => w.version)).toEqual(["v1", "v2"]);
  await finish();
  expect(autosave.state().status).toBe("saved");
  expect(autosave.upToDate()).toBe(true);
});

test("a long drag is saved once it pauses, even if a save was running when it started", async () => {
  const { autosave, writes, edit, wait, finish } = setup();
  edit("v1");
  await wait();
  for (let i = 0; i < 50; i++) {
    edit(`drag${i}`);
    jest.advanceTimersByTime(100);
    if (i === 10) await finish();
  }
  await settle();
  expect(writes.map((w) => w.version)).toEqual(["v1"]);
  await wait();
  expect(writes.map((w) => w.version)).toEqual(["v1", "drag49"]);
  await finish();
  expect(autosave.upToDate()).toBe(true);
});

test("undoing to what was stored while a save runs saves that again afterwards", async () => {
  const { autosave, writes, edit, wait, finish } = setup();
  edit("v1");
  await wait();
  edit("v0");
  // Still saving v1, so storage isn't v0 yet.
  expect(autosave.state().status).toBe("saving");
  expect(autosave.upToDate()).toBe(false);
  await finish();
  await wait();
  expect(writes.map((w) => w.version)).toEqual(["v1", "v0"]);
  await finish();
  expect(autosave.state().status).toBe("saved");
  expect(autosave.upToDate()).toBe(true);
});

test("a failed save isn't retried until the document changes", async () => {
  const { autosave, writes, edit, wait } = setup();
  edit("v1");
  await wait();
  writes[0].fail(new Error("disk"));
  await settle();
  await wait();
  await autosave.flush();
  await autosave.flush();
  expect(writes).toHaveLength(1);
  expect(autosave.state().status).toBe("error");
});

test("an edit made during a save that fails is still saved after the wait", async () => {
  const { autosave, writes, edit, wait, finish } = setup();
  edit("v1");
  await wait();
  edit("v2");
  writes[0].fail(new Error("disk"));
  await settle();
  await wait();
  expect(writes.map((w) => w.version)).toEqual(["v1", "v2"]);
  await finish();
  expect(autosave.state().status).toBe("saved");
});

test("a failure stays shown until a save works, or the document matches storage again", async () => {
  const { autosave, writes, edit, wait } = setup();
  edit("v1");
  await wait();
  writes[0].fail(new Error("disk"));
  await settle();
  expect(autosave.state()).toEqual({ status: "error", message: "Error: disk" });
  expect(autosave.upToDate()).toBe(false);

  // Another edit retries; undoing to the stored version first means there's nothing left to save.
  edit("v2");
  expect(autosave.state().status).toBe("error");
  edit("v0");
  expect(autosave.state().status).toBe("idle");
  expect(autosave.upToDate()).toBe(true);
  await wait();
  expect(writes).toHaveLength(1);

  // Changed again: the failure is back until a save works.
  edit("v3");
  expect(autosave.state().status).toBe("error");
  await wait();
  writes[1].finish();
  await settle();
  expect(autosave.state().status).toBe("saved");
});

test("flush saves straight away and waits for the save to finish", async () => {
  const { autosave, writes, edit, finish } = setup();
  await expect(autosave.flush()).resolves.toBeUndefined();
  expect(writes).toHaveLength(0);

  edit("v1");
  let flushed = false;
  void autosave.flush().then(() => (flushed = true));
  expect(writes.map((w) => w.version)).toEqual(["v1"]);
  // Flushing again during the save joins it rather than starting another.
  edit("v2");
  void autosave.flush();
  await settle();
  expect(writes).toHaveLength(1);
  await finish();
  expect(flushed).toBe(false);
  await finish();
  expect(flushed).toBe(true);
  expect(writes.map((w) => w.version)).toEqual(["v1", "v2"]);
  expect(autosave.upToDate()).toBe(true);
});

test("flush gives up waiting on a stuck save, which still finishes in the background", async () => {
  const { autosave, writes, edit, finish } = setup();
  edit("v1");
  let flushed = false;
  void autosave.flush().then(() => (flushed = true));
  jest.advanceTimersByTime(FLUSH_LIMIT_MS - 1);
  await settle();
  expect(flushed).toBe(false);
  jest.advanceTimersByTime(1);
  await settle();
  expect(flushed).toBe(true);
  expect(autosave.upToDate()).toBe(false);
  // Storage comes back: the draft catches up without another flush.
  edit("v2");
  await finish();
  expect(writes.map((w) => w.version)).toEqual(["v1", "v2"]);
  await finish();
  expect(autosave.upToDate()).toBe(true);
});

test("turning drafts back on saves what changed while they were off", async () => {
  const { autosave, writes, edit, wait, finish } = setup();
  try {
    edit("v1");
    setDraftsEnabled(false);
    await wait();
    edit("v2");
    await wait();
    expect(writes).toHaveLength(0);
    setDraftsEnabled(true);
    await wait();
    expect(writes.map((w) => w.version)).toEqual(["v2"]);
    await finish();
    expect(autosave.upToDate()).toBe(true);
  } finally {
    setDraftsEnabled(true);
  }
});

test("changed pages are saved with the draft, and each inserted PDF is written once", async () => {
  const [version, edit] = createSignal("v0");
  const [pages, setPages] = createSignal<NewSlot[] | undefined>(undefined);
  const saves: { draft: Draft; sources: string[] }[] = [];
  const store = {
    save: async (draft: Draft, _pdf?: Uint8Array, sources: { id: string }[] = []) => {
      saves.push({ draft, sources: sources.map((s) => s.id) });
    },
  };
  const other = { id: "other", name: "other.pdf", bytes: new Uint8Array(2) };
  const autosave = createRoot(() =>
    createAutosave(
      document(),
      {
        version,
        placements: () => [],
        signatures: () => [],
        pages,
        sources: () => (pages()?.some((p) => p.source === "other") ? [other] : []),
      },
      store,
    ),
  );
  const page = (source: string): NewSlot => ({ source, index: 0, width: 612, height: 792 });

  setPages([page("abc"), page("other")]);
  edit("v1");
  jest.advanceTimersByTime(SAVE_DELAY_MS);
  await settle();
  expect(saves[0].draft.pages).toEqual([page("abc"), page("other")]);
  expect(saves[0].draft.sources).toEqual([{ id: "other", name: "other.pdf" }]);
  expect(saves[0].draft.pageCount).toBe(2);
  expect(saves[0].sources).toEqual(["other"]);

  edit("v2");
  jest.advanceTimersByTime(SAVE_DELAY_MS);
  await settle();
  // Already stored: not written again.
  expect(saves[1].sources).toEqual([]);

  // Pages back as opened: the draft has no page list.
  setPages(undefined);
  edit("v3");
  jest.advanceTimersByTime(SAVE_DELAY_MS);
  await settle();
  expect(saves[2].draft.pages).toBeUndefined();
  expect(saves[2].draft.pageCount).toBe(1);
  expect(autosave.upToDate()).toBe(true);
});
