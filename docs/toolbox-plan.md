# pdf-flex — Toolbox plan

pdf-flex started as a PDF signing app. The MVP is done: open a PDF, place signatures (imported, typed or drawn), save a new PDF, all in the browser, installable and offline. Its plan, with the architecture, decisions and blind spots that still apply, is frozen in [mvp-plan.md](mvp-plan.md).

This phase turns it into a small general PDF editor: **text** first, then **shapes and symbols**, with room for more tools later. The ground rules don't change: everything runs in the browser, nothing is uploaded, and the Rust `pdf-stamp` library writes the PDF.

---

## 1. Scope

**In scope**
- A **tool rail** on the left: Signatures, Text, Shapes. Each tool has its own panel; Save, undo/redo and the list of placed items stay put whatever tool is open
- **Text** written into the PDF as real text: sharp at any zoom, selectable, searchable and copyable in any viewer.
  - Fonts: Helvetica, Times and Courier (regular, bold, italic, bold italic), the PDF standard fonts, so nothing needs embedding.
  - Size, colour, multiple lines (Enter), left/centre/right alignment.
  - Typed on the page, in place.
- **Text in other fonts** (the bundled script fonts, more later) written as an image: looks the same, but isn't selectable.
- **Shapes and symbols** as vector graphics: rectangle, ellipse, line; ✓ ✗ ● ○ symbols for ticking forms. Stroke colour and width, optional fill.
- A **cover-up box** (a filled rectangle), clearly labelled as *not* redaction (§5.3).
- Everything already built keeps working: move, resize, cross-page drag, undo, nudge, unsaved-changes warning.

**Out of scope for this phase** (see §7)
- Text with automatic wrapping inside a fixed-width box
- Other fonts as real text (embedded TrueType), non-Latin scripts
- True redaction
- Filling AcroForm fields; page operations (merge, split, reorder, rotate, delete)
- Editing text that was already in the PDF

---

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | How text gets into the PDF | **Real PDF text with the standard 14 fonts** (option B). Not embedded; every viewer has them built in. Characters limited to **WinAnsi** (Western European Latin). Characters outside it are flagged while typing, and saving refuses them with a clear message |
| 2 | Other fonts | **Rendered as a PNG and stamped as an image** (option A), reusing the signature path. Shown as "image text" in the UI so it's clear it won't be selectable |
| 3 | Text layout | **Explicit lines only** (Enter starts a new line); the box sizes itself to the text. Wrapping to a fixed width is later. Covers labels, names, dates and filling in printed forms |
| 4 | Who measures text | **The web app**, using the fonts' official metrics (Adobe's AFM files for the standard 14). It needs them live for the on-screen box anyway. It sends Rust the lines and where each starts; Rust encodes and draws them. One layout, so screen and PDF match |
| 5 | On-screen preview fonts | **Arimo, Tinos and Cousine** (bundled, OFL), which are metrically compatible with Helvetica, Times and Courier. Each line is positioned by the layout from decision 4, so glyph differences never change line breaks or alignment |
| 6 | Symbols | **Vector paths**, not the ZapfDingbats font: they look the same in the preview (SVG) and the PDF, and need no character mapping |
| 7 | JS ↔ Rust interface | Placements go to WASM as **structured data** (`serde` + `serde-wasm-bindgen`) instead of flat number arrays, which can't carry text. Measure the WASM size; budget ≤ 1.2 MB raw |
| 8 | Output filename | `<name>-edited.pdf` (was `-signed.pdf`) |
| 9 | Hosting | Railway now (cache mounts removed from the Dockerfile for it). The Raspberry Pi deploy (MVP chunk 10) stays a "later" item |

---

## 3. Roadmap

Each chunk ends with something you can run and check, then a review and a commit. Numbering restarts; MVP chunks are referred to as "MVP chunk N".

**Status key:** ✅ done · 🔜 next · ⬜ not started

