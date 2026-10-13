# pdf-flex — Toolbox plan

pdf-flex started as a PDF signing app. The MVP is done: open a PDF, place signatures (imported, typed or drawn), save a new PDF, all in the browser, installable and offline. Its plan, with the architecture, decisions and blind spots that still apply, is frozen in [mvp-plan.md](mvp-plan.md).

This phase turns it into a small general PDF editor: **text** first, then **shapes and symbols**, with room for more tools later. The ground rules don't change: everything runs in the browser, nothing is uploaded, and the Rust `pdf-stamp` library writes the PDF.

---

## 1. Scope

**In scope**
- A **tool rail** on the left: Signatures, Text, Shapes. Each tool has its own panel; Save, undo/redo and the list of placed items stay put whatever tool is open.
- **Text** written into the PDF as real text: sharp at any zoom, selectable, searchable and copyable in any viewer.
  - Fonts: Helvetica, Times and Courier (regular, bold, italic, bold italic), the PDF standard fonts, so nothing needs embedding.
  - Size, colour, multiple lines (Enter), left/centre/right alignment.
  - Typed on the page, in place.
- **Text in other fonts** (the bundled script fonts, more later) written as an image: looks the same, but isn't selectable.
- **Shapes and symbols** as vector graphics: rectangle, ellipse, line; ✓ ✗ ● ○ symbols for ticking forms. Stroke colour and width, optional fill.
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
| 1b | Top bar actions and status bar | Undo/redo and Download stay visible with the panel collapsed; the placed list opens from the status bar | ✅ |
| 2 | Placements of different kinds | All existing tests pass on the new model; image-only output renders identically to before | ✅ |
| 3 | Text in `pdf-stamp` | `cargo test` stamps text on every corpus file; `pdftotext` reads it back exactly | ✅ |
| 4 | Text tool in the app | Add and edit text in the browser; in the download it is selectable, searchable and where the preview showed it | ✅ (pending your check) |
| 5 | Image text (other fonts) | Text in a script font saves as a crisp image, positioned as previewed | 🔜 |
| 6 | Shapes and symbols | Draw each shape and symbol, style it, save; it matches the preview in Chrome and Acrobat | ✅ (pending your check) |
| 7 | Multi-select and align | Ctrl+click several items; delete, nudge, drag and align them together | ✅ |
| 8 | Tools: Select, Hand and a quick bar | One active tool decides what a page click does, in every tool; the quick bar switches between Select, Hand and the last tool | ✅ |
| 9 | Selection panel | Selecting several items switches to Select and opens a panel with align and delete; the top bar loses its align buttons | ✅ (pending your check) |

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

### Chunk 1b: Top bar actions and status bar
Added after chunk 4: the shared area under the tool panel (placed list, undo/redo, Download) collapsed with the panel and took height from every tool.
- **Top bar:** `↶ ↷ [Download PDF] │ Page … zoom …`. Undo/redo and Download sit before a separator, viewing controls after it. Download keeps the primary style, is disabled while nothing is placed, and its tooltip says the original isn't changed. Below 640 px it shows only its icon.
- **Status bar** (`StatusBar.tsx`, only with a PDF open):
  - **"3 items ▴"** opens **On this document** above the bar: click an entry to go to its page and select it (the list stays open); × removes. Escape or a click outside the status bar closes it. No undo/redo there; the top bar has them.
  - **Unsaved changes** (●) or **Downloaded**, from the same state as the close-tab warning.
  - **A hint for the moment** on the right (hidden below 640 px): editing, selected text, any selection, or the open tool. The hints that were in the sidebar and the Text panel moved here.
