# List recipes
default:
    @just --list

# Run all Rust tests
test:
    cargo test --workspace

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

# Stamp a signature onto a PDF, e.g. just stamp in.pdf sig.png out.pdf --page 1 --at 400,40 --width 150
stamp *args:
    cargo run -q -p pdf-stamp --example stamp -- {{args}}

# Build the WASM package into crates/pdf-stamp-wasm/demo/pkg
wasm:
    wasm-pack build crates/pdf-stamp-wasm --target web --release --out-dir demo/pkg
    @ls -l crates/pdf-stamp-wasm/demo/pkg/pdf_stamp_wasm_bg.wasm | awk '{printf "wasm size: %.0f KB\n", $5/1024}'

# Run the WASM build headlessly under Bun and validate its output
wasm-smoke: fixtures wasm
    bun crates/pdf-stamp-wasm/smoke.ts
    qpdf --check out/wasm-smoke.pdf > /dev/null && echo "qpdf ok: out/wasm-smoke.pdf"

# Chunk 2: serve the bare WASM demo page on http://localhost:5173
demo: fixtures wasm
    #!/usr/bin/env bash
    set -euo pipefail
    d=crates/pdf-stamp-wasm/demo
    mkdir -p $d/samples
    cp out/sig.png out/fixtures/*.pdf $d/samples/
    (cd $d/samples && ls *.pdf | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin]))' > index.json)
    echo "Serving on http://localhost:5173 (Ctrl+C to stop)"
    python3 -m http.server 5172 --bind 0.0.0.0 --directory $d
