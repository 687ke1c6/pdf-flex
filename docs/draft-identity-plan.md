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
| 3 | Which draft opening a file offers | The **most recent draft whose pages still use that file**. If it's open in a tab, the banner offers to switch to it (decision 5). If more match, the banner says how many more are in Recent. A draft that no longer uses the file isn't offered; Recent is the way back to it |
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
| 1 | Draft model and migration | Old drafts load after the upgrade; new drafts have random ids, sources and pages; unit tests for the migration | ✅ (pending your check) |
| 2 | Sessions open from a page list | A session is a page list plus sources; the "original" is gone from session, download and drafts. Everything behaves as before | ✅ (pending your check) |
| 3 | Opening a file: offers, Start over, tabs | The offer follows decision 3; Start over never overwrites; the same file can be open in two tabs | ✅ (pending your check) |
| 4 | Recent shows what a draft is | "14 pages from 3 PDFs · 820 KB"; open drafts are marked by draft id | ✅ (pending your check) |
| 5 | Store only what's used | A draft stores only the PDFs its pages use; blank-only is about 0 KB | ✅ (pending your check) |
| 6 | Promote | Pages plan chunk 7 review done; `pages` flag removed; the Experimental section is hidden when there are no flags | ✅ (pending your check) |

### Chunk 1: Draft model and migration
- `Draft`: `id` (random) and `sources: { id, name }[]` (every PDF used), both required. `pages` is required for new drafts and optional on read (old drafts).
- `common/db.ts`: version 3 upgrade, per decision 8, with the moves done by a cursor inside the upgrade transaction.
- `drafts/migrate.ts`: the record changes as pure functions, unit-tested (draft without pages, with pages and inserted sources, already migrated).
- `draftStore`:
  - `file(draftId, sourceId)` replaces `pdf(id)` and `source(…)`.
  - `matching(sourceId)` returns drafts whose `pages` (or, for old drafts, first source) use that file, most recent first.
- **Your check:** with drafts made on `main` (or this branch before the chunk), load the new build. Recent still lists them, and each restores with its pages and items. DevTools → IndexedDB shows `draftFiles` keys as `<id>:<id>`.

