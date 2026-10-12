# pdf-sign — Plan

A web app you can install as a PWA. It opens a PDF, lets you drag your signature image onto a page, move and resize it, and save the result as a new PDF.

**Everything runs in your browser.** The PDF-writing code is Rust compiled to WebAssembly (WASM). The server only hands out static files: no document or signature is ever uploaded.

**Hosting:** self-hosted on the local network, on a Raspberry Pi, behind the existing Tailscale reverse proxy (see §9).

---

## 1. MVP scope

**In scope**
- Open a PDF using a file picker or by dragging it onto the page (see §5).
- Show its pages with scrolling and zoom.
- Import a signature image (PNG/JPEG) once and keep it in the browser for later sessions.
- Drag the signature onto any page, move it, and resize it with the aspect ratio locked.
- Place it more than once, including on different pages, and delete a placement.
- **Save as a download** named `<name>-signed.pdf`. The original file is never touched.
- Works offline once loaded, and can be installed as a PWA.
- The output opens correctly in Acrobat Reader, macOS Preview, Chrome, and Firefox.

**Out of scope for the MVP** (see §11)
- Drawing a signature with mouse or trackpad
- Text, date, or initials fields; form filling
- Editing existing PDF content
- Saving back over the original file
- A desktop app (Tauri)

---

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Hosting | Local network only, on a Raspberry Pi behind the existing Tailscale reverse proxy, which terminates TLS (§9). **Deferred:** dev uses `localhost` |
| 2 | Primary browser | Chrome (desktop) |
| 3 | Encrypt the stored signature? | No. It's a prototype, so store it as plain PNG in IndexedDB |
| 4 | Frontend framework | SolidJS |
| 5 | Target platform | Browser-first (works on Windows and Linux). Windows-only native was considered and rejected: it doesn't remove the hard parts, and the dev container is Linux |

---

## 3. Roadmap

Work proceeds in small chunks. Each one ends with something you can run and check, followed by a review and a commit.

**Status key:** ✅ done · 🔜 next · ⬜ not started

| # | Chunk | Done when | Status |
|---|---|---|---|
| 0 | Environment | Container has the WASM target, `wasm-pack`, and `qpdf`; workspace and `justfile` exist | ✅ |
| 1 | Experiment A: native stamping | Stamped test PDFs look right in Chrome and Acrobat | ✅ |
| 2 | Experiment B: the same code as WASM | A bare page stamps and downloads a PDF in Chrome; WASM size noted | ✅ (pending your Chrome check) |
| 3 | Experiment C: viewer UI | A SolidJS + pdf.js viewer at `localhost:5173` | 🔜 |
| — | **Go/no-go on lopdf** | Continue, or switch to the fallback (§6) | ⬜ |
| 4 | Harden the core library | `cargo test` passes against the test-file corpus | ⬜ |
| 5 | MVP part 1: place and save | **End-to-end:** sign a real PDF in the browser | ⬜ |
| 6 | MVP part 2: polish | Signature import, storage, undo, keyboard shortcuts | ⬜ |
| 7 | PWA and deploy (later) | Installed from a phone or laptop via the Pi | ⬜ |

### Chunk 0: Environment ✅
- Dockerfile: `wasm32-unknown-unknown` target, `wasm-pack`, `qpdf`.
- `devcontainer.json`: forward port 5173 (Vite) instead of the old 3000.
- Cargo workspace (`crates/*`) with a size-optimised release profile; `justfile` (`test`, `lint`, `fmt`); `.gitignore`.

### Chunk 1: Experiment A, native stamping ✅
- `crates/pdf-stamp`: `stamp(pdf, signature_png_or_jpeg, &[Placement]) -> Vec<u8>` using lopdf 0.45 (default features off).
  - Placements are in **display space** (see §7.1); Rust handles the CropBox and `/Rotate`, including values inherited from the page tree.
  - The RGB image plus an `/SMask` for transparency, embedded once and shared by every placement.
  - Existing content is wrapped in `q … Q` and the stamp is appended. Page resources are copied, not edited in place, so shared or inherited dictionaries are safe.
  - Multiple placements and encrypted-PDF refusal came along for free; chunk 4 still covers hardening.
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

### Chunk 3: Experiment C, viewer UI
- `web/`: Vite + SolidJS + TypeScript, with Bun.
- pdf.js with its worker bundled locally; open a PDF with the file picker or by dragging it in.
- Render all pages with lazy rendering, zoom, and scrolling; sharp on HiDPI screens.
- `just dev` runs the dev server.
- **Check:** smooth on a 100-page PDF in Chrome.

### Go/no-go on lopdf
If chunks 1–2 showed lopdf can't stamp reliably or won't build for WASM, switch to the fallback (§6) now.

