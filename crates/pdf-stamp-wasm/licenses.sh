#!/bin/sh
# Writes the licence of every third-party crate compiled into the WASM build,
# for the web app's licence page (web/vite.config.ts reads it).
#
# Usage: sh crates/pdf-stamp-wasm/licenses.sh [OUT]   (default: crates/pdf-stamp-wasm/pkg/crate-licenses.txt)
#
# Runs where the crates were built (`just wasm`, or the wasm stage of the
# Dockerfile), because it reads licence files from cargo's registry. Plain
# POSIX sh, so it works on Alpine's busybox.
#
# Output: for each crate, a line "@@@ <name> <version> (<licence>)", then its licence files.
set -eu

out=${1:-crates/pdf-stamp-wasm/pkg/crate-licenses.txt}
registry="${CARGO_HOME:-$HOME/.cargo}/registry/src"

# Normal (shipped) dependencies only, for the wasm target. Skipped: our own
# crates, which show a path ("pdf-stamp v0.1.0 (/src/crates/pdf-stamp)"), and
# proc-macros, which only run at compile time and aren't shipped.
cargo tree --locked -p pdf-stamp-wasm --target wasm32-unknown-unknown -e normal \
    --prefix none --no-dedupe --format '{p}|{l}' |
    grep -v -e ' (/' -e ' (proc-macro)' | sort -u |
    while IFS='|' read -r pkg licence; do
        name=${pkg% v*}
        version=${pkg##* v}
        printf '@@@ %s %s (%s)\n' "$name" "$version" "${licence:-unknown}"
        dir=$(ls -d "$registry"/*/"$name-$version" 2>/dev/null | head -n 1)
        if [ -z "$dir" ]; then
            echo "(source not found in the cargo registry)"
            continue
        fi
        files=$(ls "$dir" | grep -iE '^(licen[cs]e|copying)' || true)
        [ -n "$files" ] || echo "(no licence file in the crate)"
        for f in $files; do
            [ -f "$dir/$f" ] && cat "$dir/$f" && echo
        done
    done > "$out"

echo "wrote $out ($(grep -c '^@@@ ' "$out") crates)"