| # | Chunk | Done when | Status |
|---|---|---|---|
| 1 | Tool rail and panels | Signing works exactly as before, from the new layout | ✅ |
| 2 | Placements of different kinds | All existing tests pass on the new model; image-only output renders identically to before | ✅ (pending your check) |
| 3 | Text in `pdf-stamp` | `cargo test` stamps text on every corpus file; `pdftotext` reads it back exactly | 🔜 |
| 4 | Text tool in the app | Add and edit text in the browser; in the download it is selectable, searchable and where the preview showed it | ⬜ |
| 5 | Image text (other fonts) | Text in a script font saves as a crisp image, positioned as previewed | ⬜ |
| 6 | Shapes, symbols and cover-up box | Draw each shape and symbol, style it, save; it matches the preview in Chrome and Acrobat | ⬜ |

### Chunk 1: Tool rail and panels
A UI-only refactor; no behaviour changes.
- **Rail:** a narrow strip of icon buttons on the far left (`ToolRail.tsx`): Signatures now; Text and Shapes added by their chunks. The active tool is highlighted and remembered in `localStorage`. Each button has a tooltip and an accessible label.
- **Tool panel:** next to the rail, swapped by the active tool. `SignaturesPanel.tsx` takes over today's library section from `Sidebar.tsx` unchanged: library, Place on page N, New signature…, export/import.
- **Fixed area** under the tool panel, the same for every tool:
  - **Placed** list (renamed **On this document**), with undo/redo.
  - **Download PDF** (was "Download signed PDF"), saving as `<name>-edited.pdf`.
- **Wording:** user-facing messages that say "signed"/"can't be signed" in the app and the Rust errors become neutral ("can't be edited here"), except where it really is about digital signatures.
- **Narrow windows:** the rail stays; the panel collapses to an overlay opened from the rail.
- **Done when:** every MVP chunk 4–8 check still passes from the new layout.

**As built**
- `ToolRail.tsx` (tool list, inline SVG icons, remembered tool in `localStorage` under `pdf-flex:tool`, wrapped in try/catch), `SignaturesPanel.tsx` (the library section and `LibraryItem`, moved unchanged), and `Sidebar.tsx` (rail + active panel + fixed area).
- **Collapsing:** clicking the active tool's button hides or shows the panel at any width, not only on narrow windows. The fixed area (On this document, Download) collapses with it.
- **Narrow windows** (≤ 640 px): the panel starts closed and floats over the document, next to the rail.
- **Wording:** "Download PDF", saved as `<name>-edited.pdf`; unsaved-changes prompt, open-time warnings, About text and page description no longer assume signing. Rust errors say "can't be edited", and `BadPlacement` now reads "Placed item N has an invalid position or size." (1-based).
- **Verified (no browser):** `just test` (Rust and 25 web tests), `just lint`, `cargo fmt --check` and `just build` pass.
- **Your checks:**
  1. `just dev`, open a PDF: the rail shows the Signatures button, highlighted, with the panel next to it.
  2. Everything from MVP chunks 4–8 works from the panel: place by drag and by button, move, resize, cross-page drag, undo/redo, nudge, delete, rename, export/import, New signature….
  3. Click the Signatures button: the panel hides and the document widens; click again to bring it back.
  4. Download: the file is `<name>-edited.pdf`.
  5. Narrow the window below 640 px and reload: the panel starts closed and opens over the document.

### Chunk 2: Placements of different kinds
The model change everything after this builds on, made with only the existing kind so it can be verified on its own.
- **Web** (`placement.ts`): `Placement` becomes a box plus a `kind`:
  ```ts
  type Placement = { id: string; page: number } & Box & (
    | { kind: "image"; signatureId: string }
    | { kind: "text"; ... }    // chunk 4
    | { kind: "shape"; ... }   // chunk 6
  );
  ```
  Move, cross-page drag, nudge, clamping, undo and unsaved-changes tracking work on the box and stay kind-agnostic. Each kind supplies how it's drawn on the overlay, how it resizes, and its list label.
