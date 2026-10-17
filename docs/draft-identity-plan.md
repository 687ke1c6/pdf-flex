# pdf-flex — Draft identity plan

The pages spike ([pages-plan.md](pages-plan.md)) is validated and being promoted. It also broke an assumption the drafts were built on ([drafts-plan.md](drafts-plan.md)): **a draft is edits on one file**. A draft can now hold pages from many PDFs, and none from the file it started from.

This phase makes a draft its own piece of work, with its own id, that *uses* files, rather than being a file's shadow. It ends by removing the `pages` feature flag.

---

## 1. Why

Today a draft's id is the SHA-256 of the PDF that was opened. With page operations that causes four problems:

1. **The offer can mislead.** Opening pdf-a offers "unsaved work on this document", even if the draft has no page from pdf-a left.
2. **One draft per file.** To start something new from pdf-a, you press Start over, and your next change *overwrites* the old draft. That's quiet data loss.
3. **Tabs dedupe by file.** Opening pdf-a while a tab derived from it is open just brings that tab forward, so you can't have both side by side.
4. **The opened file is always stored,** even when no page uses it (a blank-page-only draft still stores the whole original).

All four go once the draft, not the file, is the anchor.

---

## 2. Scope

**In scope**
- Drafts get their own id. The PDFs they use are recorded by hash, with names.
- A session opens from a **page list and its sources**. The opened file is just the first source.
- **Opening a file** offers the most recent draft that **still uses a page from it**. **Start over** never overwrites anything.
- **Tabs** are keyed by draft: the same file can be open in several tabs.
- A draft stores **only the PDFs its pages use**, the opened one included.
- Recent shows what a draft is made of.
- Migrate existing drafts once, without losing any.
- Promote: remove the `pages` flag after the pages plan's review items (its chunk 7).

**Out of scope** (candidates afterwards)
- Naming a draft (and its download) independently of the first file; today it's `<first file>_edited.pdf`.
- Sharing stored PDFs across drafts (one copy per hash, reference-counted). Each draft keeps its own copies for now.
- Bulk "clear old drafts". Start over keeps old drafts, so more will pile up; Discard in Recent stays the way to remove them.

---

## 3. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | A draft's id | **A random id** (`crypto.randomUUID()`), given when a session is created. Written only on the first change, as today, so opening and closing a file leaves nothing behind |
| 2 | What a draft records about files | `sources: { id, name }[]`, where `id` is the PDF's SHA-256, for **every** PDF its pages use, the opened one included. `pages` is **always** stored, even unchanged |
| 3 | Which draft opening a file offers | The **most recent draft whose pages still use that file** and that **isn't already open in a tab**. If more match, the banner adds "and N more in Recent". A draft that no longer uses the file isn't offered; Recent is the way back to it |
| 4 | Restore and Start over | **Restore** reopens the offered draft in that tab, replacing the fresh session. **Start over** keeps the old draft: the fresh session already has its own new id, and its first change starts a new draft |
| 5 | Opening a file that's already open | If a tab has the same file **untouched** (one source, no changes), bring it forward, as today. Otherwise open a new tab. If the most recent matching draft is open in a tab, the banner offers **Switch to it** instead of Restore |
| 6 | Stored files | `draftFiles` keys become `<draft id>:<source hash>` for every source, the opened PDF included. A save deletes files no page uses (as inserted ones already are). A blank-only draft stores about nothing |
| 7 | Which bytes to stamp | No more "original": if the page list is exactly one source's pages in order, stamp that source's bytes; otherwise assemble, with any source's pdf.js document as the base. Replaces `pagesChanged()` for this purpose; dirty tracking is unchanged |
| 8 | Migration | IndexedDB version 3, in the upgrade transaction: each old draft keeps its id, gains `sources: [{ id: <its id>, name }]`, and its file moves from key `<id>` to `<id>:<id>`. Old drafts without `pages` mean "every page of the first source"; the loader fills them in from pdf.js. One-way, like every IndexedDB upgrade |
| 9 | Opening-time checks (`inspectPdf`) | Per source, when it's added: refusal, the digitally-signed warning and the layout check. Today only the opened file gets the warning; inserted PDFs lose their signatures too |

---

## 4. Roadmap

**Status key:** ✅ done · 🔜 next · ⬜ not started

| # | Chunk | Done when | Status |
|---|---|---|---|
| 1 | Draft model and migration | Old drafts load after the upgrade; new drafts have random ids, sources and pages; unit tests for the migration | 🔜 |
| 2 | Sessions open from a page list | A session is a page list plus sources; the "original" is gone from session, download and drafts. Everything behaves as before | ⬜ |
| 3 | Opening a file: offers, Start over, tabs | The offer follows decision 3; Start over never overwrites; the same file can be open in two tabs | ⬜ |
| 4 | Recent shows what a draft is | "14 pages from 3 PDFs · 820 KB"; open drafts are marked by draft id | ⬜ |
| 5 | Store only what's used | A draft stores only the PDFs its pages use; blank-only is about 0 KB | ⬜ |
| 6 | Promote | Pages plan chunk 7 review done; `pages` flag removed; the Experimental section is hidden when there are no flags | ⬜ |

