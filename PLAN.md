# pdf-flex — Plan

A web app you can install as a PWA. It opens a PDF, lets you drag your signature onto a page, move and resize it, and save the result as a new PDF.

**Everything runs in your browser.** The PDF-writing code is Rust compiled to WebAssembly (WASM). The server only hands out static files: no document or signature is ever uploaded.

**Hosting:** self-hosted on the local network, on a Raspberry Pi, behind the existing Tailscale reverse proxy (see §9).

---

## 1. MVP scope

**In scope**
- Open a PDF using a file picker or by dragging it onto the page (see §5).
- Show its pages with scrolling and zoom.
- Get a signature three ways: **import** an image (PNG/JPEG), **type** your name in a signature-style font, or **draw** it with a mouse, trackpad, or pen.
- Keep a **library of saved signatures** in the browser (IndexedDB) for later sessions.
- Drag the signature onto any page, move it, and resize it with the aspect ratio locked.
- Place it more than once, including on different pages, and delete a placement.
- **Save as a download** named `<name>-signed.pdf`. The original file is never touched.
- Works offline once loaded, and can be installed as a PWA.
- The output opens correctly in Acrobat Reader, macOS Preview, Chrome, and Firefox.

**Out of scope for the MVP** (see §11)
- Text, date, or initials fields; form filling
- Editing existing PDF content
- Saving back over the original file
- A desktop app (Tauri)

---

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Hosting | Local network only, on a Raspberry Pi behind the existing Tailscale reverse proxy, which terminates TLS (§9). **Deferred to chunk 10:** dev uses `localhost` |
| 2 | Primary browser | Chrome (desktop) |
| 3 | Encrypt the stored signature? | No. It's a prototype, so store it as plain PNG in IndexedDB |
| 4 | Frontend framework | SolidJS |
| 5 | Target platform | Browser-first (works on Windows and Linux). Windows-only native was considered and rejected: it doesn't remove the hard parts, and the dev container is Linux |
| 6 | Signature sources | Import, type, and draw all produce a **transparent PNG** saved to the same IndexedDB library, so `pdf-stamp` only ever deals with PNG images (it gains support for several different images per document in chunk 5). Typed signatures use bundled open-licence script fonts (no font CDN). Drawn signatures are rasterised at high resolution; vector output is a later idea |
| 7 | Static file server | A small **axum** server (`crates/pdf-flex-server`) in an **Alpine** container image, rather than Caddy or nginx. It keeps the whole stack in Rust, and the security headers (CSP), MIME types and cache rules live in tested code. The image is built in two stages, builder and runner, and the builder uses `just` (chunk 9) |

---

## 3. Roadmap

Work proceeds in small chunks. Each one ends with something you can run and check, followed by a review and a commit.

**Status key:** ✅ done · 🔜 next · ⬜ not started

| # | Chunk | Done when | Status |
|---|---|---|---|
| 0 | Environment | Container has the WASM target, `wasm-pack`, and `qpdf`; workspace and `justfile` exist | ✅ |
| 1 | Experiment A: native stamping | Stamped test PDFs look right in Chrome and Acrobat | ✅ |
| 2 | Experiment B: the same code as WASM | A bare page stamps and downloads a PDF in Chrome; WASM size noted | ✅ (pending your Chrome check) |
| 3 | Experiment C: viewer UI | A SolidJS + pdf.js viewer at `localhost:5173` | ✅ (pending your Chrome check) |
| — | **Go/no-go on lopdf** | Continue, or switch to the fallback (§6) | ✅ Go: lopdf stays |
| 4 | MVP part 1: place and save | **End-to-end:** sign a real PDF in the browser | ✅ (pending your Chrome check) |
| 5 | Signature library | Saved signatures survive a browser restart; pick, rename, delete | ✅ (pending your Chrome check) |
| 6 | Create signatures: type and draw | Make a signature from typed text or by drawing, and save it to the library | ✅ (pending your Chrome check) |
| 7 | Harden the core library | `cargo test` passes against the test-file corpus | ✅ (pending your Chrome check) |
| 8 | Polish | Undo, keyboard shortcuts, unsaved-changes warning, cross-browser check | ✅ (pending your browser checks) |
| 9 | PWA, server and container image | `just image` builds an Alpine image; the container serves the app on `localhost:8080`, Chrome installs it, and it works offline | ✅ (pending your image build and Chrome checks) |
| 10 | Deploy to the Pi (later) | Installed from a phone or laptop via the Pi, over HTTPS through Tailscale | ⬜ |

### Chunk 0: Environment ✅
- Dockerfile: `wasm32-unknown-unknown` target, `wasm-pack`, `qpdf`.
- `devcontainer.json`: forward port 5173 (Vite) instead of the old 3000.
- Cargo workspace (`crates/*`) with a size-optimised release profile; `justfile` (`test`, `lint`, `fmt`); `.gitignore`.

### Chunk 1: Experiment A, native stamping ✅
- `crates/pdf-stamp`: `stamp(pdf, signature_png_or_jpeg, &[Placement]) -> Vec<u8>` using lopdf 0.45 (default features off).
  - Placements are in **display space** (see §7.1); Rust handles the CropBox and `/Rotate`, including values inherited from the page tree.
  - The RGB image plus an `/SMask` for transparency, embedded once and shared by every placement.
  - Existing content is wrapped in `q … Q` and the stamp is appended. Page resources are copied, not edited in place, so shared or inherited dictionaries are safe.
  - Multiple placements and encrypted-PDF refusal came along for free; chunk 7 still covers hardening.
