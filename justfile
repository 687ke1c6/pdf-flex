# List recipes
default:
    @just --list

# Run all tests (Rust + web unit tests)
test:
    cargo test --workspace
    cd web && bun test

# Lint with clippy (warnings are errors)
lint:
    cargo clippy --workspace --all-targets -- -D warnings

# Format all Rust code
fmt:
    cargo fmt --all

# Chunk 1: generate test PDFs + stamped copies in out/, and validate them with qpdf
fixtures:
    cargo run -q -p pdf-stamp --example fixtures
    @for f in out/stamped/*.pdf; do qpdf --check "$f" > /dev/null && echo "qpdf ok: $f"; done
    @# 120 pages mixing every fixture (rotations, crop boxes) for viewer testing
    @qpdf --empty --pages $(for i in $(seq 20); do printf 'out/fixtures/%s ' $(ls out/fixtures); done) -- out/many-pages.pdf && echo "wrote out/many-pages.pdf"

# Stamp a signature onto a PDF, e.g. just stamp in.pdf sig.png out.pdf --page 1 --at 400,40 --width 150
stamp *args:
    cargo run -q -p pdf-stamp --example stamp -- {{args}}

# Build the WASM package into crates/pdf-stamp-wasm/pkg (used by web/ and the demo)
wasm:
    wasm-pack build crates/pdf-stamp-wasm --target web --release --no-pack
    @ls -l crates/pdf-stamp-wasm/pkg/pdf_stamp_wasm_bg.wasm | awk '{printf "wasm size: %.0f KB\n", $5/1024}'

# Run the WASM build headlessly under Bun and validate its output
wasm-smoke: fixtures wasm
    bun crates/pdf-stamp-wasm/smoke.ts
    qpdf --check out/wasm-smoke.pdf > /dev/null && echo "qpdf ok: out/wasm-smoke.pdf"

# Chunk 2: serve the bare WASM demo page on http://localhost:5173
demo: fixtures wasm
    #!/usr/bin/env bash
    set -euo pipefail
    d=crates/pdf-stamp-wasm/demo
    rm -rf $d/pkg && cp -r crates/pdf-stamp-wasm/pkg $d/pkg
    mkdir -p $d/samples
    cp out/sig.png out/fixtures/*.pdf $d/samples/
    (cd $d/samples && ls *.pdf | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin]))' > index.json)
    echo "Serving on http://localhost:5173 (Ctrl+C to stop)"
    python3 -m http.server 5172 --bind 0.0.0.0 --directory $d

# Run the web app dev server on http://localhost:5173 (dev-only Samples menu lists out/)
dev: fixtures wasm
    cd web && bun install --frozen-lockfile && bun run dev

# Typecheck and build the web app into web/dist
build: wasm
    cd web && bun install --frozen-lockfile && bun run build