### Chunk 1: Draft model and migration
- `Draft`: `id` (random) and `sources: { id, name }[]` (every PDF used), both required. `pages` is required for new drafts and optional on read (old drafts).
- `common/db.ts`: version 3 upgrade, per decision 8, with the moves done by a cursor inside the upgrade transaction.
- `drafts/migrate.ts`: the record changes as pure functions, unit-tested (draft without pages, with pages and inserted sources, already migrated).
- `draftStore`:
  - `file(draftId, sourceId)` replaces `pdf(id)` and `source(…)`.
  - `matching(sourceId)` returns drafts whose `pages` (or, for old drafts, first source) use that file, most recent first.
- **Your check:** with drafts made on `main` (or this branch before the chunk), load the new build. Recent still lists them, and each restores with its pages and items. DevTools → IndexedDB shows `draftFiles` keys as `<id>:<id>`.

### Chunk 2: Sessions open from a page list
- **`DocSession`:** loses `bytes` and `pdf`; its `id` is the draft id; it keeps `name`. `createSession({ draftId, name, slots, sources, draft? })`.
- **Opening a file:** one source and its pages. **Opening a draft:** its sources from `draftFiles`, then its pages (the chunk 6 loader of the pages plan, generalised).
- **`DocState`:** `createDocState(slots)`. `pagesChanged` goes; download uses decision 7 (`singleSource(slots)` in `pages.ts`).
- **`inspectPdf` per source** (decision 9). The digitally-signed and layout warnings name the PDF they're about.
- **`assemble`:** the base is any source's pdf.js document (the first slot's).
- Tabs, Recent and offers still key on what they did, now the draft id, so behaviour doesn't change yet: open the same file and you're still offered its draft.
- **Your check:** a regression pass of signing, page changes, drafts, tabs and download. Nothing should look different.

### Chunk 3: Opening a file: offers, Start over, tabs
- **On open:** the file's hash goes to `draftStore.matching`, minus drafts open in tabs, giving decision 3's offer.
  - The banner names the draft and what it is: "You have work using this file from 14:32 (14 pages from 3 PDFs, 2 items). Restore / Start over", plus "and 2 more in Recent".
  - If the newest match is open in a tab: "You're working on this file in another tab. Switch to it".
- **Restore** replaces the fresh session with the draft's, in the same tab.
- **Start over:** the banner closes, and nothing is deleted or overwritten.
- **Tabs:** keyed by draft id (`savedTabs` stores draft ids). Opening a file brings forward only an untouched tab of the same file (decision 5).
- **Tabs off:** the same rules, with one document at a time.
- **Your checks:**
  1. Open pdf-a, sign it, close it, reopen it: offered, and Restore brings it back.
  2. Build a composition from pdf-a (add pdf-b, delete all pdf-a pages), then open pdf-a: not offered.
  3. Keep one pdf-a page instead: offered.
  4. Start over, change something, and check Recent: both drafts are there.
  5. With tabs, open pdf-a twice after changing the first tab: two tabs. Open it once more with nothing changed in the second: the second comes forward.

### Chunk 4: Recent shows what a draft is
- Each entry: name, "14 pages from 3 PDFs" (or "3 pages" for one PDF), items, size, saved time.
- Open drafts are marked by draft id.
- **Your check:** Recent entries describe their drafts; one open in a tab says so and switches to it.

### Chunk 5: Store only what's used
- Pruning (pages plan chunk 6 follow-up) covers every source, the opened PDF included.
- Restore and reopen don't need the opened file any more (chunk 2).
- **Your check:** add a blank page, delete every page of the opened PDF, wait for Saved. Recent shows about 0 KB, and reopening the draft works.

### Chunk 6: Promote
- Pages plan chunk 7 review: memory with large inserted PDFs; download time on `out/many-pages.pdf` with inserts; whether links and bookmarks in inserted PDFs survive (note, don't fix).
- Remove the `pages` flag: the Pages tool is always on the rail. `flags.ts` stays for future flags, and Settings hides Experimental while `FLAGS` is empty.
- The pages plan is marked done, with pointers here.
- **Your check:** a fresh profile has the Pages tool without touching Settings, and the whole pages feature works.

---

## 5. Risks and blind spots

- **The migration is one-way.** Once version 3 has opened, an older build can't read the drafts. Acceptable on a branch; test it on a copy of real drafts (chunk 1's check).
- **Drafts pile up**, now that Start over keeps the old one. Watch it; bulk cleanup is out of scope for now.
- **The same PDF stored twice** when two drafts use it. Shared storage is out of scope; measure in chunk 6.
- **Matching cost:** `matching` reads every draft to find users of a hash. Fine for tens of drafts; an index on source ids (`multiEntry`) if it isn't.
- **Names:** with no "original", the draft's name is the first file's name and never changes. Naming is out of scope, but the banner and Recent should describe drafts well enough to tell apart.
