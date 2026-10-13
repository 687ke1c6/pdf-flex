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

# Chunk 7: regenerate the synthetic half of the test corpus (outputs are committed; needs qpdf)
corpus:
    cargo run -q -p pdf-stamp --example corpus

# Stamp a signature onto a PDF, e.g. just stamp in.pdf sig.png out.pdf --page 1 --at 400,40 --width 150
stamp *args:
    cargo run -q -p pdf-stamp --example stamp -- {{args}}

# Stamp text onto a PDF, e.g. just stamp-text in.pdf "Jane Smith\n13 Oct 2026" out.pdf --page 1 --at 400,80 --size 12 --font Times-Roman
[positional-arguments]
stamp-text *args:
    cargo run -q -p pdf-stamp --example stamp_text -- "$@"

# Build the WASM package into crates/pdf-stamp-wasm/pkg (used by web/ and the demo)
wasm:
    wasm-pack build crates/pdf-stamp-wasm --target web --release --no-pack
    sh crates/pdf-stamp-wasm/licenses.sh
    @ls -l crates/pdf-stamp-wasm/pkg/pdf_stamp_wasm_bg.wasm | awk '{printf "wasm size: %.0f KB\n", $5/1024}'

# Run the WASM build headlessly under Bun and validate its output; check it agrees with pdf.js on the corpus
wasm-smoke: fixtures wasm
    bun crates/pdf-stamp-wasm/smoke.ts
    qpdf --check out/wasm-smoke.pdf > /dev/null && echo "qpdf ok: out/wasm-smoke.pdf"
    pdftotext out/wasm-smoke.pdf - | grep -q 'Café – 5 €' && echo "pdftotext ok: out/wasm-smoke.pdf"
    cd web && bun install --frozen-lockfile
    bun crates/pdf-stamp-wasm/corpus.ts 2> /dev/null

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

# Serve the built app with the production server on http://localhost:8080
serve: build
    cargo run -q --release -p pdf-flex-server -- --dir web/dist --addr 0.0.0.0:8080

# Build the container image pdf-flex:latest (Alpine builder + runner; see Dockerfile)
image:
    docker build -t pdf-flex:latest .

# Run the container image on http://localhost:8080 (Ctrl+C to stop)
image-run:
    docker run --rm --init -p 8080:8080 --name pdf-flex pdf-flex:latest