### Chunk 4: Harden the core library
- Multiple placements across pages, sharing one image XObject.
- Full rotation (0/90/180/270) and CropBox handling.
- Detect encrypted PDFs and refuse them with a clear error.
- Signature preparation: background removal by threshold, trim, and downscale to a sensible maximum size.
- A test-file corpus (scanner output, Word exports, forms, slightly malformed files); `qpdf --check` on every output.

### Chunk 5: MVP part 1, place and save
- Sidebar with the signature; drag it onto a page; move, resize (aspect locked), and delete.
- Convert screen positions to display-space points (divide by the zoom level, flip y), with unit tests.
- Stamp in a Web Worker and download `<name>-signed.pdf`.

### Chunk 6: MVP part 2, polish
- Import the signature with a preview; store it in IndexedDB; `navigator.storage.persist()`.
- Undo/redo; arrow-key nudging; Delete to remove.
- Unsaved-changes warning (`beforeunload`).
- Spot-check Edge, Firefox, and Safari.

### Chunk 7: PWA and deploy (later)
- Manifest, icons, and a service worker (`vite-plugin-pwa`) for offline use.
- Strict CSP; confirm in DevTools that opening and saving make zero network requests.
- `just deploy`: build, then rsync `web/dist/` to the Pi.
- Serve from the Pi behind the Tailscale reverse proxy (§9).

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

*Later, Chromium only:* the PWA manifest's `file_handlers` entry plus `launchQueue` can make "Open with → pdf-sign" work from the OS file manager.

### Saving the signed PDF
```ts
const signed: Uint8Array = stamp(bytes, signaturePng, placements); // Rust/WASM
const url = URL.createObjectURL(new Blob([signed], { type: "application/pdf" }));
const a = Object.assign(document.createElement("a"), { href: url, download: `${base}-signed.pdf` });
a.click();
URL.revokeObjectURL(url);
```
The browser saves it like any other download. Depending on the user's browser settings, it either goes straight to Downloads or asks where to save. On iOS it goes to the Files app.

### Importing the signature image
Use the same picker (`accept="image/png,image/jpeg"`) or drag and drop. The processed PNG is then stored in **IndexedDB** so it's still there next time.

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
│   ├─ IndexedDB → stored signature PNG                                              │
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
│ Raspberry Pi: static server    │   no backend, no uploads
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
pdf-sign/
├─ PLAN.md
├─ Cargo.toml                # workspace
├─ justfile                  # just dev / just build / just test
├─ crates/
│  ├─ pdf-stamp/             # pure Rust library, no WASM/JS deps
│  │  ├─ src/lib.rs          #   fn stamp(pdf: &[u8], sig: &RgbaImage, placements) -> Result<Vec<u8>>
│  │  └─ tests/fixtures/     #   rotated, cropped, encrypted, malformed PDFs
│  └─ pdf-stamp-wasm/        # thin wasm-bindgen wrapper around pdf-stamp
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
  - Optionally offer "Export signature" as a download so the user keeps their own copy.

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

### 7.10 Licensing
| Library | Licence | Note |
|---|---|---|
| pdf.js | Apache-2.0 | ✅ |
| lopdf | MIT | ✅ |
| image | MIT / Apache-2.0 | ✅ |
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

**Deferred until chunk 7.** Development uses `localhost`, which browsers already treat as secure, so service workers work there and the app can even be installed from it.

The app is just static files, so the Pi doesn't build anything and doesn't need Rust. Build in the devcontainer, then copy `web/dist/` across.

**The plan:** a small static file server on the Pi, serving plain HTTP on the LAN, behind the **existing Tailscale reverse proxy**, which terminates TLS. That covers the HTTPS requirement for PWAs (§7.8) with no new certificate work.

```yaml
# deploy/docker-compose.yml (on the Pi): sketch
services:
  web:
    image: caddy:2-alpine        # multi-arch, includes arm64
    restart: unless-stopped
    ports: ["8080:80"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro   # file_server, CSP headers, .wasm MIME
      - ./dist:/srv:ro
```
Any static server works (nginx, or a tiny Rust one). Caddy is suggested because it sets the CSP headers (§7.6) and the `.wasm` MIME type (`application/wasm`) with a few lines of config.

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

- Draw a signature with mouse, trackpad, or stylus, stored as vector paths for crisp output at any size.
- Text stamps: printed name, date, initials.
- Fill AcroForm fields.
- Merge, split, or reorder pages.
- Chromium extras: File System Access API (`showSaveFilePicker`) to save over the original file, and `file_handlers` for "Open with".
- CLI front end on top of `pdf-stamp`.
