//! Serves the built pdf-sign web app (`web/dist/`).
//!
//! The app needs no backend: PDFs and signatures never leave the browser.
//! This server only hands out static files, adding:
//! - a strict Content-Security-Policy and other security headers, so the
//!   browser itself enforces that the page talks to no other origin;
//! - cache rules that let hashed assets be cached forever while the entry
//!   points (`index.html`, the service worker, the manifest) always revalidate,
//!   so updates are noticed;
//! - gzip/brotli compression;
//! - `GET /healthz` for container health checks.

use std::{path::PathBuf, time::Instant};

use axum::{
    Router,
    extract::Request,
    http::{HeaderName, HeaderValue, header},
    middleware::{self, Next},
    response::Response,
    routing::get,
};
use tower_http::{compression::CompressionLayer, services::ServeDir};

/// What the page may load and run.
///
/// - Scripts, workers, styles, fonts, data: only from this origin. WebAssembly
///   (the stamper, pdf.js's image decoders) needs `'wasm-unsafe-eval'`; plain
///   `eval` stays forbidden.
/// - `blob:` and `data:` images: signature thumbnails and pdf.js.
/// - Inline styles: element `style` attributes set by the UI and pdf.js.
/// - No plugins, no framing, no form posts, and `connect-src 'self'`: the page
///   cannot send data anywhere else.
pub const CSP: &str = "default-src 'self'; \
    script-src 'self' 'wasm-unsafe-eval'; \
    worker-src 'self' blob:; \
    style-src 'self' 'unsafe-inline'; \
    img-src 'self' blob: data:; \
    font-src 'self' data:; \
    connect-src 'self'; \
    object-src 'none'; \
    base-uri 'self'; \
    form-action 'none'; \
    frame-ancestors 'none'";

/// Browser features the app never uses.
pub const PERMISSIONS_POLICY: &str =
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()";

/// The app, serving files from `dir`.
pub fn app(dir: PathBuf) -> Router {
    let files = ServeDir::new(dir)
        // `/` serves index.html; nothing else falls back to it.
        .append_index_html_on_directories(true);
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .fallback_service(files)
        .layer(middleware::from_fn(headers))
        .layer(CompressionLayer::new().gzip(true).br(true))
        .layer(middleware::from_fn(log))
}

/// Adds security headers to every response, and caching rules by path.
async fn headers(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let mut response = next.run(request).await;
    let h = response.headers_mut();
    let set = |h: &mut axum::http::HeaderMap, name: HeaderName, value: &'static str| {
        h.insert(name, HeaderValue::from_static(value));
    };
    set(h, header::CONTENT_SECURITY_POLICY, CSP);
    set(h, header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    set(h, header::REFERRER_POLICY, "no-referrer");
    set(
        h,
        HeaderName::from_static("permissions-policy"),
        PERMISSIONS_POLICY,
    );
    set(h, header::CACHE_CONTROL, cache_control(&path));

    // Types mime_guess gets wrong or leaves generic.
    let content_type = if path.ends_with(".webmanifest") {
        Some("application/manifest+json")
    } else if path.ends_with(".mjs") {
        Some("text/javascript")
    } else {
        None
    };
    if let Some(ct) = content_type
        && response.status().is_success()
    {
        set(response.headers_mut(), header::CONTENT_TYPE, ct);
    }
    response
}

/// Hashed build assets never change, so they can be cached for a year.
/// Everything else revalidates on each use (cheaply, via Last-Modified), so a
/// new deploy is picked up by the next visit and by the service worker.
fn cache_control(path: &str) -> &'static str {
    if path.starts_with("/assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    }
}

/// One line per request: method, path, status, time. Never bodies or query strings.
async fn log(request: Request, next: Next) -> Response {
    let (method, path) = (request.method().clone(), request.uri().path().to_owned());
    let started = Instant::now();
    let response = next.run(request).await;
    if path != "/healthz" {
        println!(
            "{method} {path} {} {:.1}ms",
            response.status().as_u16(),
            started.elapsed().as_secs_f64() * 1000.0
        );
    }
    response
}