**As built** (chunks 1 and 2 were built together: once drafts have random ids, a file can't find its draft by `get(hash)`, so sessions had to change at the same time)
- **`drafts/migrate.ts`:**
  - `migrateDraft` makes a version 1 draft version 2: its document becomes its first source, before any inserted ones.
  - `migrateFileKey` moves `<id>` to `<id>:<id>`.
  - 4 tests.
- **`common/db.ts`:**
  - Version 3 runs both moves with cursors inside the upgrade transaction, so it's all or nothing.
  - Moved files land on keys the same cursor reaches later (`hash:hash` sorts after `hash`), and `migrateFileKey` leaves those alone.
- **`draftStore`:**
  - `DRAFT_VERSION` 2.
  - `sources` is required: every PDF the pages use, blank pages aside.
  - `sourcesUsed(draft)` (the page list's sources, or the first source for old drafts).
  - `matching(hash)` returns drafts using a file, newest first.
  - `file(draftId, sourceId)` replaces `pdf(id)`/`source(…)`.
  - `save(draft, files, drop)`, with no special document PDF.

### Chunk 2: Sessions open from a page list
- **`DocSession`:** loses `bytes` and `pdf`; its `id` is the draft id; it keeps `name`. `createSession({ draftId, name, slots, sources, draft? })`.
- **Opening a file:** one source and its pages. **Opening a draft:** its sources from `draftFiles`, then its pages (the chunk 6 loader of the pages plan, generalised).
- **`DocState`:** `createDocState(slots)`. `pagesChanged` goes; download uses decision 7 (`singleSource(slots)` in `pages.ts`).
- **`inspectPdf` per source** (decision 9). The digitally-signed and layout warnings name the PDF they're about.
- **`assemble`:** the base is any source's pdf.js document (the first slot's).
- Tabs, Recent and offers still key on what they did, now the draft id, so behaviour doesn't change yet: open the same file and you're still offered its draft.
- **Your check:** a regression pass of signing, page changes, drafts, tabs and download. Nothing should look different.

**As built**
- **`DocSession`** has no `bytes`/`pdf`: `id` is the draft id (`newDraftId()`, a random UUID, or the restored draft's). `createSession({ id, name, pages, sources, draft? })`.
- **`App`:**
  - `fileSession` (a file: one source, a new draft, the offer).
  - `draftSession` (a draft: its PDFs via `openDraftSources`, then `restoreDraft`). It starts from every page of the draft's first PDF, which is what old drafts without a page list mean.
  - `place()`: tab placement and the tabs-off replace, shared by both.
  - `open()` hashes the file, `openDraft()` reads the draft, and `show()` (tabs after a reload) opens the draft by id.
- **`DocState`:**
  - `createDocState(pages)` takes slots.
  - `pagesChanged` is gone. `singleSource(slots, sources)` (decision 7) decides what to stamp, and `hasChanges(d)` (items, or not exactly one PDF's pages) enables Download and "Downloaded".
- **`pagesPdf(doc)`** assembles with the first page's source as the base.
- **Autosave** always saves the page list and every PDF the pages use. Each is written once (`sourcesSaved`, seeded from the restored draft) and dropped when unused. The size is the sum of what's stored.
- **Came early, inherent to the change:**
  - **Start over never overwrites** (the fresh session already has its own id). The button's tooltip says the saved work stays.
  - **Restore** replaces the fresh session with the draft's, in its tab (decision 4).
  - **The offer** is the newest draft using the file that isn't open in a tab (decision 3, without the banner wording).
  - **Store only what's used** works: the opened PDF is pruned like any other, so a blank-only draft stores nothing (an autosave test checks it), and `draftSession` copes with no first PDF. Chunk 5 is just its check.
- **Interim until chunk 3:** opening a file brings forward any tab whose pages use it (close to the old "tab of this file"). Decision 5 replaces it.
- **Decision 9, partly:** a document's PDFs are inspected when it opens (the file, or all of a draft's), and warnings name the PDF when there are several. PDFs inserted later are refused as before but don't get the digitally-signed warning yet (chunk 3).
- **Tests:**
  - `pages.test.ts`: `singleSource`/`hasChanges`, `usedSources` (it replaced `insertedSources`).
  - `autosave.test.ts`: the whole lifecycle, down to a blank-only draft storing 0 bytes.
  - `drafts.test.ts`: `sourcesUsed`.
  - Fixed `tabs.test.ts`, which still checkpointed plain placements since pages chunk 1. `tsc` skips test files, so a one-off typecheck with them included was run as well; it's clean apart from missing `bun:test`/`node:*` declarations.
- **Verified (no browser):** `just test` (Rust, plus 118 web tests), `just lint`, `just build` and `just wasm-smoke` pass.
- **Your checks:**
  1. **Migration:** check out `main` (or `79a4194`), make two drafts (one with page changes, one without), then switch back and load. Both are in Recent and restore fully. DevTools → IndexedDB → pdf-flex is version 3, and `draftFiles` keys are `<id>:<hash>`.
  2. **Regression:** sign a PDF, close and reopen it, Restore. Insert and delete pages, reload with tabs on (everything comes back), and download.
  3. **Start over:** open a file with a draft, Start over, change something. Recent now has two drafts of it, and the old one is unchanged.
  4. **Offer:** with a draft open in a tab, open the same file from disk: that tab comes forward (interim rule).
  5. **Blank only:** add a blank page, delete every original page, wait for Saved. Recent shows about 0 KB, and reopening from Recent works.

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

**As built (chunks 3 and 4, built without stopping for checks)**
- **Offer** (`Offer { draft, more }` on the session): the newest draft using the file, and how many others do.
  - The banner reads "You have work using this file from 14:32 (14 pages from 3 PDFs, 2 items). There are 2 more in Recent." with **Restore** and **Start over**.
  - If that draft is open in a tab (when the file was opened, or since), the banner says "You're working with this file in another tab (…)" with **Switch to it** and **Start over**. It's worked out live, so closing that tab turns it back into Restore.
  - Decision 3 changed to match: drafts open in a tab are offered too, as a switch, rather than skipped.
- **Opening a file** brings forward only a tab where that file is **untouched**: exactly its pages, nothing placed. Otherwise it's a new tab (decision 5). Tabs were already keyed by draft id in chunk 2 (`tabDocId` is the session id, and `savedTabs` stores those).
- **Decision 9, rest:** a PDF inserted later that is digitally signed adds a warning to the document's warnings ("“b.pdf” is digitally signed …"). `sourceFrom` keeps the result of its check on the source (`digitallySigned`).
- **Fix after your check:** **Switch to it** also closes the tab it's pressed in. That tab is a fresh, untouched copy of the file (the offer goes at the first change), so nothing is lost, and it's no longer wanted.
- **Recent:** `DraftSummary.pdfs`; entries read "14 pages from 3 PDFs, 2 items · 820 KB · saved 14:32" (`describe`, also used by the banner). "Open in a tab" was already by draft id.
- **Tests:** `describe` and `summarize().pdfs` in `drafts.test.ts`.

### Chunk 5: Store only what's used
- Pruning (pages plan chunk 6 follow-up) covers every source, the opened PDF included.
- Restore and reopen don't need the opened file any more (chunk 2).
- **Your check:** add a blank page, delete every page of the opened PDF, wait for Saved. Recent shows about 0 KB, and reopening the draft works.

**As built:** done in chunk 2. The autosave test covers a blank-only draft storing 0 bytes and dropping every stored PDF.

### Chunk 6: Promote
- Pages plan chunk 7 review: memory with large inserted PDFs; download time on `out/many-pages.pdf` with inserts; whether links and bookmarks in inserted PDFs survive (note, don't fix).
- Remove the `pages` flag: the Pages tool is always on the rail. `flags.ts` stays for future flags, and Settings hides Experimental while `FLAGS` is empty.
- The pages plan is marked done, with pointers here.
- **Your check:** a fresh profile has the Pages tool without touching Settings, and the whole pages feature works.

**As built**
- **Review** (Bun, real pdf.js and the WASM stamper; a one-off script, not kept):

  | Case | Pages | Merge | Check + stamp a line on every page |
  |---|---|---|---|
  | `out/many-pages.pdf` + Mac Preview PDF + Acrobat scan | 130 | 34 ms | 54 ms |
  | Word PDF + Mac Preview PDF + Acrobat scan | 11 | 79 ms | 92 ms |

  - **Links survive:** 2 + 55 in, 57 out.
  - **Bookmarks survive and follow their pages,** from the base PDF and from inserted ones. The scan's 4 bookmarks pointed at pages 8–11 after being inserted there. Reordered, they follow the pages; bookmarks for left-out pages are dropped. Better than the pages plan expected.
  - **Not measured: memory.** It needs a browser. Expect about twice each PDF's size (our copy plus pdf.js's in its worker), plus about 0.4 MB per thumbnail that has been seen (they aren't freed).
- **Flag removed:**
  - `PANEL_TOOLS` includes Pages again as a constant. `isToolEnabled` and the editor's "tool turned off" effect are gone.
  - `FLAGS` is empty and Settings hides Experimental while it is. A stored `pages` flag is ignored (test).
- **Verified (no browser):** `just test` (Rust, plus 119 web tests), `just lint`, `just build` and `just wasm-smoke` pass. A one-off typecheck including the test files is clean.

## 6. Your checks, all chunks

Built without per-chunk checks, so here they are in one pass (a fresh profile is easiest, after step 1):
1. **Migration:** with drafts made on `main`, load this build. They're all in Recent and restore fully. IndexedDB pdf-flex is version 3, with `draftFiles` keys `<id>:<hash>`.
2. **Pages tool:** it's on the rail without touching Settings, and there's no Experimental section in Settings.
3. **Offer:** open pdf-a, sign it, close the tab, open pdf-a again. The banner says "work using this file … (N pages, 1 item)". Restore brings it back.
4. **Composition:** in that draft add pdf-b, then delete every pdf-a page. Close it and open pdf-a: no offer. Undo one pdf-a page back first instead: offered.
5. **Start over:** on an offer, Start over and change something. Recent has both drafts, and the old one is unchanged. Opening pdf-a again says "There is 1 more in Recent".
6. **Tabs (tabs on):**
   - Open pdf-a twice with nothing changed: one tab comes forward.
   - Change something, open pdf-a again: a second tab, whose banner says you're working with it in another tab. **Switch to it** goes there and closes the second tab.
   - Close the first tab: the second tab's banner turns into Restore.
   - Reload: tabs come back by draft.
7. **Tabs off:** the same, one document at a time; replacing asks first if work isn't in a draft.
8. **Signed PDF inserted:** insert a digitally signed PDF; the warning bar names it.
9. **Recent:** entries read "14 pages from 3 PDFs, 2 items · … KB · saved …"; one open in a tab says so.
10. **Blank only:** add a blank page, delete every page of the opened PDF, wait for Saved. Recent shows about 0 KB and the draft reopens.
11. **Downloads:** a composition with links and bookmarks (e.g. the Mac Preview and Acrobat scan PDFs from the corpus): links work, bookmarks go to the right pages, items are where placed.
12. **Memory** (DevTools → Memory): open a few large PDFs as inserts and scroll the thumbnails. Note the heap size for the record.

---

## 5. Risks and blind spots

- **The migration is one-way.** Once version 3 has opened, an older build can't read the drafts. Acceptable on a branch; test it on a copy of real drafts (chunk 1's check).
- **Drafts pile up**, now that Start over keeps the old one. Watch it; bulk cleanup is out of scope for now.
- **The same PDF stored twice** when two drafts use it. Shared storage is out of scope; measure in chunk 6.
- **Matching cost:** `matching` reads every draft to find users of a hash. Fine for tens of drafts; an index on source ids (`multiEntry`) if it isn't.
- **Names:** with no "original", the draft's name is the first file's name and never changes. Naming is out of scope, but the banner and Recent should describe drafts well enough to tell apart.

## 7. After the PR

- **Deleting every page** is allowed: the document is left with one blank page the size of page 1, in the same undo step. (`deletePages(state, pages, blank)`; the panel makes the blank page first.) It was refused before, but drafts no longer depend on the opened PDF, so nothing needs a page of it.
- **"New" dot on the Pages rail button:** orange, top right, and the tooltip ends "· New". It goes once the Pages tool is first opened, remembered in `localStorage` (`pdf-flex:seen-tools`). `NEW_TOOLS` in `ToolRail.tsx` lists tools to mark this way.
- **Your checks:**
  1. In a fresh profile (or after removing `pdf-flex:seen-tools`), the Pages button has an orange dot in light and dark mode. Open Pages: the dot goes, and stays gone after a reload.
  2. Select every page (Shift+click) and press Delete, or × the only page. One blank page the size of page 1 is left, with no message. Undo brings all the pages and their items back.

