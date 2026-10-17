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
| 1 | Page list model | Insert/delete/move are pure functions with unit tests; placements remap; undo covers both | 🔜 |
| 2 | Viewer renders the page list | A document whose slots come from two PDFs displays, zooms and accepts placements | ⬜ |
| 3 | Assembly at download | Download of an edited page list gives the right pages, with items where they were placed; Bun test over the corpus | ⬜ |
| 4 | Pages panel: delete and blank page | Delete and add blank pages from the panel, undo them, download | ⬜ |
| 5 | Insert from another PDF | Insert all or some pages of another PDF anywhere, by button or drop | ⬜ |
| 6 | Drafts | Reloading restores inserted and deleted pages | ⬜ |
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

### Chunk 2: Viewer renders the page list
- `PageView` takes a slot and asks the slot's source for its pdf.js page. `Viewer` iterates slots instead of `1..numPages`.
- Page sizes come from slots (each source's pdf.js sizes, already checked against the stamper when it was added).
- Closing a tab closes every source's pdf.js document.
- **Your check:** with the flag off, viewing, zoom, scroll position across tabs and placing items all behave as before.

### Chunk 3: Assembly at download
- `download/assemble.ts`: if the slots are the untouched original, return the original bytes. Otherwise call `extractPages` with one entry per contiguous run of the same source, in final order. Blank pages come from a generated one-page PDF.
- Then `inspectPdf` on the result and `sameLayout` against the slots (refuse with a clear message on mismatch), then `stampPdf` as today.
- `assemble.test.ts` (Bun) runs combinations over the corpus and checks:
  - the page count and sizes are right;
  - the stamper accepts the result;
  - text placed on an inserted page reads back with `pdftotext` on that page.
- **Your check:** download a document with pages inserted from a rotated fixture and a form; open it in Chrome and Acrobat. Pages are in order, items sit where placed, form fields still work.

### Chunk 4: Pages panel: delete and blank page
- `pages/PagesPanel.tsx`: virtualised thumbnail list rendered by pdf.js at a small scale, with the current page highlighted. Clicking a thumbnail scrolls to it.
- **×** and Delete remove the selected pages. A status-bar hint says how many items went with them (undo restores).
- **＋** between thumbnails: *Blank page* (size of the page before it, or after it at the start).
- **Your check:** delete a page with items, undo, redo; add blank pages at the start, middle and end; download; try to delete the last page.

### Chunk 5: Insert from another PDF
- *Insert PDF…* (at the ＋ position) and *Add PDF…* (append) open a file picker. Dropping a PDF on the panel inserts it at the drop line.
- The file is checked with `inspectPdf` (encrypted, damaged and restricted files are refused as when opening), then opened with pdf.js and checked with `sameLayout`.
- Multi-page files open the range dialog (All / `1-3, 5`, thumbnails); single-page files go straight in.
- The same file inserted twice shares one source (keyed by its SHA-256, as drafts already are).
- **Your check:** insert a whole PDF before page 1, between pages and at the end; insert a range; insert by drop; insert a password-protected PDF (refused with a clear message); undo each.

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