- **Resizing per kind:** aspect-locked (today's `resized`) for images, text and symbols; free (Shift locks) for rectangles and ellipses, which needs a `resizedFree`.
- **Rust** (`pdf-stamp`): `Placement { page, x, y, width, height, item: Item }` with `enum Item { Image { image: usize } }`. Each page still gets one `q … Q` block appended; each item writes its own operators inside it.
- **WASM:** `stamp(pdf, images, imageLengths, placements: JsValue)` deserialised with `serde-wasm-bindgen`. Note the size change.
- **Tests:** existing Rust, corpus and web tests updated to the new types. A new test checks that image-only output renders pixel-identically to the MVP's output on the generated fixtures.

**As built**
- **Web** (`placement.ts`): `ImagePlacement` (`kind: "image"`, `signatureId`) is the only member of the `Placement` union so far. `keepsAspect(kind)` decides the resize mode; `resizedFree` is wired into the overlay (Shift locks proportions for free kinds) but unused until shapes arrive. Kind switches in the overlay (what's drawn), the Placed list (label), save (which images to send) and `toStampArgs`.
- **Rust:** `Placement { item: Item, page, x, y, width, height }`, `enum Item { Image { image } }`. `Placement` is no longer `Copy` (text will hold strings), so a few tests clone. Serde derives sit behind a `serde` feature of `pdf-stamp`, enabled only by the WASM crate, so the library stays free of binding concerns.
- **WASM:** `stamp(pdf, images, imageLengths, placements)` takes an array of `{ page, x, y, width, height, item: { kind: "image", image } }`. Bad input reads e.g. "invalid placements: unknown variant `video`, expected `image`". The demo page and `smoke.ts` use the new form.
- **Size:** 1,059,608 bytes raw, up 33.7 KB from 1,025,853 (`serde-wasm-bindgen` 0.6.5). Within the 1.2 MB budget.
- **Identical output, checked once instead of by a permanent test:** stamping is deterministic, so the outputs of `just fixtures` and the corpus test (28 PDFs) were saved before the change and compared afterwards: **byte-identical**. A golden-file test would break on every intended output change in later chunks, so it wasn't added.
- **Verified (no browser):** `just test` (Rust, plus 29 web tests with 4 new for `resizedFree`), `just lint`, `cargo fmt --check`, `just wasm-smoke` and `just build` pass.
- **Your checks:** sign a PDF end to end as before: place two different signatures on several pages (including a rotated one), move, resize, drag across pages, undo/redo, delete; download and open the result. The Placed list still names each signature, and deleting a signature from the library is still refused while it's placed.

### Chunk 3: Text in `pdf-stamp`
- **New `Item::Text`:** font (one of the 12 standard text fonts), size, colour (RGB), and lines, each `{ text, x, y }` relative to the placement box (the baseline start, from the web app's layout).
- **Fonts:** a `/Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding` dictionary per font used, added once per document, registered in each page's `/Resources /Font` under an unused name (`PdfFlexF0`, …), copying shared resources as images already do.
- **Content:** `BT /PdfFlexF0 12 Tf r g b rg x y Td (…) Tj … ET` per placement, inside the display-to-user transform already used for images, so rotated and cropped pages work unchanged.
- **Encoding:** Unicode → WinAnsi (cp1252) in Rust (`winansi.rs`), escaping `(`, `)` and `\`. An unsupported character fails with a message naming it ("The character 'ł' can't be written in Helvetica. Use image text for other characters."). NaN or non-positive sizes are refused, as for boxes.
- **Tests:**
  - Unit: encoding table, escaping, refusals.
  - Stamping: text on every rotation and CropBox fixture; `pdftotext -bbox` (poppler) finds each line, upright, inside its box.
  - Corpus: every file that should sign also takes a text placement; `qpdf --check` passes and `pdftotext` reads the text back.
- **CLI:** `just stamp-text in.pdf "Hello" out.pdf --page 1 --at X,Y --size 12`.

### Chunk 4: Text tool in the app
- **Metrics** (`web/src/fonts/metrics.ts`, generated by a script from Adobe's Core 14 AFM files and committed): advance widths for the 12 fonts over WinAnsi, plus ascender and descender. A unit test checks a few against known values.
- **Layout** (`textLayout.ts`, pure, unit-tested): text + font + size + alignment → box size and each line's baseline position. Line height 1.2 × size. Used for the preview, the box, and the stamp arguments.
- **Adding text:** with the Text tool open, click on a page to add a text box there and start typing; or **Add text to page N** in the panel. Empty text boxes disappear when you stop editing.
- **Editing:** double-click (or Enter on a selected box) to edit in place. A textarea sits over the box in the same font, size and colour. Escape or clicking away commits; one edit is one undo step.
- **Text panel:** with a text box selected, change font (Helvetica, Times, Courier), bold, italic, size, colour (a few presets plus a picker), and alignment. The panel's settings are also the defaults for the next box.
- **Resizing** a text box with a corner handle scales the font size (aspect locked), rounded to 0.5 pt.
- **Unsupported characters** are underlined in red while editing, with a hint offering image text (chunk 5). Save refuses with the Rust message if any slip through.
- **Placed list** shows the first words: "“Jane Smith” · page 2".
- **Your check:** add text on a normal and a rotated page in each font; download and, in Chrome and Acrobat, check it sits where the preview showed, and can be selected, searched (Ctrl F) and copied.

### Chunk 5: Image text (other fonts)
- The Text panel's font list gains a second group, **Image text**: the four bundled script fonts (Great Vibes, Dancing Script, Allura, Caveat).
- Previewed with the browser's own text rendering. On save, each such placement is drawn to a PNG at 300 DPI for its size (`document.fonts.load` first, as typed signatures do in `typedSignature.ts`) and sent as an image item. The Placed list and the panel mark it "image".
- **Your check:** place script-font text, download, zoom to 400% in a viewer: crisp and in place.

### Chunk 6: Shapes, symbols and cover-up box
- **New `Item::Shape`** in Rust: a list of path segments (move, line, cubic curve, close) in the box's coordinate space, plus stroke colour and width, and fill colour or none. Ellipses use the usual four-curve approximation. Everything is drawn with PDF path operators (`m l c h S f B`).
- **Shapes panel:** rectangle, ellipse, line. Drag on a page to draw one; click to add a default-sized one. Stroke colour, stroke width, fill (none or a colour).
- **Lines** are stored by their two endpoints and edited with two handles instead of corners.
- **Symbols:** ✓ ✗ ● ○ in the same panel, as fixed paths with locked aspect, sized like a 12 pt character by default, for ticking boxes on forms.
- **Cover-up box:** a rectangle preset, white fill and no stroke. The panel says under it: "Hides content on screen and in print. The text underneath is still in the file and can be copied. Not a redaction."
- **Preview:** the overlay draws shapes as SVG from the same path data that's sent to Rust.
- **Tests:** Rust render tests per shape on the rotation and CropBox fixtures (pixels inside and outside the box); web tests for path generation and free resizing.
- **Your check:** draw each shape and symbol on a normal and a rotated page, restyle them, save, and compare with the preview in Chrome and Acrobat. Put a cover-up box over text and confirm the warning is visible.

---

## 4. Architecture changes

What changes against [the MVP architecture](mvp-plan.md#6-architecture):

```
 Web app                                        pdf-stamp (WASM, in the worker)
 ─────────────────────────────────────────      ───────────────────────────────────────
 ToolRail ── SignaturesPanel / TextPanel /      stamp(pdf, images, placements)
             ShapesPanel                          placements: [{ page, x, y, w, h, item }]
 Fixed: On this document · undo · Download        item = Image { image }
                                                       | Text  { font, size, colour, lines }
 placements: [{ id, page, box, kind, … }]              | Shape { path, stroke, fill }
   image  → signature PNG                         per page: one q…Q block; fonts and images
   text   → textLayout (AFM metrics) → lines      added once per document, registered per page
   image text → canvas → PNG → image item
   shape  → path data (SVG preview = PDF path)
```

- **Display space stays the contract:** every item is placed by its box in display-space points; Rust alone handles CropBox and rotation.
- **One source of truth per item:** text lines come from one layout function; shape paths from one path builder. The preview and the PDF both draw from them.

---

## 5. Blind spots

### 5.1 Text that looks right on screen but not in the PDF
- Viewers draw the standard fonts with their own copies (Acrobat's, Chrome's Foxit fonts, poppler's URW fonts). Widths are the same everywhere; shapes differ slightly. That's expected and fine.
- The risk is layout drift: line breaks and alignment computed with different widths than the PDF uses. Avoided by decision 4: positions come from the AFM metrics, not from browser measurement.
- Check that pdf.js's rendering of the saved file matches the preview, since that's the viewer the user sees after reopening.

### 5.2 Characters outside WinAnsi
- Typographic quotes, dashes, €, and accented Western European letters are in WinAnsi. Polish, Czech, Greek, Cyrillic, CJK and emoji are not.
- Users paste text from elsewhere, so this will happen. Flag it while typing, offer image text, and never silently replace characters.

### 5.3 Cover-up is not redaction
- A box drawn over text hides it from view and print, but the text is still in the page content: anyone can select, copy or extract it.
- **"Print to PDF" usually does not fix this.** Chrome's and Windows' Print to PDF keep text as text, so the hidden text survives under the box. Only rasterising the page (an image of the page, e.g. Acrobat's "Print as image") removes it.
- Real redaction is a possible later chunk (§7): rasterise affected pages in the app with pdf.js at 300 DPI and replace their content with the image.

### 5.4 Many kinds in one undo history and one selection
- Inline text editing has its own browser undo; app undo must not fire inside the textarea (already the rule for text fields), and a whole edit session should be one app undo step.
- Keyboard shortcuts (Delete, arrows) must not act on the placement while its text is being edited.

### 5.5 WASM size
- `serde` and `serde-wasm-bindgen` add size; the WinAnsi table and path code are small. Measure in chunk 2 and keep under 1.2 MB raw.

### 5.6 Licensing
| Item | Licence | Note |
|---|---|---|
| Adobe Core 14 AFM metrics | Free to use, copy and distribute (Adobe's AFM notice) | Keep the notice with the generated metrics and in `licenses.txt` |
| Arimo, Tinos, Cousine | SIL OFL 1.1 (via `@fontsource`) | Added to `licenses.txt` automatically, as the script fonts are |
| serde, serde-wasm-bindgen | MIT / Apache-2.0 | ✅ |

---

## 6. Already done since the MVP
- Renamed pdf-sign → **pdf-flex** throughout (crate `pdf-flex-server`, `PDF_FLEX_*` variables, IndexedDB database `pdf-flex`). Old signature exports still import.
- Deployed to **Railway**; Dockerfile cache mounts removed, since Railway rejects mounts without its `s/<service-id>-` id prefix.

---

## 7. Later ideas

Carried over from the [MVP list](mvp-plan.md#11-later--post-mvp-ideas), plus new ones:
- **True redaction:** rasterise chosen pages (or just the covered regions' pages) and replace their content, so covered text is gone from the file.
- **Embedded TrueType fonts** (option C): any font as real text, non-Latin scripts. Needs subsetting and a `ToUnicode` map.
- **Text boxes that wrap** to a fixed width.
- **Text presets:** today's date (choice of formats), your name, initials; saved like signatures.
- **Images** that aren't signatures (logos, photos) through the same image item.
- Typed and drawn signatures as **vector** output (now easy: real text and paths exist).
- Fill AcroForm fields; merge, split, reorder, rotate or delete pages.
- File System Access API (save over the original), `file_handlers` ("Open with").
- **Incremental save**, keeping existing digital signatures valid.
- Deploy to the Raspberry Pi (MVP chunk 10).
- Tauri desktop wrapper ([MVP §10](mvp-plan.md#10-later-tauri-desktop-wrapper-only-if-needed)).
