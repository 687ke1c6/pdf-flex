# pdf-flex — Pages plan (spike)

A spike, behind a feature flag: **insert or append pages from other PDFs** into the open document, and the everyday page operations that come with it: **add a blank page** and **delete pages**. If the spike holds up, the flag comes off and this becomes a normal phase like [toolbox-plan.md](toolbox-plan.md).

The ground rules don't change: everything runs in the browser, nothing is uploaded, the original file is never modified, and every change can be undone.

---

## 1. Scope

**In scope (spike)**
- A feature flag that hides all of this until it's turned on.
- A **page list** per document: which page of which source PDF goes where. Page operations edit this list. They don't edit bytes.
- **Insert pages from another PDF** at any position (before page 1, between pages, at the end), all of its pages or a chosen range.
- **Add a blank page** (same size as its neighbour) and **delete pages**.
- Placed items move with their page; deleting a page removes its items; all of it is one undo step.
- Download writes the assembled document, then stamps it, as today.

**Out of scope for the spike** (candidates afterwards)
- Reorder by drag (the model supports it; the UI comes after insert and delete feel right)
- Rotate pages, duplicate pages, split / extract pages to a new file
- Merging bookmarks (outlines) from inserted files; links from one source to another
- Inserting images as pages (pdf.js supports it; see §2)

---

## 2. Feasibility: can our current dependencies do this?

**Yes, with no new dependency.** We already ship two PDF engines, and both can do it:

| Option | New dependency | Bundle cost | Fidelity | Our effort |
|---|---|---|---|---|
| **A. pdf.js `extractPages`** (pdfjs-dist 6.3, already the viewer) | none | 0 | Good: built for Firefox's page organiser. Handles inherited attributes, form fields, tagged structure | Small: one call |
| B. lopdf merge in `pdf-stamp` (already the stamper) | none | small (+ our code in WASM) | Only what we write. lopdf's merge example is naive: it drops inherited `/Rotate` `/MediaBox` `/Resources`, AcroForm fields, links, the structure tree | Large: weeks of corpus work for the edge cases |
| C. pdf-lib | yes | ~+500 KB min | Fair: `copyPages` is solid but forms merge poorly. Unmaintained since 2021 | Small |
| D. qpdf compiled to WASM | yes | ~+1.5–2 MB | Best (qpdf is the reference tool) | Medium: build tooling, licensing |

**Probe, run under Bun against the corpus (not a browser):** `extractPages` merged `word-pdfmaker-tagged.pdf` + pages 1–2 of `irs-w9-xfa-form.pdf` + `rotate-270-inherited.pdf` in about 70 ms. Results:
- `qpdf --check` passes.
- The inherited 270° rotation survives.
- All 23 form fields and the structure tree survive.
- `pdf-stamp`'s `inspect` reads the result and agrees with pdf.js on every page size.

**Decided: option A.** Trade-offs we accept:
- **Two writers in the pipeline.** pdf.js assembles, then lopdf rewrites to stamp. The probe shows lopdf reads pdf.js output fine. A Bun test over the corpus keeps it honest.
- **A young API.** `extractPages` is recent and its options are intricate (`insertAfter` / `pageIndices`). Mitigations: pdfjs-dist is already pinned to an exact version, all calls go through one module (`assemble.ts`), and a Bun test catches behaviour changes on upgrade. We only use the simplest form: one entry per contiguous run, in final order.
- **pdf.js ignores owner-password restrictions,** so it would happily merge files the stamper refuses today. Every inserted file goes through the stamper's `inspect` first and is refused with the same message as when opening it.
- **Blank pages** aren't something `extractPages` makes. A tiny one-page PDF of the right size is generated in TypeScript (a few hundred bytes) and inserted like any other source.
- If A ever falls short, B is the fallback. It keeps everything in Rust but costs the edge-case work above.

---

## 3. Decisions

Settled 2026-10-17 unless marked otherwise.

