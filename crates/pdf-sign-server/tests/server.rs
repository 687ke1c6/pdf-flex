use std::{
    fs,
    path::{Path, PathBuf},
};

use axum::{
    body::Body,
    http::{Request, Response, StatusCode, header},
};
use http_body_util::BodyExt;
use pdf_sign_server::{CSP, app};
use tower::ServiceExt;

/// A throwaway dist/ with one file of each kind the app ships.
fn dist(name: &str) -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("assets")).unwrap();
    fs::create_dir_all(dir.join("pdfjs/cmaps")).unwrap();
    fs::write(
        dir.join("index.html"),
        "<!doctype html><title>pdf-sign</title>",
    )
    .unwrap();
    fs::write(
        dir.join("sw.js"),
        "self.addEventListener('install', () => {});",
    )
    .unwrap();
    fs::write(dir.join("manifest.webmanifest"), r#"{"name":"pdf-sign"}"#).unwrap();
    fs::write(
        dir.join("assets/index-abc123.js"),
        "console.log(1);".repeat(200),
    )
    .unwrap();
    fs::write(dir.join("assets/pdf.worker.min-abc123.mjs"), "export {};").unwrap();
    fs::write(
        dir.join("assets/pdf_stamp_wasm_bg-abc123.wasm"),
        b"\0asm\x01\0\0\0",
    )
    .unwrap();
    fs::write(dir.join("pdfjs/cmaps/Adobe-Japan1-0.bcmap"), b"\x01\x02").unwrap();
    dir
}

async fn get(dir: &Path, uri: &str, accept_encoding: Option<&str>) -> Response<Body> {
    let mut request = Request::get(uri);
    if let Some(enc) = accept_encoding {
        request = request.header(header::ACCEPT_ENCODING, enc);
    }
    app(dir.to_path_buf())
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
}

fn header_of(response: &Response<Body>, name: header::HeaderName) -> &str {
    response
        .headers()
        .get(name)
        .map(|v| v.to_str().unwrap())
        .unwrap_or("")
}

#[tokio::test]
async fn serves_the_app_with_security_headers() {
    let dir = dist("headers");
    let response = get(&dir, "/", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(header_of(&response, header::CONTENT_TYPE).starts_with("text/html"));
    assert_eq!(header_of(&response, header::CONTENT_SECURITY_POLICY), CSP);
    assert_eq!(
        header_of(&response, header::X_CONTENT_TYPE_OPTIONS),
        "nosniff"
    );
    assert_eq!(header_of(&response, header::REFERRER_POLICY), "no-referrer");
    assert!(!header_of(&response, "permissions-policy".parse().unwrap()).is_empty());
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert!(body.starts_with(b"<!doctype html>"));

    // Headers apply to errors too.
    let missing = get(&dir, "/nope.js", None).await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    assert_eq!(header_of(&missing, header::CONTENT_SECURITY_POLICY), CSP);
}

#[test]
fn csp_keeps_the_page_to_its_own_origin() {
    assert!(CSP.contains("default-src 'self'"));
    assert!(CSP.contains("connect-src 'self'"));
    assert!(CSP.contains("script-src 'self' 'wasm-unsafe-eval';"));
    assert!(!CSP.contains("'unsafe-eval'"));
    assert!(CSP.contains("frame-ancestors 'none'"));
}

#[tokio::test]
async fn content_types() {
    let dir = dist("types");
    for (uri, expected) in [
        ("/assets/pdf_stamp_wasm_bg-abc123.wasm", "application/wasm"),
        ("/manifest.webmanifest", "application/manifest+json"),
        ("/assets/pdf.worker.min-abc123.mjs", "text/javascript"),
        ("/sw.js", "text/javascript"),
    ] {
        let response = get(&dir, uri, None).await;
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
        assert_eq!(
            header_of(&response, header::CONTENT_TYPE),
            expected,
            "{uri}"
        );
    }
}

#[tokio::test]
async fn cache_rules() {
    let dir = dist("cache");
    let immutable = "public, max-age=31536000, immutable";
    for (uri, expected) in [
        ("/assets/index-abc123.js", immutable),
        ("/assets/pdf_stamp_wasm_bg-abc123.wasm", immutable),
        ("/", "no-cache"),
        ("/index.html", "no-cache"),
        ("/sw.js", "no-cache"),
        ("/manifest.webmanifest", "no-cache"),
        ("/pdfjs/cmaps/Adobe-Japan1-0.bcmap", "no-cache"),
    ] {
        let response = get(&dir, uri, None).await;
        assert_eq!(
            header_of(&response, header::CACHE_CONTROL),
            expected,
            "{uri}"
        );
    }
}

#[tokio::test]
async fn compresses_when_asked() {
    let dir = dist("compression");
    let br = get(&dir, "/assets/index-abc123.js", Some("br, gzip")).await;
    assert_eq!(header_of(&br, header::CONTENT_ENCODING), "br");
    let gzip = get(&dir, "/assets/index-abc123.js", Some("gzip")).await;
    assert_eq!(header_of(&gzip, header::CONTENT_ENCODING), "gzip");
    let plain = get(&dir, "/assets/index-abc123.js", None).await;
    assert_eq!(header_of(&plain, header::CONTENT_ENCODING), "");
}

#[tokio::test]
async fn refuses_paths_outside_the_directory() {
    let dir = dist("traversal");
    // A file next to dist/, which must not be reachable.
    fs::write(dir.parent().unwrap().join("secret.txt"), "secret").unwrap();
    for uri in [
        "/../secret.txt",
        "/%2e%2e/secret.txt",
        "/assets/../../secret.txt",
        "/assets/%2e%2e/%2e%2e/secret.txt",
    ] {
        let response = get(&dir, uri, None).await;
        assert_ne!(response.status(), StatusCode::OK, "{uri}");
    }
}

#[tokio::test]
async fn health_check() {
    let dir = dist("health");
    let response = get(&dir, "/healthz", None).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&body[..], b"ok");
}