- **Sidebar** is now only the rail and the tool panel.
- **Verified (no browser):** typecheck, 47 web tests and the build pass.
- **Follow-up, control sizes:** one `--control-h` (2 rem) for buttons, selects and text/number inputs, so rows line up; primary buttons are no taller than the rest (only the empty screen's "Open PDF…" stays large); text inputs and selects get the same border and radius as buttons; a visible focus ring for keyboard users. A fuller pass on buttons and inputs is still to do.
- **Your checks:** collapse the panel and check undo, redo and Download still work; open the items list, step through entries, remove one, close it with Escape and by clicking outside; watch Unsaved changes → Downloaded after a download; check the hints change as you select, edit text and switch tools; narrow the window below 640 px.

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

**As built**
- **`text.rs`:** `Font` (the 12 standard text fonts, serialised by PostScript name, e.g. `"Times-Bold"`; `Font::ALL`, `from_base_font`, `family`), `Line { text, x, y }`, `winansi(char)` and `literal(text)`, which builds the escaped PDF string or returns the first unsupported character.
- **`Item::Text { font, size, color: [u8; 3], lines }`:** colour is 0–255 RGB. The box only positions the text (lines are relative to its bottom-left corner) and is still validated like any box. Empty lines are skipped; an empty `lines` is allowed.
- **Drawing:** `q <display→user> cm 1 0 0 1 x y cm BT /PdfFlexF0 12 Tf r g b rg 1 0 0 1 lx ly Tm (…) Tj … ET Q`, one text object per placement, each line placed by its own text matrix. The content stream is now built as bytes (WinAnsi isn't UTF-8).
- **Resources:** `add_xobject_resource` became `add_resource(…, Resource::XObject | Resource::Font, …)`. Image names are unchanged (`PdfFlex0`, …), fonts are `PdfFlexF0`, …; signature-only output is still byte-identical to before.
- **Errors:** `UnsupportedCharacter { character, font }` ("The character 'Ł' can't be written in Times. Use image text for other characters."). A non-finite or non-positive size, or a non-finite line position, is `BadPlacement`. Everything is checked before the document is changed.
- **Tests:**
  - 6 unit tests in `text.rs`: the encoding table, controls and other scripts refused, escaping, font names.
  - `tests/text.rs` (7): on every fixture, `pdftotext -cropbox -bbox` finds the first word upright, about one font size tall, with its baseline exactly where it was placed (`-cropbox` makes poppler report display-space positions, CropBox offsets included); two lines with `“ ” – € ½ é ( ) \` read back exactly; fonts are added once per document and named per page next to inherited ones; images and text share a page; empty text; refused characters; invalid sizes.
  - Corpus: every page of every file that should sign also gets a line of black text on its black box (so renders are unaffected), and `pdftotext` must find it on that page.
  - `just wasm-smoke` stamps an image and text together, checks the text error, and reads the text back with `pdftotext`.
- **TypeScript:** `StampItem` in `placement.ts` gained the text variant and a `StandardFont` type, mirroring the Rust `Item`, ready for chunk 4.
- **CLI:** `just stamp-text in.pdf "Jane Smith\n13 Oct 2026" out.pdf --at 400,80 --size 12 --font Times-Roman --color 1e3a8a`. `--at` is the first baseline; `\n` starts a new line 1.2 × size below. The recipe uses `[positional-arguments]` so quoted text stays one argument.
- **Size:** WASM 1,080,951 bytes raw, up 21.3 KB.
- **Verified (no browser):** `just test` (15 unit, 13 stamping, 7 text, 2 corpus, 7 server tests in Rust; 29 web), `just lint`, `cargo fmt`, `just wasm-smoke` and `just build` pass.
- **Your checks:** open these in Chrome and Acrobat Reader. The text should look right, sit where expected, and be selectable, searchable (Ctrl F) and copyable with accents and € intact:
  1. `out/text-cli.pdf` (rotated page, two lines, Times Bold, dark blue).
  2. `out/wasm-smoke.pdf` (written by the WASM build).
  3. A few corpus outputs in `target/tmp/corpus/`, e.g. `real--irs-w9-xfa-form.pdf`: search for `pdfflex-1`. The text is black on the black box, so select it to see it.

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

**As built**
- **Metrics:** `web/scripts/font-metrics.ts <afm dir>` writes `src/fonts/metrics.ts` (committed): widths of the 12 fonts over WinAnsi bytes, ascender and descender, with Adobe's notice in the header. The AFMs came from the `pdfkit` 0.20.2 npm package (not a dependency; only used to generate). The WinAnsi glyph-name table was cross-checked against pdfkit's: they differ only at 0x9F, where pdfkit has `ydieresis` and the PDF spec (and `pdf-stamp`) have `Ydieresis` (Ÿ). The notice is also added to `licenses.txt` at build time.
- **`winansi.ts`** mirrors the Rust table; **`textLayout.ts`** has the style (`family`, `bold`, `italic`, `size`, `color`, `align`), `standardFont`, `layoutText`, `relaidOut` (re-layout keeping a chosen corner fixed), `resizedTextSize`, `hexToRgb`.
- **Baselines:** where a baseline sits in its 1.2 × size line follows the CSS line box of the preview font (vertical metrics read from the font files: Arimo and Cousine set USE_TYPO_METRICS and Tinos's hhea and Windows values agree, so it's the same on every OS). So the textarea's text and the finished preview line up.
- **Preview:** an SVG in points from the same layout, each line stretched to its exact standard-font width with `textLength`, so Arimo/Tinos/Cousine's tiny differences never show. Characters that can't be written are drawn red, and the box gets a red dashed outline.
- **Editing in place:** a textarea over the box in the same font, size and line height, with padding either side for the caret (so its text area is exactly the box). A backdrop behind it highlights unsupported characters with a red wavy underline, as planned. The box grows as you type.
  - One edit (including restyling during it) is **one undo step**; a new box left empty disappears without leaving an undo step. Escape finishes and keeps the box selected; clicking elsewhere or dragging finishes too.
  - **Adding:** with the Text tool open, clicking empty page space adds a box (its first line centred on the click) even while another is being edited, which finishes that one first. **Add text to page N** adds one in the middle of the page.
- **Text panel:** font (each name shown in its preview font), bold, italic, size (4–200 pt, half points), three colour swatches plus a colour picker, alignment. It shows and changes the selected text box; with none selected, it sets the style for the next one. The style is remembered (`localStorage`, `pdf-flex:text-style`). Size typing and colour picking undo as one step each.
- **Resizing** with a corner scales the font size; the opposite corner stays put. **Moving and nudging** text never resizes it (`keptOnPage` only moves).
- **Placed list:** `“Jane Smith” · page 2`.
- **Fonts:** Arimo, Tinos and Cousine 5.3.0 (OFL 1.1), Latin subset only, regular/bold/italic/bold italic: 12 files, about 200 KB, precached for offline use.
- **Verified (no browser):** 47 web tests (18 new: encoding table, AFM values, layout, alignment, re-layout anchors, resize size, text stamp arguments, page clamping) and all Rust tests; `just lint` and `just build` pass. End to end without a browser: text laid out by the app's own code, stamped by the WASM build on a rotated page, measured by `pdftotext`: right-aligned lines end at exactly the same x, and baselines match the layout to within 0.001 pt.
- **Known limits:** a text box larger than the page isn't shrunk. Tabs count as unsupported characters.
- **Your checks** (`just dev`):
  1. Open the Text tool. Click on a page and type a few lines: the box grows, the caret sits in the text, and when you click away the preview looks the same as while typing (no jump).
  2. Change font, bold, italic, size, colour and alignment with a box selected, and with none (the next box uses the settings). Drag a corner: the text scales. Move it, nudge it, drag it to another page.
  3. Undo/redo: a whole edit, a restyle, a resize. A new box left empty disappears and doesn't add an undo step.
  4. Type `Łódź` or paste an emoji: the characters are highlighted, the panel warns, and Download refuses with a clear message.
  5. Download and open in Chrome and Acrobat Reader, including text on a rotated page: the text sits where the preview showed, and can be selected, searched (Ctrl F) and copied.

### Chunk 5: Image text (other fonts)
- The Text panel's font list gains a second group, **Image text**: the four bundled script fonts (Great Vibes, Dancing Script, Allura, Caveat).
- Previewed with the browser's own text rendering. On save, each such placement is drawn to a PNG at 300 DPI for its size (`document.fonts.load` first, as typed signatures do in `typedSignature.ts`) and sent as an image item. The Placed list and the panel mark it "image".
- **Your check:** place script-font text, download, zoom to 400% in a viewer: crisp and in place.

### Chunk 6: Shapes and symbols
- **New `Item::Shape`** in Rust: a list of path segments (move, line, cubic curve, close) in the box's coordinate space, plus stroke colour and width, and fill colour or none. Ellipses use the usual four-curve approximation. Everything is drawn with PDF path operators (`m l c h S f B`).
- **Shapes panel:** rectangle, ellipse, line. Drag on a page to draw one; click to add a default-sized one. Stroke colour, stroke width, fill (none or a colour).
- **Lines** are stored by their two endpoints and edited with two handles instead of corners.
- **Symbols:** ✓ ✗ ● ○ in the same panel, as fixed paths with locked aspect, sized like a 12 pt character by default, for ticking boxes on forms.
- ~~**Cover-up box**~~: built, then removed on 2026-10-13 (see §5.3).
- **Preview:** the overlay draws shapes as SVG from the same path data that's sent to Rust.
- **Tests:** Rust render tests per shape on the rotation and CropBox fixtures (pixels inside and outside the box); web tests for path generation and free resizing.
- **Your check:** draw each shape and symbol on a normal and a rotated page, restyle them, save, and compare with the preview in Chrome and Acrobat. 

**As built** (done before chunk 5)
- **Rust** (`shape.rs`): `Segment` (`M`, `L`, `C`, `Z`, serde-tagged by `op`), `Stroke { color, width }`, and `Item::Shape { path, stroke: Option, fill: Option, rounded }`. Drawn as `1 0 0 1 x y cm`, then `1 J 1 j` if rounded, `RG`/`w`, `rg`, the path, and one paint operator (`S`, `f` or `B`). Refused as `BadPlacement`: an empty path, one not starting with a move, non-finite numbers, a non-positive width, or nothing to paint.
- **Render tests** (`tests/shapes.rs`, poppler): on every fixture, a filled rectangle, a stroked ellipse and a thick line land where placed (filled inside, outline only on the ellipse's edge, dark along the line and clear beside it), and no pixel outside their boxes changes. Plus the operators for stroke + fill, and the refusals. The poppler render helper moved to `tests/common/` and now renders the **crop box** (display space; it rendered the media box before, which the corpus never noticed because no corpus file has a crop offset).
- **Web** (`shapes.ts`, pure, 16 tests): `drawing(shape, style, w, h, ends)` builds the path the preview and the PDF share. Outlines are inset by half their width, so a shape stays inside its box. Symbols are drawn on a unit square with a weight of 12 % of their size (✓ and ✗ stroked with round caps, ● filled, ○ stroked). `dragGeometry`/`clickGeometry`/`lineBox`/`snapAngle` give the geometry for drawing.
- **Lines** keep their ends relative to a box padded by half the line width plus 4 pt (easy to grab, caps never cut off). Selected lines show two round end handles instead of corners. Moving never resizes a line's box (`fixedSize`).
- **Drawing:** with the Shapes tool, drag on empty page space to draw (Shift: square, circle, or a line snapped to 45°); a click adds a default size (rectangle 120 × 60, ellipse 100 × 70, line 120, symbols 12 pt) centred on it. A drawn shape, from press to release, is one undo step. The pointer is kept within the page.
- **Shapes panel:** rectangle, ellipse, line; ✓ ✗ ● ○. Outline colour (or none, if filled), outline width (0.5–20 pt), fill (none, white or a colour). Symbols only have a colour. It edits the selected shape, or sets the style for new ones (remembered, like the drawing choice). "None" is only offered where the shape would still be visible.
- **Resizing:** rectangles and ellipses freely (Shift keeps proportions); symbols keep proportions, down to 6 pt.
- **Status bar:** names (“Rectangle”, “✓ Tick”, …) and hints for each drawing choice and selection.
- **Size:** WASM 1,108,300 bytes raw (+27 KB).
- **Verified (no browser):** Rust (17 unit, 13 stamping, 7 text, 3 shape render, 2 corpus, 7 server tests), 63 web tests, lint, fmt, `just wasm-smoke` (which now stamps a shape too) and the build pass. End to end without a browser: shapes made by the app's own drawing code, stamped by the WASM build on a rotated page and rendered by poppler, are dark exactly on their outlines, line and dot, and clear inside and beside them.
- **Your checks:**
  1. Shapes tool: draw a rectangle and an ellipse by dragging in each direction, with and without Shift; click for default sizes. Draw lines, with Shift for 45°, and drag their ends.
  2. Place ✓ ✗ ● ○ by clicking and by dragging; resize them small.
  3. Restyle: outline colour, width, fill, none. Undo/redo a drawing, a restyle, a resize, an end drag.
  4. Download and compare with the preview in Chrome and Acrobat, including on a rotated page.

### Chunk 7: Multi-select and align
Added after chunk 6, at your request.
- **Selecting:** Ctrl+click (Cmd+click on a Mac; Shift+click too) adds an item to the selection or takes it out, on the page or in the "On this document" list. A plain click selects one item; clicking empty space clears (with a modifier held, it leaves the selection alone). **Ctrl/Cmd+A** selects everything on the current page; Escape clears. Editing text selects just that box.
- **Model:** the editor keeps `selection()` (ids, in order). `selected()` still means "the only selected item", which is what resize handles, the × button, the style panels and Enter-to-edit act on, so they're unchanged with one item and hidden with several.
- **Together:** Delete removes them all; arrow keys nudge them all; dragging any of them moves the group. Each is one undo step. A group stays on its own pages (no dragging onto another page), and its move stops as soon as one item would leave its page, so the arrangement never distorts.
- **Align** (top bar, before Download, shown with 2+ selected): **left, centre, right** line items up along a vertical line; **top, middle, bottom** along a horizontal one. Edges and centres are those of the selection's bounding box (as Figma and PowerPoint do). Items on different pages line up by their position on the page. One undo step.
- **Pure functions** in `arrange.ts` (`alignTarget`, `alignedBox`, `limitGroupMove`), 8 tests.
- **Status bar:** "3 selected · Delete removes them · Arrow keys move them · Ctrl+click adds or removes".
- **Later:** distribute three or more evenly. (Box selection came in chunk 8.)
- **Your checks:**
  1. Ctrl+click (Cmd+click on a Mac) a signature, a text box and a shape: all three outlined, no handles. Ctrl+click one again to drop it.
  2. Delete removes them all; undo brings them all back.
  3. Arrow keys and dragging move them together; at a page edge the whole group stops.
  4. Each of the six align buttons, then undo. Try items on two different pages.
  5. Ctrl+A on a page; Ctrl+click in the items list.

### Chunk 8: Tools: Select, Hand and a quick bar
Added after chunk 7: clicking the page did nothing with the Signatures panel open, but added text or a shape with the others, and an open panel didn't read as a selected tool.
- **One active tool** decides what a press on empty page space does:

  | Tool | Click | Drag on empty space | Cursor |
  |---|---|---|---|
  | **Select** (default, V) | Selects; empty space clears | A box that selects every item **entirely inside it** (Ctrl/Cmd/Shift adds) | Arrow |
  | **Hand** (H) | Nothing | Pans, as holding Space does | Hand |
  | **Signatures** (S) | Places the active signature, centred; with an empty library, opens New signature | (Dragging from the library still works) | Copy |
  | **Text** (T) | Adds a text box | | Text |
  | **Shapes** (R) | Adds the chosen shape | Draws it | Crosshair |

  In every tool except Hand, clicking an item selects and moves it, and Ctrl+click adds it to the selection. Space still pans while held. After placing something you stay in that tool.
- **Panels are tools:** opening a panel from the rail selects that tool; clicking its rail button again closes it and goes back to Select. Below 640 px (where the panel covers the page) the rail opens and closes the settings without changing the tool, and a tool picked from the quick bar is used with its panel closed.
- **Quick bar** (`QuickBar` in `ToolRail.tsx`): floating at the bottom centre of the area under the top bar (the full width, so opening a panel doesn't move it), icons only: Select, Hand │ the last panel tool used (its own icon). Tooltips give the names and shortcuts. The active tool is highlighted there and in the rail.
- **The panel always floats** over the document, next to the rail, at every width (it used to only below 640 px), so opening or closing it never moves the pages.
- **Escape** steps back: finishes a text edit (in its field), then clears the selection, then returns to Select.
- **Remembered:** the active tool and the last panel tool (`localStorage`).
- The **New signature** dialog moved from the Signatures panel to the app, so a page click can open it with the panel closed.
- **Status bar** hints for each tool, e.g. "Click on a page to place “Jane”".
- **Verified (no browser):** 76 web tests (1 new for box overlap), typecheck, build.
- **Your checks:**
  1. Start (or press V): Select is highlighted in the quick bar, no panel open. Drag a box over several items, with and without Ctrl; click empty space to clear.
  2. H, or the hand button: dragging pans, and items can't be moved or edited. Space still pans in other tools.
  3. Open each panel from the rail: the tool is highlighted in the rail and the quick bar. Click on a page: Signatures places the active signature, Text adds text, Shapes adds a shape. Click the rail button again: the panel closes and Select is back.
  4. The quick bar's third button follows the last panel tool used and reopens it.
  5. Shortcuts S, T, R, V, H, and Escape stepping back. They don't fire while typing.
  6. With an empty signature library, a click with Signatures opens New signature.
  7. Below 640 px: picking Text in the quick bar lets you click to add text with the panel closed; the rail opens its settings.

### Chunk 9: Selection panel
Added after chunk 8: the align buttons move from the top bar into a panel beside the selection.
- **Selecting a second item** (Ctrl/Cmd/Shift+click, a selection box, or Ctrl+A) switches to **Select**. Any open tool panel slides away and the **Selection** panel slides in, in the same place. Back below two items, it slides away; you stay in Select. The quick bar's third button still brings the previous tool back.
- **Selection panel** (`SelectionPanel.tsx`): "3 selected"; **Align** as two labelled rows (Left · Centre · Right, Top · Middle · Bottom), lining items up on the edge or centre of the whole selection; **Delete selected**. Room later for distributing evenly and restyling several items at once.
- **No rail button:** the panel follows the selection rather than being chosen. It shows on narrow screens too, since it's the only place aligning lives; Escape or a click on empty space clears the selection and closes it.
- While the panel slides closed it keeps showing what it showed, whichever panel it was.
- **Top bar:** back to undo, redo and Download.
- **Known:** the panel floats over the left of the page, so items near the left edge can be under it; pan or scroll to see them. A small floating bar above the selection is the fallback if this gets in the way.
- **Your checks:**
  1. With Text (or any tool) active, Ctrl+click two items: the tool switches to Select, the Text panel slides away and the Selection panel slides in.
  2. Each align button, Delete selected, and undo.
  3. Ctrl+click one item out again: the panel slides away and Select stays active. Escape does the same.
  4. A selection box over several items, and Ctrl+A, open it too.
  5. The top bar no longer shows align buttons.

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

### 5.3 Covering is not redaction
- The cover-up box preset was removed. A filled rectangle can still be drawn over content, and the same caution applies to it.
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
