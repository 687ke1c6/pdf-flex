FROM mcr.microsoft.com/devcontainers/rust:1-bookworm

# unzip is required by the Bun installer; qpdf validates generated PDFs
RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip qpdf \
    && rm -rf /var/lib/apt/lists/*

USER vscode

# Task runner and file watcher used by the justfile (`just dev`)
RUN cargo install --locked cargo-watch just

# WebAssembly target and bindings tooling for crates/pdf-stamp-wasm
RUN rustup target add wasm32-unknown-unknown \
    && cargo install --locked wasm-pack

# Bun 1.4.x (the Rust rewrite), pinned
ARG BUN_VERSION=1.4.3
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
ENV BUN_INSTALL=/home/vscode/.bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