| # | Question | Proposal |
|---|---|---|
| 1 | Library | **pdf.js `extractPages`** (§2), no new dependency. *Decided* |
| 2 | When pages are assembled | **At download only.** The editor keeps a page list (`{ source, index }` per slot) and renders each slot from its source's pdf.js document. Undo stays cheap, nothing is rewritten while editing, and an untouched list takes exactly today's path |
| 3 | Placed items and page changes | Placements keep their 1-based `page`. Each page operation remaps them in the same history step (history holds `{ slots, placements }`). Deleting a page removes its items; undo brings both back |
| 4 | Feature flag | `flags.ts`, switched only from **Settings → Experimental** and remembered in `localStorage` (`pdf-flex:flags`). No URL parameter: the spike lives on its own branch. Flag off: no Pages tool, and the app behaves exactly as today |
| 5 | UX entry point | **A "Pages" tool on the rail** with a thumbnail panel (§4, option 1). *Decided* |
| 6 | Drafts | Spike: page edits **are** saved in drafts (the inserted PDFs go into `draftFiles`, the page list into the draft). Without this, autosave would silently lose work. Optional fields, so old drafts still load. *Decided* |
| 7 | Deleting the last page | Refused; a document always has at least one page |
| 8 | Digitally signed documents | Unchanged: the existing warning already says editing invalidates the signature |

---

## 4. User experience: options

All three can share the same model. They differ in where page actions live.

**1. Pages panel (chosen for the spike).** A "Pages" tool on the rail (key P). Its panel lists page thumbnails:
- Hovering between two thumbnails shows a **＋** insertion line: *Insert PDF…* or *Blank page*.
- Each thumbnail has **×** to delete. Ctrl/Shift-click selects several; Delete removes them.
- **Add PDF…** at the bottom appends. Dropping a PDF on the panel inserts it at the drop position. Dropping it anywhere else still opens it in a new tab, as today.
- A multi-page PDF opens a small dialog: *All pages* or a range (`1-3, 5`), with thumbnails. Single-page PDFs go straight in.
- Fits the rail/panel layout, keeps the page in view while you work, and is cheap to build.

**2. In the document.** A **＋** bar appears on hover in the gap between pages. A small ⋯ menu on each page offers *Insert before/after*, *Delete*. Discoverable while scrolling, but crowded on small screens and fiddly with the existing drag and pan.