- CLI: `just stamp in.pdf sig.png out.pdf --page 1 --at X,Y --width W` (the height follows the image's aspect ratio).
- `just fixtures` writes six generated test PDFs (plain, rotate 90/180/270 with inherited Rotate, CropBox offset, CropBox + rotate), a sample signature, and stamped copies to `out/`, then runs `qpdf --check` on each.
- Tests: geometry unit tests, plus round-trip tests over every fixture.
- **Verified:** all outputs pass `qpdf --check`; rendered with poppler, the signature sits upright inside the target box on every fixture, and transparency works.
- **Your check:** open `out/stamped/*.pdf` in Chrome and Acrobat.

### Chunk 2: Experiment B, the same code as WASM ✅
- `crates/pdf-stamp-wasm`: a thin `wasm-bindgen` wrapper exposing `stamp(pdf, signature, placements: Float64Array) -> Uint8Array`. Placements are flat `[page, x, y, width, height]` groups, which avoids a serde dependency. Rust errors arrive in JS as ordinary exceptions with the Rust message.
- **WASM build fix:** lopdf depends on `getrandom`, which needs its browser backend; `pdf-stamp` enables lopdf's `wasm_js` feature on `wasm32` targets only. Nothing else needed trimming.
- **Size:** 973 KB raw, about 430 KB gzipped (release profile with `opt-level = "z"`, LTO, and `wasm-opt`). Within target, so no further size work for now.
- **Speed:** about 40 ms to stamp a one-page PDF (Bun, first call).
- **Equivalence:** the WASM output renders pixel-identical to the native CLI output.
- Recipes:
  - `just wasm` builds the package into `crates/pdf-stamp-wasm/demo/pkg`.
  - `just wasm-smoke` runs the built WASM headlessly under Bun (`smoke.ts`) and checks the output with `qpdf`.
  - `just demo` serves a bare test page on `localhost:5173`, with the test PDFs and sample signature available as samples.
- **Your check:** run `just demo`, open `http://localhost:5173` in Chrome, stamp a sample or your own PDF, and open the download.

### Chunk 3: Experiment C, viewer UI ✅
- `web/`: Vite 8 + SolidJS + TypeScript, managed with Bun. Dependencies are pinned to exact versions at least two weeks old.
- pdf.js 6 with its worker bundled locally. A small Vite plugin serves pdf.js's runtime data (CMaps, standard fonts, wasm decoders, ICC profiles) from `node_modules` in dev and copies it into `dist/pdfjs/` on build, so nothing comes from a CDN.
- **Open:** "Open PDF…" button (file picker) or drop a PDF anywhere in the window. In dev, a **Samples** menu lists the PDFs in `out/` (served by a dev-only plugin, absent from builds).
- **Viewing:**
  - Pages are laid out at their display size (after CropBox and rotation; the same space `pdf-stamp` uses).
  - Only pages within about a screen of the viewport are rendered; others release their canvas.
  - Rendering is sharp on HiDPI screens, and re-renders if the window moves to a monitor with a different pixel ratio. Canvas size is capped at 16 MP per page.
  - Zooming swaps in the re-rendered canvas only when it's ready, so there's no blank flash; re-rendering is debounced by 150 ms.
- **Zoom:** −/+ buttons, 100%, Fit width, Ctrl/Cmd + plus/minus/0, and Ctrl/Cmd + wheel or trackpad pinch, which zooms around the cursor. Every document opens at 100% (actual size).
- **Navigation:** current-page indicator, plus type a number to jump to that page.
- `out/many-pages.pdf`: 120 pages mixing every fixture, generated by `just fixtures`.
- Recipes: `just dev` (dev server on `localhost:5173`), `just build` (typecheck + production build).
- **Verified (no browser):** typecheck and production build pass; the dev server serves the app, samples, and pdf.js assets with the right MIME types; the sample server refuses path traversal.
- **Your check:** run `just dev`, open `http://localhost:5173` in Chrome, open `many-pages.pdf` from Samples, and try scrolling, zooming (including Ctrl+wheel), and drag-and-drop.

### Go/no-go on lopdf ✅
**Go.** Chunks 1–2 showed lopdf stamps correctly (rotation, CropBox, transparency) and builds for WASM at an acceptable size. No fallback needed.

*Order change:* stamping in the viewer (chunk 4) and the signature features (chunks 5–6) come before hardening the library (chunk 7), so the app is usable sooner. The library already supports everything chunk 4 needs.

### Chunk 4: MVP part 1, place and save ✅
- **Signature:** loaded with a file picker in a new left sidebar (PNG/JPEG; non-images are rejected with a message). Shown on a checkerboard so transparency is visible. Replacing the image keeps existing placements' widths and adopts the new proportions.
- **Placing:** drag the signature thumbnail onto any page (it lands centred on the drop point), or click **Place on page N** for the current page. Default width is 150 pt (about 2 in), at most half the page width.
- **Editing on the page:** click to select; drag to move; drag a corner handle to resize, with the aspect ratio locked and the opposite corner fixed. Boxes can't leave their page. Delete with the × button or the Delete/Backspace key; Escape or clicking empty page space deselects. Pointer events with `touch-action: none`, so touch works too.
- **Placed list** in the sidebar: jump to a placement's page or remove it.
- **Geometry** lives in `web/src/placement.ts`, pure functions with 13 `bun test` unit tests: screen to display-space conversion, move, resize, clamping, and the flat argument layout for WASM.
- **Saving:** **Download signed PDF** sends the *original* bytes, the signature and the placements to a Web Worker running the WASM build, then downloads `<name>-signed.pdf`. Errors from Rust appear in the error banner.
- **Build wiring:** `just wasm` now builds into `crates/pdf-stamp-wasm/pkg`, used by the web app (Vite alias `pdf-stamp-wasm`) and copied into the demo page by `just demo`. `just dev` and `just build` build the WASM first. `just test` runs the Rust and web tests.
- **Not yet** (later chunks): moving a placement to a different page by dragging, undo/redo, arrow-key nudging (all done in chunk 8), storing the signature between sessions, background removal (chunk 5).
- **Verified (no browser):** typecheck, unit tests, and production build pass (the WASM is emitted once, hashed, next to the worker); the dev server resolves the worker and serves the WASM as `application/wasm`.
- **Your check:** `just dev`, open a sample or your own PDF, load a signature, place it on a few pages (including a rotated one), move and resize, then download and open the result.

### Chunk 5: Signature library ✅
- **IndexedDB store** (`web/src/signatureStore.ts`, hand-written, no dependency): database `pdf-flex`, store `signatures`, records `{ id, name, source: "import" | "typed" | "drawn", png: Blob, width, height, createdAt, lastUsedAt }`. Loaded at startup, most recently used first.
- **Sidebar library:** thumbnails on a checkerboard. Click one to make it active (used by **Place on page N**); drag any of them onto a page. Rename inline (Enter saves, Escape cancels). Delete is disabled while that signature is placed in the open document.
- **Import dialog:** choose or drop a PNG/JPEG, see a live preview, toggle **Remove background** and adjust the threshold slider, name it, **Save to library**. Done on a canvas in the browser (`signatureImage.ts`): pixels lighter than the threshold fade to transparent over a soft edge, ink keeps its colour, the result is trimmed to the ink with a small margin, and the longest side is capped at 1600 px. Background removal is off by default for images that are already transparent.
- **Several signatures in one document:** each placement records its signature. `pdf-stamp::stamp` now takes a list of images, and each `Placement` has an `image` index. Only images actually used are embedded, each once; a page with two different signatures gets two XObject resources. The WASM API takes the images as one concatenated buffer plus a list of lengths, and placements as `[image, page, x, y, width, height]` groups.
- **Export / import library** as a JSON file (PNGs base64-encoded); importing adds copies with fresh ids. `navigator.storage.persist()` is requested when a signature is first saved.
- **Tests:** 3 new Rust tests (two images on one page, unused images not embedded, out-of-range image index); 2 new web tests (export/import round trip, rejecting other files). Totals: 11 Rust, 15 web.
- **Your check:** import an image (try a photo of a signature on paper), import a second, reload the browser and confirm both are still there; place both in one document, download, and check the result; rename and delete; export the library and import it again.

### Chunk 6: Create signatures: type and draw ✅
The sidebar's **New signature…** button opens one dialog with **Type · Draw · Import** tabs (`NewSignatureDialog.tsx`). Tabs stay mounted, so switching doesn't lose work; a shared **Name** field follows the active tab's suggestion until you edit it; **Save to library** stores the result. Dropping an image anywhere on the dialog switches to Import.
- **Type:**
  - Your name previewed live in four script fonts: Great Vibes, Dancing Script, Allura, Caveat (SIL OFL 1.1, from pinned `@fontsource` packages, bundled locally by Vite and split by script so only needed subsets download).
  - Black or dark-blue ink.
  - Rendered with `document.fonts.load` first (no fallback-font first render), at a 160 px font size (reduced for long names to keep under 1600 px), padded for swashes, then trimmed to the ink (`typedSignature.ts`).
- **Draw:**
  - Canvas pad at device-pixel resolution, sized by a `ResizeObserver` (it starts in a hidden tab). Pointer events with `touch-action: none` and pointer capture; coalesced events for smooth fast strokes.
  - Curves through the midpoints between samples; pen pressure varies width between about 0.4× and 1.6× (mouse and touch use a constant width).
  - Undo stroke, Clear, ink colour. The baseline guide and hint are page elements, so they're never exported.
  - Exported by re-drawing the strokes at 3× the pad size, then trimming (`drawing.ts`).
- **Recipes:** stored signatures gain an optional `recipe` (typed text, font and colour, or the raw strokes and pad size), kept for possible vector output later and included in library exports.
- **Fix found on the way:** library records are Solid store proxies, which IndexedDB can't clone once they contain nested objects (like strokes); records are now `unwrap`ped before saving.
- **Tests:** 3 new web tests for stroke smoothing, single-tap dots, and pressure widths (18 web tests in total).
- **Your check:** type your name and try each font and both inks; draw a signature with the mouse (and a pen or touch screen if you have one), use Undo stroke and Clear; save both, place them, download, and zoom to 200% in a PDF viewer to check they're crisp.

### Chunk 7: Harden the core library ✅
Already done in chunk 1: multiple placements sharing one image, rotation (0/90/180/270) and CropBox handling, refusing encrypted PDFs.
- **Test corpus** (`crates/pdf-stamp/tests/corpus/`, sources in its README):
  - **Real files:** four unmodified US government PDFs, which are public domain. They cover an IRS XFA/AcroForm form with usage rights, a Word export (Acrobat PDFMaker, tagged), a LibreOffice letter edited in macOS Preview (incremental update), and an Acrobat scan with JPEG 2000 images.
  - **Generated files** (`just corpus`, committed): broken, missing, or shifted xref tables; junk before the header; truncation; unbalanced `q`/`Q`; missing MediaBox; `/UserUnit`; real-number `/Rotate`; missing, dangling, or array `/Contents`; shared indirect resources; a deep page tree; PDF 2.0; object streams + linearization; owner-only, user-password, and RC4 encryption; a decompression bomb; and non-PDFs.
- **Corpus test** (`tests/corpus.rs`): every file has a stated expectation. For files that should sign, every page gets a stamp, and then:
  - the output reloads with the same pages, geometry, and catalog entries;
  - `qpdf --check` passes with no warnings;
  - rendered with poppler, the stamp is exactly where it was placed and no other pixel changed.
  qpdf and poppler are optional; their checks are skipped with a warning if missing. `poppler-utils` was added to the Dockerfile.
- **pdf.js cross-check** (`crates/pdf-stamp-wasm/corpus.ts`, part of `just wasm-smoke`): pdf.js and the WASM build agree on every corpus file's page count and sizes. The app places signatures with pdf.js sizes and stamps with WASM, so a disagreement would misplace signatures.
- **Bugs the corpus found, now fixed:**
  - Geometry now matches pdf.js: `/UserUnit` scales the page, a missing or empty MediaBox means US Letter, and `/Rotate 90.0` counts. Before, signatures on such pages landed in the wrong place, or stamping failed.
  - **Broken xref tables:** lopdf rebuilds the table only when it can't parse it. It gave up when the offsets were wrong or the trailer was missing. A small repair step (`repair.rs`) now scans for objects, finds the catalog, and appends a fresh table, as viewers do.
  - **Unbalanced content:** a `Q` with no matching `q` made poppler blank the whole page, so the stamp vanished. Unclosed `q`s would have leaked their transform onto the stamp. Both are balanced now.
  - A dangling `/Contents` reference produced a qpdf warning; it now counts as an empty page.
- **Limits:** untrusted PDFs load with a 64 MB per-stream decompression limit. Signature images are refused above 10,000 px per side, based on the header alone. NaN, infinite, or non-positive placement sizes are refused.
- **User-facing errors:** each failure case has a plain-sentence message, shown as is in the app, for example "This PDF is password-protected or has security restrictions, so it can't be signed here."
- **Early warnings in the app:** on opening a PDF, the worker runs `inspect`, which uses the same loading as stamping. The banner then says straight away if the PDF can't be signed, if it is **digitally signed** (stamping rewrites the file, invalidating the signature), or if pdf.js and the stamper disagree on its pages.
- **Reader usage rights** (`/Perms /UR3`, as on IRS forms) are removed when stamping. Otherwise Acrobat Reader warns that the document "has been changed since it was created" and disables features.
- **Tests:** 9 unit, 13 stamping, and 2 corpus tests in Rust; 20 web tests. The WASM build is 1000 KB, up from 973 KB.
- **Known limits** (see §11): any existing digital signature is invalidated; PDFs with only an owner password are refused even though they open without one; a file opening in pdf.js but not lopdf is reported as damaged.
- **Your check:** open the corpus outputs in `target/tmp/corpus/` in Chrome and Acrobat Reader. Check especially the IRS form, which should show no "document has been changed" warning, and `generated--user-unit-2.pdf`. Then, in the app, open `generated/encrypted-owner-password-only.pdf` and see the warning appear on open.

### Chunk 8: Polish ✅
- **Undo/redo** (`history.ts`, snapshot-based, 200 steps): placing, moving, resizing, nudging and removing. Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. There are also ↶ ↷ buttons in the sidebar.
  - A whole drag or resize is one step, and so is a run of arrow-key nudges until the key is released. A click without movement records nothing.
  - In text fields, the browser's own undo applies. Placements whose signature has since been deleted from the library don't come back.
- **Arrow keys** nudge the selected placement by 1 pt, or 10 pt with Shift.
- **Moving between pages:** while dragging, the placement follows the pointer onto whichever page it's over, keeping the point where it was grabbed. Between pages it stays on the last one. Drags now listen on the window, because the box is re-created on its new page mid-drag.
- **Unsaved changes:** the placements are compared with those at the last download.
  - Closing or reloading the tab asks first (`beforeunload`).
  - So does opening another PDF.
  - Undoing back to the downloaded state counts as saved.
- **Tests:** 4 new history tests (24 web tests in total). Typecheck and build pass. The interactions themselves were not run in a browser here.
- **Your checks:**
  - **Chrome:** drag a signature from one page to the next, including at 50% zoom with several pages visible. Undo and redo a drag, a resize, a nudge run, and a delete. Close the tab with unsaved placements, then do the same after downloading.
  - **Spot-check** Edge, Firefox and Safari. On iOS, check touch drawing and dragging a placement, including across pages.

### Chunk 9: PWA, server and container image ✅
**As built**
- **Dev Samples menu:** it now also lists the test corpus (`corpus/real`, `corpus/generated`) and the stamped corpus outputs from the last `cargo test` (`corpus-stamped`), grouped by folder. It is dev-only; remove it before release.
- **PWA:** `vite-plugin-pwa` 1.3.0 (2.0.0 was under two weeks old). It precaches 30 files (about 2 MB). pdf.js data is cached on first use, and the licence page is fetched when opened, not precached.
  - **Icons:** `web/public/icon.svg`, rendered to 192 px, 512 px (also used as the maskable icon) and a 180 px Apple touch icon.
  - **Update prompt:** "A new version is available · Reload · Later" (`web/src/pwa.tsx`). No service worker runs in dev.
- **About** (toolbar): the privacy statement and a link to `licenses.txt`. The file is generated at build time from the runtime npm packages (including the fonts' OFL text) and the Rust crates compiled into the WASM (via `cargo metadata`). Each package is listed once, and each distinct licence text appears once.
- **Server** (`crates/pdf-flex-server`): axum 0.8.9, tower-http 0.7.1, and tokio 1.53.1 (1.53.2 was too new).
  - Configured with `--addr` and `--dir`, or `PDF_FLEX_ADDR` and `PDF_FLEX_DIR`. It refuses to start without an `index.html`.
  - Logs one line per request. Shuts down gracefully on SIGTERM.
  - The release binary is 2.7 MB.
  - **CSP:** `style-src` also allows `'unsafe-inline'`, because the UI and pdf.js set element styles. `script-src` is `'self' 'wasm-unsafe-eval'` with no `'unsafe-eval'`. pdf.js 6 doesn't use eval at all.
  - **Tests:** 7 in-process tests for headers, MIME types, cache rules, compression, the health check, and path traversal. They were also checked live against the real `web/dist`.
- **Image:** a multi-stage `Dockerfile` plus `.dockerignore`. Image versions are build arguments at the top (Alpine 3.22, Rust 1.98, Bun 1.4.3). BuildKit builds the `wasm` and `server` stages in parallel.
  - **`wasm`** (`rust:${RUST_VERSION}-alpine${ALPINE_VERSION}`): adds the wasm32 target and runs `wasm-pack build` plus `licenses.sh`, the same commands as `just wasm`.
    - Adding the target retries up to five times. Its download from static.rust-lang.org was seen failing mid-transfer with an HTTP/2 stream error, from the dev container too, so it isn't Docker-specific.
    - `wasm-pack` 0.15.0 and the `wasm-bindgen-cli` version from `Cargo.lock` are installed with cargo, and `wasm-opt` comes from Alpine's `binaryen`. wasm-pack's own downloads are glibc builds.
  - **`server`** (same Rust base): builds `pdf-flex-server`. It needs no wasm32 target.
  - **`web`** (`oven/bun:${BUN_VERSION}-alpine`): runs `bun install` and `bun run build` (typecheck, then Vite), using the WASM package from the `wasm` stage. TypeScript 7's compiler is a static binary, and Vite's native parts ship musl builds, so both run on Alpine.
  - **`runner`** (`alpine:${ALPINE_VERSION}`, non-root): only the server binary and `web/dist`.
  - Cache mounts keep the cargo registry, each Rust stage's `target/`, and Bun's cache between builds.
- **Crate licences:** `crates/pdf-stamp-wasm/licenses.sh` (POSIX sh) runs as part of `just wasm`. It writes `pkg/crate-licenses.txt` from `cargo tree` and the registry sources, and the web build reads that file. The Bun stage has no cargo, which is why the list is made in the Rust stage. It lists only the crates shipped in the WASM: no proc-macros, and no server dependencies (the old `cargo metadata` list wrongly included zlib-rs).
- **Recipes:** `just serve`, `just image` and `just image-run`.
- **Dev container:** the `docker-outside-of-docker` feature, with port 8080 forwarded.
- **Not verified here:** the dev container had no Docker, so **the image has not been built yet**. Install, offline use and CSP violations haven't been checked in a browser either.
- **Your checks:**
  1. Rebuild the dev container.
  2. Run `just image && just image-run` and fix anything the first build turns up.
  3. In Chrome at `localhost:8080`, install the app. Open and sign a PDF with DevTools open: the console should show no CSP errors, and the network tab no requests while opening or saving.
  4. Stop the container, reopen the installed app, and sign a PDF offline.
  5. Rebuild after a small change and confirm the "new version" prompt appears.
  6. `just serve` tests the same server without Docker.

**Plan**

**PWA**
- Manifest (name, colours, `display: standalone`) and icons: 192 and 512 px, plus a maskable icon and an Apple touch icon.
- A service worker from `vite-plugin-pwa` (Workbox `generateSW`):
  - **Precache the app shell:** HTML, JS, CSS, the WASM, and the signature fonts, so the app works offline after the first visit.
  - **Cache pdf.js runtime data on first use** (CMaps, standard fonts, decoders), since precaching all of it would be several MB.
- **Updates:** a new version waits until the user chooses to reload ("Update available · Reload"). It never reloads under someone mid-signing.
- **Strict CSP**, sent by the server: `default-src 'self'`, `connect-src 'self'`, `worker-src 'self' blob:`, `img-src 'self' blob: data:`, `object-src 'none'`, `frame-ancestors 'none'`. Plus `script-src 'self' 'wasm-unsafe-eval'`, which WebAssembly needs. Confirm in DevTools that pdf.js and the WASM run with no CSP violations, and that opening and saving make **zero network requests**.
- **Licence notices** in the build: the OFL text for the bundled fonts (required when redistributing them), plus the licences for pdf.js (Apache-2.0) and the Rust crates. An "About" link in the app shows them along with "nothing leaves your device".
- PWA install needs a secure context. `localhost` counts, so everything in this chunk can be tested locally.

**Server: `crates/pdf-flex-server` (axum + tower-http)**
- Serves the built `web/dist/` from a directory (`--dir`, default `/srv/www`). Configured by flags or environment variables: listen address and port (default `0.0.0.0:8080`).
- **Headers:**
  - The CSP above, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a restrictive `Permissions-Policy`.
  - `application/wasm` and `application/manifest+json` MIME types.
- **Caching:**
  - Hashed assets (`/assets/*`): `max-age=31536000, immutable`.
  - `index.html`, `sw.js` and the manifest: `no-cache`, so updates are always noticed.
- **Compression:** gzip and brotli, served from files precompressed at build time where present, otherwise compressed on the fly.
- `GET /healthz` for the container health check. Graceful shutdown on SIGTERM. Logs requests (method, path, status) but never bodies, and there are no upload routes at all.
- **Tests:** in-process tests (tower `oneshot`) covering headers, MIME types, cache rules, 404s, and that path traversal is refused.

**Container image**
- A two-stage `Dockerfile` at the repo root, both stages on **Alpine** (versions pinned):
  - **Builder:** Rust (musl) plus the `wasm32` target, `wasm-pack`, `binaryen` (wasm-pack can't download `wasm-opt` for musl), Bun (musl build), and `just`. It runs `just build` for the web app and WASM, then `cargo build --release -p pdf-flex-server`. Dependency layers are cached so code-only changes rebuild quickly.
  - **Runner:** plain `alpine` with a non-root user, holding only the static server binary and `web/dist/`. `EXPOSE 8080` and a `HEALTHCHECK` on `/healthz`. The target size is under 20 MB.
- `.dockerignore`: `target/`, `node_modules/`, `out/`, `.git/`.
- Nothing x86-specific, so chunk 10 can build `linux/arm64` with `docker buildx`.
- **Recipes:**
  - `just serve` runs the server natively against `web/dist`.
  - `just image` builds `pdf-flex:latest`.
  - `just image-run` starts it on `localhost:8080`.
- **Dev container:** add the `docker-outside-of-docker` feature so `just image` works inside it (requires a container rebuild).
- **Done when:** `just image && just image-run` serves the app on `localhost:8080`. Chrome offers to install it. With the server stopped, the installed app still opens, views and signs a PDF. The DevTools network tab shows no requests while opening or saving, and the console shows no CSP violations.

### Chunk 10: Deploy to the Pi (later)
- Build a `linux/arm64` image (`docker buildx`, from the devcontainer or CI), and push it to a registry or copy it with `docker save | ssh pi docker load`.
- `deploy/docker-compose.yml` on the Pi runs the image (`restart: unless-stopped`) on a LAN port.
- Put it behind the existing **Tailscale reverse proxy**, which terminates TLS, so the app is a secure context and can be installed and used offline from phones and laptops.
- `just deploy`: build, ship, and restart on the Pi.
- **Your check:** install it from a phone and a laptop over the tailnet, then sign a PDF offline.

---

## 4. Approach: browser-only PWA, Rust compiled to WASM

### Why this approach
- **Most of the app is a web page anyway.** pdf.js renders the pages, and dragging and resizing is simple HTML/CSS.
- **Rust still does the part that has to be correct:** writing the PDF. It's compiled to WASM and runs in the page instead of on a server.
- **No server-side processing.** Documents and signatures never leave the device. That's better for privacy, there's nothing to operate, and it works offline.
- **No distribution overhead:** no code signing, notarization, installers, or per-OS builds. Updates go out on deploy.
- **Development fits the existing devcontainer.** Run the dev server in the container and open it in a browser on the host.

### Options considered

| Option | Verdict |
|---|---|
| **PWA, browser-only, Rust → WASM** | ✅ **Chosen.** Simplest to build and ship, private by design. |
| Web app with a Rust server (e.g. axum) doing the PDF work | ❌ Uploads documents and signatures to a server, needs hosting, HTTPS, upload limits and abuse protection, and doesn't work offline. |
| Tauri desktop app | ⏸ **Later, if needed.** It can wrap the same TypeScript UI and the same Rust library with little rework. It adds code signing, notarization, and per-OS builds. |
| Pure-Rust desktop UI (egui, Slint, Iced) | ❌ No mature Rust PDF renderer, so you'd have to ship pdfium; worse accessibility. |

### PWA trade-offs we're accepting
- Saving is always a **download**, usually into the Downloads folder. That's fine for the MVP.
- Installing as an app works best in Chrome and Edge. Safari supports "Add to Dock" on macOS and "Add to Home Screen" on iOS. Firefox desktop has limited support, but the app still works there as a normal web page.
- Browsers can delete stored data, so the saved signature can disappear (see §7.5).

---

## 5. How opening and saving files works in the browser

The word "upload" is confusing here. **Picking a file in a browser doesn't send it anywhere.** It only gives the page permission to read that file locally. A file is uploaded only if the page's code explicitly sends it over the network, and this app never does (§7.6 shows how to enforce that).

### Opening a PDF
Two ways in, which produce the same thing (a `File` object):

1. **File picker:** a standard `<input type="file" accept="application/pdf">`, styled as an "Open PDF…" button. Clicking it opens the OS's normal file dialog.
2. **Drag and drop:** drop a PDF anywhere on the page and read it from the `drop` event's `dataTransfer.files`.

Then:
```ts
const bytes = new Uint8Array(await file.arrayBuffer()); // read locally, in memory
pdfjs.getDocument({ data: bytes.slice() });             // render (pdf.js takes ownership of its copy)
// keep `bytes` and `file.name` for saving later
```

Nothing is written to disk and no network request is made. Closing the tab discards the data.

*Later, Chromium only:* the PWA manifest's `file_handlers` entry plus `launchQueue` can make "Open with → pdf-flex" work from the OS file manager.

### Saving the signed PDF
```ts
const signed: Uint8Array = stamp(bytes, signaturePng, placements); // Rust/WASM
const url = URL.createObjectURL(new Blob([signed], { type: "application/pdf" }));
const a = Object.assign(document.createElement("a"), { href: url, download: `${base}-signed.pdf` });
a.click();
URL.revokeObjectURL(url);
```
The browser saves it like any other download. Depending on the user's browser settings, it either goes straight to Downloads or asks where to save. On iOS it goes to the Files app.

### Getting a signature
- **Import:** the same picker (`accept="image/png,image/jpeg"`) or drag and drop.
- **Type:** rendered from text in a bundled script font onto a canvas.
- **Draw:** captured on a canvas drawing pad with pointer events.

Each ends up as a transparent PNG stored in **IndexedDB** (the signature library), so it's still there next time.

---

## 6. Architecture

```
┌──────────────────────────── Browser tab / installed PWA ───────────────────────────┐
│  TypeScript UI (Vite)                                                              │
│   ├─ Open: <input type=file> / drag-drop → File → Uint8Array (in memory)           │
│   ├─ pdf.js (own worker) → renders each page to <canvas>, lazily                   │
│   ├─ Overlay layer → signature <img> with drag/resize handles (pointer events)     │
│   ├─ State: placements[] in display space                                          │
│   │        { page, x, y, width, height }   (points, bottom-left of page as shown)  │
│   ├─ IndexedDB → signature library (imported / typed / drawn PNGs)                 │
│   └─ Save: Blob → object URL → <a download="…-signed.pdf">                         │
│                         │ postMessage (bytes, png, placements)                     │
│  ┌──────────────────────▼─────────────────────────────────────────────────────┐    │
│  │ Web Worker → pdf-stamp-wasm (Rust, wasm-bindgen)                           │    │
│  │   prepare_signature(img_bytes, threshold) -> png_bytes   (strip bg, trim)  │    │
│  │   stamp(pdf_bytes, png_bytes, placements_json) -> pdf_bytes                │    │
│  │     ├─ load with lopdf                                                     │    │
│  │     ├─ add Image XObject (RGB, Flate) + SMask (alpha) — once               │    │
│  │     ├─ per page: add to /Resources/XObject, wrap existing content in q…Q,  │    │
│  │     │   append "q <matrix incl. rotation> cm /SigN Do Q"                   │    │
│  │     └─ serialize → bytes                                                   │    │
│  └────────────────────────────────────────────────────────────────────────────┘    │
│  Service worker → caches app shell + WASM for offline use                          │
└────────────────────────────────────────────────────────────────────────────────────┘
        ▲ static files only (HTML, JS, WASM, manifest) over HTTPS (via proxy)
┌───────┴────────────────────────┐
│ Raspberry Pi: axum static      │   no backend, no uploads
│ server (Alpine container)      │
│ behind Tailscale reverse proxy │
└────────────────────────────────┘
```

### Key technical choices
- **Rendering: pdf.js**, bundled locally with its worker.
- **Writing: `lopdf`**, pure Rust, compiled to WASM. **Fallback** if it can't do the job: `pdf-lib` (a JS library, MIT) for the writing step. That would mean giving up Rust for this part, so treat it as a last resort.
- **Image handling:** the `image` crate (PNG and JPEG only) for decoding, alpha extraction, thresholding, and trimming.
- **JS ↔ Rust bindings:** `wasm-bindgen` + `wasm-pack` (target `web`), loaded inside a Web Worker.
- **Frontend:** **SolidJS** + TypeScript on Vite (`vite-plugin-solid`), with Bun as the package manager and script runner. Solid's fine-grained signals suit the drag and resize overlay well: only the moved element updates, with no virtual-DOM diffing on every pointer move. Keep `placements` in a Solid store, which makes undo/redo snapshots simple.
- **PWA:** `vite-plugin-pwa` for the manifest and the service worker.
- **One source of truth for coordinates:** the frontend sends display-space points; Rust owns every PDF-specific transform (CropBox, rotation). Both sides are unit-tested.

### Proposed repo layout
```
pdf-flex/
├─ PLAN.md
├─ Cargo.toml                # workspace
├─ justfile                  # just dev / just build / just test
├─ crates/
│  ├─ pdf-stamp/             # pure Rust library, no WASM/JS deps
│  │  ├─ src/lib.rs          #   fn stamp(pdf: &[u8], sig: &RgbaImage, placements) -> Result<Vec<u8>>
│  │  └─ tests/fixtures/     #   rotated, cropped, encrypted, malformed PDFs
│  ├─ pdf-stamp-wasm/        # thin wasm-bindgen wrapper around pdf-stamp
│  └─ pdf-flex-server/       # axum static server for web/dist (chunk 9)
├─ Dockerfile                # Alpine builder + runner (chunk 9)
└─ web/                      # Vite + TS + pdf.js + PWA manifest/service worker
   ├─ src/
   │  ├─ worker.ts           # loads the WASM, handles stamp requests
   │  └─ ...
   └─ public/                # icons, manifest assets
```
Keeping `pdf-stamp` free of WASM-specific code means it can be tested natively with `cargo test`, could later power a CLI, and can be reused as-is by a Tauri wrapper.

---

## 7. Blind spots

Roughly in order of how much they will hurt.

### 7.1 PDF coordinate systems
- PDF units are **points (1/72 in)**, the **origin is bottom-left**, and **y points up**. Screens are top-left with y down.
- **Page rotation (`/Rotate` 90/180/270):** the page you see is rotated relative to the page's own coordinate space. A signature placed on a rotated page must be counter-rotated or it will come out sideways.
- **MediaBox vs. CropBox:** the visible area may not start at (0,0).
- Zoom level × `devicePixelRatio` (HiDPI/Retina) × PDF points all have to agree.
- **Mitigation (implemented in chunk 1):** placements are in **display space**: points with the origin at the bottom-left of the page *as a viewer shows it*. The frontend only divides by the zoom level and flips y. Rust reads the CropBox and `/Rotate` (following page-tree inheritance) and applies the matching transform. The generated test PDFs cover each rotation and a CropBox offset.

### 7.2 Not breaking the existing PDF
- **Encrypted / password-protected PDFs:** detect them and refuse with a clear message for the MVP.
- **Content stream graphics state:** the page's existing content can leave the transformation matrix changed. Wrap the original content in `q … Q` and the stamp in its own `q … Q`, or the signature will land in the wrong place or at the wrong scale on some files.
- **Malformed PDFs:** a lot of real-world PDFs are slightly broken. Viewers tolerate them; strict parsers don't. Build a corpus of test files (scanner output, Word exports, government forms, files from other e-sign tools).
- **Forms (AcroForm/XFA), linearized files, object streams, PDF 2.0:** check that a round-trip through the writer doesn't strip or corrupt these.

### 7.3 Image transparency and quality
- A photo or scan of a signature has a white or grey background. To look right it needs a **transparent background**: threshold or background-removal on import, with a preview.
- In a PDF, PNG alpha is not automatic. You must write the RGB image plus a separate **`/SMask`** greyscale image. JPEG has no alpha.
- Embed at a sensible resolution (around 300 DPI at the expected print size), not screen resolution. Otherwise it looks pixelated in print.
- Reuse a single image object across multiple placements so the file doesn't grow with each one.

### 7.4 Flatten into the page or add as an annotation?
- **Into the page content (recommended):** part of the page. Every viewer shows and prints it. Not trivially movable.
- **Stamp annotation:** can be moved or deleted in other viewers, depends on print flags, and some viewers render the appearance stream differently.
- **MVP: write into the page content.**

### 7.5 Browser storage can disappear
- IndexedDB can be cleared by the user, by "clear site data", or by the browser under storage pressure.
- **Safari deletes data for sites that aren't installed after 7 days without use.** Installed home-screen and Dock apps are exempt.
- **Mitigations:**
  - Call `navigator.storage.persist()`.
  - Make re-importing the signature a one-click action.
  - Offer **Export library** as a download so the user keeps their own copy (chunk 5).

### 7.6 Privacy and trust
- Users have to trust that a hosted web app doesn't upload their files, and its code changes whenever you deploy. Make "nothing leaves your device" verifiable:
  - **Content-Security-Policy** with `connect-src 'self'` (or `'none'` after load) and no third-party scripts, analytics, or fonts.
  - Bundle pdf.js and its worker locally, not from a CDN.
  - Say it in the UI, and if the repo is open source, link to the code.
- PDFs are untrusted input. pdf.js and the WASM code both run inside the browser sandbox, which is a good baseline. Keep the dependencies up to date.

### 7.7 WASM specifics
- **Crate compatibility:** lopdf and `image` are pure Rust, but check that they build for `wasm32-unknown-unknown`. You may need to turn off default features such as threading (`rayon`) and some codecs. Any dependency that needs randomness must enable `getrandom`'s browser (`js`) backend.
- **Bundle size:** aim for well under 1–2 MB of WASM. Build with `opt-level="z"`, LTO, and `wasm-opt`, and only enable the image formats you need.
- **Keep the UI responsive:** run the stamp step in a **Web Worker** so large files don't freeze the page.
- **Memory:** passing bytes between JS and WASM copies them. That's fine for normal documents. Check behaviour with a 100+ MB PDF.
- **The pdfium fallback is much harder in WASM,** so confirm early that lopdf can do the job (chunks 1–2).

### 7.8 Browser differences
- **Chrome (desktop) is the primary target** for development and testing. Spot-check Edge, Firefox, and Safari (including iOS Safari for touch drag and resize) before calling the MVP done.
- Use pointer events (not separate mouse and touch handlers) for the drag and resize.
- Service workers and PWA install need a **secure context**: HTTPS or `localhost`.
  - During development, VS Code's port forwarding from the devcontainer appears as `localhost` on the host, so that works.
  - **On the Pi, plain `http://raspberrypi.local` is not a secure context.** The app would load, but it couldn't be installed or work offline. HTTPS will come from the Tailscale reverse proxy (see §9).

### 7.9 UX details that matter
- Undo/redo for placing, moving, resizing, and deleting.
- Warn about unsaved changes when closing the tab (`beforeunload`).
- Keyboard nudging with arrow keys, and Delete to remove.
- Large PDFs (hundreds of pages): render pages lazily and virtualize the page list. Run pdf.js in its worker.
- Make sure what you see is what gets saved. Optionally re-render the saved bytes with pdf.js before downloading.
- **Typed and drawn signatures:** render at high resolution (not screen size) so they print crisply; trim empty space so the placement box hugs the ink; wait for web fonts to load before drawing text to a canvas, or the first render uses a fallback font.

### 7.10 Licensing
| Library | Licence | Note |
|---|---|---|
| pdf.js | Apache-2.0 | ✅ |
| lopdf | MIT | ✅ |
| image | MIT / Apache-2.0 | ✅ |
| Script fonts (Dancing Script, Great Vibes, Caveat, Allura) | SIL Open Font Licence 1.1 | ✅ Bundle with their licence files |
| pdfium (via `pdfium-render`) | BSD-3 / Apache-2.0 | ✅ but hard to use from WASM |
| **MuPDF** | **AGPL** or commercial | ⚠️ Avoid unless the app will be open-sourced under AGPL |

---

## 8. Dev environment

Done in chunk 0. The Dockerfile installs:
- the `wasm32-unknown-unknown` Rust target and `wasm-pack`;
- `qpdf`, for checking output PDFs.

`devcontainer.json` forwards **5173** (the Vite dev server). Bun runs Vite and the frontend scripts. No GUI setup is needed: open `http://localhost:5173` in Chrome on the host.

---

## 9. Hosting on the Raspberry Pi

**Deferred until chunk 10** (the server and image come in chunk 9). Development uses `localhost`, which browsers already treat as secure, so service workers work there and the app can even be installed from it.

The app is just static files, so the Pi doesn't build anything and doesn't need Rust. It runs the chunk 9 container image (axum static server on Alpine), built for `linux/arm64`.

**The plan:** the container serves plain HTTP on the LAN, behind the **existing Tailscale reverse proxy**, which terminates TLS. That covers the HTTPS requirement for PWAs (§7.8) with no new certificate work. The CSP and other headers come from the server itself, so the proxy needs no special config.

```yaml
# deploy/docker-compose.yml (on the Pi): sketch
services:
  web:
    image: pdf-flex:latest       # linux/arm64 build of the chunk 9 image
    restart: unless-stopped
    ports: ["8080:8080"]
```

---

## 10. Later: Tauri desktop wrapper (only if needed)

Reasons to add it later:
- Saving over the original file on every browser and OS
- Proper OS file associations everywhere
- An installable desktop app that doesn't depend on a browser

How:
- Reuse the `web/` UI as the Tauri frontend.
- Call `pdf-stamp` natively through Tauri commands, or keep using the WASM build.

What it costs:
- Code signing and notarization fees
- Per-OS CI builds
- WebKitGTK quirks on Linux

---

## 11. Later / post-MVP ideas

- Drawn and typed signatures as **vector** output (PDF paths, or an embedded font for text) for crisp output at any size.
- Text stamps: printed name, date, initials.
- Fill AcroForm fields.
- Merge, split, or reorder pages.
- Chromium extras: File System Access API (`showSaveFilePicker`) to save over the original file, and `file_handlers` for "Open with".
- CLI front end on top of `pdf-stamp`.
- **Incremental save** (lopdf's `IncrementalDocument`): append the stamp as an update instead of rewriting the file. Existing digital signatures would then stay valid for the revision they signed, and unknown or damaged objects would be kept byte for byte. It can't be used for files that needed xref repair.
- Sign PDFs that have only an owner password (permission restrictions), by decrypting and saving without encryption. Decide first whether that's acceptable.
