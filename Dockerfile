# syntax=docker/dockerfile:1.7
# pdf-sign: the web app (with the Rust stamper compiled to WebAssembly) served
# by the axum static server, on plain Alpine.
#
#   just image       # docker build -t pdf-sign:latest .
#   just image-run   # serves http://localhost:8080
#
# Stages (BuildKit builds `wasm` and `server` in parallel):
#
#   wasm   ── Rust → WebAssembly stamper (pkg/) ── web ── web/dist ──┐
#   server ── Rust → pdf-sign-server binary ─────────────────────────┴── runner
#
# Nothing here is x86-specific, so `docker buildx build --platform linux/arm64`
# works too (chunk 10: the Raspberry Pi).

# Versions of the base images. Override with --build-arg, e.g. RUST_VERSION=1.99.
# Keep BUN_VERSION in step with the dev container (.devcontainer/Dockerfile).
ARG ALPINE_VERSION=3.22
ARG RUST_VERSION=1.98
ARG BUN_VERSION=1.4.3

# ---------------------------------------------------------------------------
# Shared Rust base: the workspace sources.
FROM rust:${RUST_VERSION}-alpine${ALPINE_VERSION} AS rust
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates

# ---------------------------------------------------------------------------
# The stamper as WebAssembly, plus the licences of the crates compiled into it.
FROM rust AS wasm

# The standard library for the wasm32 target isn't in the Rust image. Its
# download from static.rust-lang.org has been seen failing mid-transfer, so
# retry a few times, keeping rustup's download directory between attempts.
RUN --mount=type=cache,target=/usr/local/rustup/downloads \
    ok=; for attempt in 1 2 3 4 5; do \
        rustup target add wasm32-unknown-unknown && ok=1 && break; \
        echo "rustup target add failed (attempt $attempt), retrying in 15s"; sleep 15; \
    done; [ -n "$ok" ]

# wasm-opt from Alpine's binaryen, and the wasm-bindgen CLI at exactly the
# version in Cargo.lock: wasm-pack uses tools found on PATH, and the ones it
# would download are glibc builds that don't run on Alpine.
ARG WASM_PACK_VERSION=0.15.0
RUN apk add --no-cache binaryen
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo install --locked wasm-pack@${WASM_PACK_VERSION} \
    && version=$(awk '/^name = "wasm-bindgen"$/ { getline; gsub(/version = |"/, ""); print }' Cargo.lock) \
    && cargo install --locked wasm-bindgen-cli@"$version"

# Same commands as `just wasm`. The output (pkg/) is outside target/, so it
# survives the cache mount.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target,id=pdf-sign-wasm-target \
    wasm-pack build crates/pdf-stamp-wasm --target web --release --no-pack \
    && sh crates/pdf-stamp-wasm/licenses.sh

# ---------------------------------------------------------------------------
# The static file server: native code only, no wasm32 target needed.
FROM rust AS server
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target,id=pdf-sign-server-target \
    cargo build --release --locked -p pdf-sign-server \
    && cp target/release/pdf-sign-server /usr/local/bin/pdf-sign-server

# ---------------------------------------------------------------------------
# The web app: the same commands as `just build` after its WASM step.
FROM oven/bun:${BUN_VERSION}-alpine AS web
WORKDIR /src/web
# Dependencies first, so source changes don't reinstall them.
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY web ./
COPY --from=wasm /src/crates/pdf-stamp-wasm/pkg /src/crates/pdf-stamp-wasm/pkg
# Typecheck, then build web/dist.
RUN bun run build

# ---------------------------------------------------------------------------
FROM alpine:${ALPINE_VERSION} AS runner

RUN addgroup -S pdfsign && adduser -S -G pdfsign -H pdfsign
COPY --from=server /usr/local/bin/pdf-sign-server /usr/local/bin/pdf-sign-server
COPY --from=web /src/web/dist /srv/www

USER pdfsign
ENV PDF_SIGN_ADDR=0.0.0.0:8080 \
    PDF_SIGN_DIR=/srv/www
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["pdf-sign-server"]