**3. Organise view.** A full-window thumbnail grid that replaces the viewer (like Acrobat's "Organize pages"). Best for big reshuffles and drag reorder. Biggest to build; overkill until reorder is in.

Decided: build 1 now. Add 2's per-page menu later if the panel feels too far from the page. Keep 3 for when reorder and rotate arrive.

---

## 5. Roadmap

**Status key:** ✅ done · 🔜 next · ⬜ not started

| # | Chunk | Done when | Status |
|---|---|---|---|
| 0 | Feature flag | Flag off: nothing changes. Flag on: a placeholder Pages tool appears | ✅ (pending your check) |
| 1 | Page list model | Insert/delete/move are pure functions with unit tests; placements remap; undo covers both | ✅ (pending your check) |
| 2 | Viewer renders the page list | A document whose slots come from two PDFs displays, zooms and accepts placements | ✅ (pending your check) |
| 3 | Assembly at download | Download of an edited page list gives the right pages, with items where they were placed; Bun test over the corpus | ✅ (pending your check) |
| 4 | Pages panel: delete and blank page | Delete and add blank pages from the panel, undo them, download | ✅ (pending your check) |
| 5 | Insert from another PDF | Insert all or some pages of another PDF anywhere, by button or drop | ✅ (pending your check) |
| 5b | Insert dialog and thumbnail size | ＋ opens a dialog (blank page, or choose/drop a PDF); two thumbnail sizes | ✅ (pending your check) |
| 6 | Drafts | Reloading restores inserted and deleted pages | 🔜 |
| 7 | Spike review | Decide: flag off and ship, adjust, or switch to option B | ⬜ |

### Chunk 0: Feature flag
- `web/src/common/flags.ts`: `flag("pages")`, switched from an "Experimental" section in Settings and remembered in `localStorage` (wrapped in try/catch).
- `ToolRail.tsx`: `pages` appears in the tool list only with the flag on.

**As built**
- **`flags.ts`:**
  - `FLAGS` maps each flag to its Settings label.
  - `parseFlags` reads the stored list, ignoring unknown names, and is unit-tested.
  - `flag(name)` is reactive and `setFlag` stores the change.
- **Settings:** an "Experimental" section, always shown, with one checkbox per flag.
- A first version also turned flags on with `?flags=pages` in the URL. It was dropped: the spike is on a branch, so the Settings switch is enough.
- **`ToolRail.tsx`:**
  - `PanelTool` gains `"pages"` (key **P**, a stacked-pages icon).
  - `PANEL_TOOLS` became the reactive `panelTools()`, and `isToolEnabled` was added. The rail, the P shortcut, `isPanelTool` and the remembered tools all go through them, so with the flag off Pages can't be reached, even from a saved `pdf-flex:tool`.
  - An effect in the editor sends a disabled tool back to Select (and the quick bar's last tool back to Signatures) when the flag is turned off.
- **`pages/PagesPanel.tsx`:** a placeholder panel. With the Pages tool, a click on a page does nothing (`PageOverlay`), and the status bar hint says page tools are coming.
- **Verified (no browser):** `just test` (Rust, plus 92 web tests with 1 new for flags), `just lint` and `just build` pass.
- **Your checks:**
  1. `just dev`, open a PDF: no Pages tool, and P does nothing. Settings shows Experimental with "Page tools" unticked.
  2. Tick it: a Pages button appears last on the rail, and P opens its panel. Clicking a page does nothing; the hint reads "Experimental: …".
  3. Reload: Pages is still there, and the tool you left on is restored.
  4. Untick it while the Pages tool is open: the button goes, the tool falls back to Select, and the quick bar's third button goes back to Signatures if it was Pages.

### Chunk 1: Page list model
- `document/pages.ts`:
  - `Slot { key, source, index, size }` and `Source { id, name, bytes, pdf: LoadedPdf }`.
  - Pure functions `insertSlots`, `deleteSlots`, `moveSlots`, each returning new slots plus a `page → page | null` map for remapping placements.
- `DocState` gains `slots` and `sources`. Opening a file makes one source and one slot per page, so nothing else changes yet.
- History snapshots become `{ slots, placements }`. `isDirty` compares both.
- Tests: remapping at the start, middle and end; deleting pages with items; undo/redo round trips; the last page can't be deleted.

**As built**
- **`document/pages.ts`:**
  - `Slot { key, source, index, width, height }` and `PagesState { slots, placements }` (one undo step).
  - `slotsOf(source, pages)`, `isUntouched` (for chunk 3's "nothing to assemble").
  - **One remapping rule, `rearrange(state, slots)`:** each placement follows its slot's key to its new position, and placements whose slot is gone are dropped. `insertSlots`, `deletePages` (`undefined` if it would leave no pages) and `movePages` only build the new slot list.
  - Keys make the same source page safe to have twice: items stay on their own copy.
- **`DocState`:**
  - The fixed `pages` array became a `slots` signal, created from the source's id (`createDocState(pages, id)`), with `nextSlotKey`.
  - `history` is `History<PagesState>`; `stateOf(d)` takes a snapshot.
  - `isDirty` / `markSaved` compare `savedKey(slots, placements)`: pages by source and index (not key), plus placements.
- **Editor:**
  - Every checkpoint is now `{ slots, placements }`, and undo/redo restore both. The in-place text edit still records placements and pairs them with the current slots; page operations end an edit first.
  - New, not called from the UI yet: `slots()`, `insertPages(at, newSlots)`, `deletePages(pages)` (false if it would delete every page), `movePages(pages, at)` (no step if nothing moves).
  - `pageSize` reads the slots, so it follows page changes.
- **Moved to chunk 2:** sources (bytes plus pdf.js document per source). Nothing renders from them yet, and the viewer still draws the original's pages.
- **Moved to chunk 6:** autosave still versions placements only.
- **Verified (no browser):** `just test` (Rust, plus 101 web tests with 9 new in `pages.test.ts`), `just lint` and `just build` pass.
- **Your checks** (a regression pass, since nothing new is visible yet): place, move, resize, edit text, delete, then undo and redo each step back and forth. Unsaved changes → Downloaded after a download. Switching tabs keeps each document's undo history.

### Chunk 2: Viewer renders the page list
- `PageView` takes a slot and asks the slot's source for its pdf.js page. `Viewer` iterates slots instead of `1..numPages`.
- Page sizes come from slots (each source's pdf.js sizes, already checked against the stamper when it was added).
- Closing a tab closes every source's pdf.js document.
- **Your check:** with the flag off, viewing, zoom, scroll position across tabs and placing items all behave as before.

**As built**
- **Sources:**
  - `Source { id, name, bytes, pdf }` (`pages.ts`). `DocState.sources` is a plain map that is only ever added to: an undo can bring back a page whose source is no longer in the list.
  - The session registers the original under the document id, and `dispose` closes every source.
  - `editor.addSource` returns the source already there for the same file.
- **Viewer:**
  - Iterates `doc.slots()` (prop `doc: DocState` instead of `pdf: LoadedPdf`), keyed by slot, so a moved page keeps its element and canvas.
  - `PageView` takes `doc` + `sourcePage` (what to render) apart from `pageNumber` (its position, for the overlay).
  - Page elements are read from the DOM instead of an index-assigned array. The visibility observer is reset whenever the slots change.
  - Fit width uses the slots' widths.
- **App:** the page count in the page box and the title comes from the slots.
- **Scaffolding, replaced by chunks 3–5:**
  - **Append PDF…** in the Pages panel adds every page of a PDF at the end. `pages/source.ts` (`sourceFrom`) is kept for chunk 5: same file → same source, the stamper's `inspectPdf` first (so restricted files are refused), then pdf.js, then `sameLayout`.
  - **Download** refuses with a message while the page list isn't the untouched original.
- **Known gap until chunk 6:** autosave doesn't store pages yet. A draft saved after appending pages, restored later, has items on pages that don't exist (hidden, and download fails). Flag-only.
- **Verified (no browser):** `just test` (Rust, plus 101 web tests), `just lint` and `just build` pass.
- **Your checks:**
  1. **Flag off** (regression): open, scroll, zoom (buttons, Ctrl+wheel, pinch), fit width, go to page, scroll position when switching tabs, place and drag items across pages, download.
  2. **Flag on:** Pages tool → **Append PDF…** with a rotated fixture (`out/fixtures/rotate-90.pdf`), then a different-size one. The new pages appear at the end, sharp at any zoom, and the page count updates.
  3. Place items on an appended page and drag one across to an original page. Undo removes the appended pages and the items on them; redo brings them back.
  4. Append the same file twice: both copies render (it's one source).
  5. Append `crates/pdf-stamp/tests/corpus/generated/encrypted-user-password.pdf`: refused with the "password-protected" message.
  6. Download after appending: refused with the "not ready yet" message.

### Chunk 3: Assembly at download
- `download/assemble.ts`: if the slots are the untouched original, return the original bytes. Otherwise call `extractPages` with one entry per contiguous run of the same source, in final order. Blank pages come from a generated one-page PDF.
- Then `inspectPdf` on the result and `sameLayout` against the slots (refuse with a clear message on mismatch), then `stampPdf` as today.
- `assemble.test.ts` (Bun) runs combinations over the corpus and checks:
  - the page count and sizes are right;
  - the stamper accepts the result;
  - text placed on an inserted page reads back with `pdftotext` on that page.
- **Your check:** download a document with pages inserted from a rotated fixture and a form; open it in Chrome and Acrobat. Pages are in order, items sit where placed, form fields still work.

**As built**
- **`download/assemble.ts`:**
  - `runsOf(slots)`: one entry per run of *consecutive ascending* pages of one source. A repeated or backwards page starts a new run, so we never depend on how pdf.js orders `includePages`.
  - `assemble(base, baseId, slots, bytesOf)`: the original's own runs use `document: null`. Other sources get a fresh copy of their bytes, as pdf.js may transfer the buffer.
  - `pagesPdf(doc, originalId)`: the original's bytes if the pages haven't changed. Otherwise the assembled PDF, checked with the stamper's `inspectPdf` + `sameLayout` against the slots, refusing with a user-facing message on any mismatch or pdf.js error.
- **`DocState.pagesChanged()`** compares against the pages as opened. It replaced `isUntouched`.
- **App:**
  - Download stamps `pagesPdf(…)` instead of the original bytes, and the chunk 2 refusal is gone.
  - Download is enabled when there are items *or* changed pages (`hasChanges`), so delete-only edits can be saved.
- **Tests:**
  - **`assemble.test.ts` (3, real pdf.js under Bun):**
    - The run grouping.
    - Seven pages from three corpus files (A4 with an inherited rotation, Letter, `/UserUnit`), out of order, repeated and interleaved with the base's own pages, come out in order at the right sizes.
    - The W-9's 23 form widgets arrive on the inserted page, and the tagged base keeps its structure tree. `getFieldObjects` can't be the check: it returns nothing for the W-9 even untouched, because it's an XFA form.
  - **`crates/pdf-stamp-wasm/assemble.ts`, run by `just wasm-smoke`:** assembles 7 pages from 4 PDFs (including the W-9, a `/Rotate 90.0` page and a `/UserUnit` page), then checks with the WASM stamper:
    - `inspect` agrees on every size;
    - a text marker stamped on every page is found by `pdftotext -cropbox -bbox` on that page, about 20 pt from the bottom-left as shown. Sizes alone can't catch a flipped rotation (90° and 270° pages are the same size). Poppler ignores `/UserUnit`, so its numbers are scaled;
    - `qpdf --check` passes.
- **Not checked yet (chunk 7):** links and bookmarks from inserted files. After a download with only page changes, the status bar shows neither "Unsaved changes" nor "Downloaded" ("Downloaded" needs items). Minor; to tidy with the panel.
- **Verified (no browser):** `just test` (Rust, plus 104 web tests), `just lint`, `just build` and `just wasm-smoke` pass. Assembling 7 pages takes about 50 ms.
- **Your checks** (with the flag on, using **Append PDF…**):
  1. Append `out/fixtures/rotate-90.pdf` and `crates/pdf-stamp/tests/corpus/real/irs-w9-xfa-form.pdf` to a document. Place a signature, text and a shape on an original page, a rotated appended page and a W-9 page. Download, then open the file in Chrome and Acrobat: all pages are in order, every item sits exactly where it was placed, and the W-9's fields can still be filled in.
  2. Append a PDF without placing anything: Download is enabled and the file has the extra pages.
  3. Undo the append, then download: you get the original pages only.
  4. With the flag off, a normal sign-and-download is unchanged.

### Chunk 4: Pages panel: delete and blank page
- `pages/PagesPanel.tsx`: virtualised thumbnail list rendered by pdf.js at a small scale, with the current page highlighted. Clicking a thumbnail scrolls to it.
- **×** and Delete remove the selected pages. A status-bar hint says how many items went with them (undo restores).
- **＋** between thumbnails: *Blank page* (size of the page before it, or after it at the start).
- **Your check:** delete a page with items, undo, redo; add blank pages at the start, middle and end; download; try to delete the last page.

**As built**
- **`pages/blank.ts`:** `blankPdf(width, height)` writes a three-object PDF with an exact cross-reference table. Tests cover pdf.js opening it at the right size with no content, and every xref entry pointing at its object; `qpdf --check` was checked once. Blank sources are `blank:WxH`, so the same size is one source, and drafts (chunk 6) can regenerate them instead of storing them.
- **`pages/source.ts`:** `blankSource` added next to `sourceFrom`.
- **`pages/Thumbnail.tsx`:** renders a page 112 px wide (at device pixel ratio) the first time it comes within 300 px of view, then keeps it. Its box keeps the page's proportions before it renders.
- **`pages/PagesPanel.tsx`:**
  - **Header:** the page count (or "Adding…") and **Add PDF at the end…**.
  - **Thumbnails** with page numbers. The page in view has a grey border; selected pages are blue.
    - Click selects and scrolls to the page; Ctrl/Cmd+click toggles; Shift+click selects a range.
    - Up/Down move the selection (and focus).
  - **Deleting:**
    - **×** on a page deletes it, or every selected page if it's one of them. Delete/Backspace delete the selection.
    - The keys are handled on the list and stopped there, so App's handler never also deletes selected items.
    - Deleting every page is refused with a message.
  - **Inserting:** a **＋** in each gap (before the first page, between pages, after the last) opens **Blank page** (the size of the page before it, or after it at the start) and **PDF…** (every page of the chosen PDF, at that position). This replaced chunk 2's Append scaffold.
  - **Tabs:** selection and the open gap reset when the active document changes; slot keys are only unique within a document.
- **Sidebar/App:** the panel gets the page in view and `goToPage`.
- **Status bar:**
  - The Pages hint describes the panel.
  - "Downloaded" also shows after a download with only page changes (fixes the chunk 3 nit).
- **`just wasm-smoke`:** the assembly check now includes a generated blank page (8 pages).
- **Not done:** drag to reorder (out of scope), and freeing far-away thumbnails (they're small: about 0.4 MB each at 2× pixel ratio; chunk 7 measures).
- **Verified (no browser):** `just test` (Rust, plus 107 web tests with 3 new for blank pages), `just lint`, `just build` and `just wasm-smoke` pass.
- **Your checks** (flag on, Pages tool):
  1. Thumbnails match the pages (rotated and landscape ones too). The page in view is outlined as you scroll the document; clicking a thumbnail scrolls there.
  2. Hover between thumbnails: a blue line with ＋. Click it and choose **Blank page** at the start, middle and end; each takes its neighbour's size.
  3. **PDF…** in a gap inserts that PDF there; **Add PDF at the end…** appends.
  4. Place an item on a page, then delete the page with × (the item goes too). Undo brings both back; redo removes them again.
  5. Select pages with Ctrl+click and Shift+click, then press Delete: only those pages go. Placed items elsewhere stay, and the Delete key doesn't also delete a selected item.
  6. Try deleting every page: refused with a message.
  7. Download: pages in panel order, blank pages blank, items where placed. "Downloaded" shows afterwards.
  8. Touch screen or narrow window: ＋ and × are always visible.
  9. With two tabs open, select pages in one, switch tabs, press Delete: nothing is deleted in the other.

### Chunk 5: Insert from another PDF
- *Insert PDF…* (at the ＋ position) and *Add PDF…* (append) open a file picker. Dropping a PDF on the panel inserts it at the drop line.
- The file is checked with `inspectPdf` (encrypted, damaged and restricted files are refused as when opening), then opened with pdf.js and checked with `sameLayout`.
- Multi-page files open the range dialog (All / `1-3, 5`, thumbnails); single-page files go straight in.
- The same file inserted twice shares one source (keyed by its SHA-256, as drafts already are).
- **Your check:** insert a whole PDF before page 1, between pages and at the end; insert a range; insert by drop; insert a password-protected PDF (refused with a clear message); undo each.

**As built**
- **Inserting at a position** (＋ → PDF…, Add PDF at the end…) and the `sourceFrom` checks came in chunk 4.
- **`pages/ranges.ts`:**
  - `parseRanges(text, count)` gives sorted, de-duplicated 0-based pages or a user-facing message. It accepts `1-3, 5`, spaces, semicolons and en dashes. `4-` runs to the end; `5-3` means `3-5`.
  - `formatRanges` writes pages back as `1-3, 5`.
  - 3 tests.
- **`pages/PageRangeDialog.tsx`** opens for any PDF with more than one page:
  - Options are **All pages** or **Pages [1-3, 5]**, and an error shows inline while the range is wrong.
  - A grid of thumbnails toggles pages and rewrites the range text, and typing updates which thumbnails are picked.
  - The button reads **Insert N pages**. Escape or Cancel inserts nothing, and a source opened just for this is closed again.
- **Panel:**
  - `insert` asks the dialog (promise-based, like `askConfirm`) and returns how many pages went in.
  - **Drop** PDFs on the thumbnail list: a thick line shows the gap nearest the pointer, and the files go in there, one after another, each through the dialog if it has several pages.
  - Non-PDFs are refused with "That doesn't look like a PDF."
- **App:** its window drag handlers skip events a drop target already handled (`defaultPrevented`). So a PDF dropped on the panel isn't also opened in a tab, and "Drop to open" doesn't show over the document while dragging over the panel. The page overlay only prevents default for signature drags, which App ignored already, so nothing else changes.
- **Verified (no browser):** `just test` (Rust, plus 110 web tests), `just lint` and `just build` pass.
- **Your checks** (flag on, Pages tool):
  1. ＋ → PDF… with a multi-page PDF (e.g. `out/many-pages.pdf` or the W-9): the dialog opens with thumbnails. Insert all; then again with `2-3, 5`; then by clicking thumbnails (the text follows). Each set lands at the chosen gap in order.
  2. Type a bad range (`9`, `1-2-3`, empty): the error shows and Insert is disabled. Enter doesn't insert.
  3. Cancel and Escape insert nothing.
  4. A one-page PDF goes straight in without the dialog.
  5. Drag a PDF over the thumbnails: a line follows the pointer between pages, and the document doesn't show "Drop to open". Drop: it's inserted there and not opened in a tab. Drop two PDFs at once: both go in, in order.
  6. Drop a PNG on the list: refused with a message. Drop a PDF on the document instead: it still opens in a tab as before.
  7. Password-protected PDF (`crates/pdf-stamp/tests/corpus/generated/encrypted-user-password.pdf`) by button and by drop: refused with the "password-protected" message.
  8. Undo each insert.

### Chunk 5b: Insert dialog and thumbnail size
UX changes after trying chunks 4–5.
- **＋ opens an Insert dialog** (`pages/InsertDialog.tsx`) instead of unfolding buttons in the gap:
  - Its title says where ("Insert before page 3", "Insert at the end").
  - **Blank page** is a large button that names the size it copies ("Same size as page 2: A4", "… Letter landscape", or points).
  - **Drop a PDF here / Choose a PDF…** is a drop zone styled like the start screen's.
  - The PDF is read and checked inside the dialog, so a refusal (password-protected, not a PDF) shows there and another can be tried. On success the dialog closes and the page-range dialog opens for multi-page PDFs.
  - The whole dialog takes drops, so a near miss doesn't make the browser open the file.
  - Cancel and Escape are blocked for the moment a PDF is being read, so nothing is left open with nowhere to go.
- **"Add PDF at the end…" removed:** the ＋ after the last page does it. Maybe back later.
- **＋ centred:** drawn as an SVG cross instead of a "+" character, whose glyph sits off-centre in the round button.
- **Thumbnail size:** a Large/Small switch in the panel header, remembered in `localStorage` (`pdf-flex:thumb-size`). Small is 78 px wide (about 30% smaller). Thumbnails are always rendered at the large size, so switching re-renders nothing and small ones stay sharp.
- **Bug avoided:** the dialog is keyed on the gap position, and position 0 (before page 1) would have read as "no dialog". It's wrapped in an object.
- **Verified (no browser):** `just test` (Rust, plus 110 web tests), `just lint` and `just build` pass.
- **Your checks:**
  1. ＋ before page 1, between pages and after the last: the dialog opens with the right title. Blank page names the neighbour's size and inserts it there.
  2. Choose a PDF… and drop a PDF on the dialog: a multi-page PDF goes on to the range dialog, a one-page PDF goes straight in, at that gap.
  3. Drop a PNG or the password-protected PDF on the dialog: the error shows in the dialog, which stays open; then drop a good PDF.
  4. Drop a PDF on the dialog's edge (outside the drop zone): taken, not opened by the browser.
  5. The ＋ sits dead centre in its circle.
  6. Thumbnail size: Small shrinks thumbnails (still sharp) and Large restores them; the choice survives a reload. Dropping PDFs between thumbnails still works at both sizes.
  7. No "Add PDF at the end…" button.

### Chunk 6: Drafts
- The draft gains optional `sources` (ids and names) and `slots`. The inserted PDFs go into `draftFiles` under their hash.
- Discarding a draft deletes source files that no other draft uses.
- **Your check:** insert and delete pages, reload, restore the draft. Everything is back, including items on inserted pages.

### Chunk 7: Spike review
- Measure memory with a few large inserted PDFs, and download time on `out/many-pages.pdf` plus inserts.
- Write up what to keep and what to change; decide whether the flag comes off.

---

## 6. Risks and blind spots

- **`extractPages` behaviour across pdf.js upgrades**: pinned version plus the Bun test (chunk 3).
- **Links and bookmarks** in inserted files: links within an inserted file should survive; bookmarks probably won't. To check in chunk 3 and note, not fix, in the spike.
- **Form field name clashes**: inserting the same form twice gives two fields with the same name, which viewers link (typing in one fills the other). Acceptable for the spike; note it.
- **Memory**: each source keeps its bytes and a pdf.js document open. Fine for a few files; chunk 7 measures it.
- **Page numbers** everywhere (status bar, "Place on page N", go to page) mean position in the page list, which is what users expect.
