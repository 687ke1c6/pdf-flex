//! pdf-sign-server: serves the built web app.
//!
//! Usage: pdf-sign-server [--addr HOST:PORT] [--dir PATH]
//! Defaults come from PDF_SIGN_ADDR / PDF_SIGN_DIR, then 0.0.0.0:8080 and /srv/www.

use std::{env, net::SocketAddr, path::PathBuf, process};

use tokio::net::TcpListener;

const USAGE: &str = "usage: pdf-sign-server [--addr HOST:PORT] [--dir PATH]";

#[tokio::main]
async fn main() {
    let (addr, dir) = match config() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: {e}\n{USAGE}");
            process::exit(2);
        }
    };
    if !dir.join("index.html").is_file() {
        eprintln!(
            "error: {} has no index.html (build the web app with `just build`)",
            dir.display()
        );
        process::exit(1);
    }

    let listener = match TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("error: can't listen on {addr}: {e}");
            process::exit(1);
        }
    };
    println!("serving {} on http://{addr}", dir.display());
    if let Err(e) = axum::serve(listener, pdf_sign_server::app(dir))
        .with_graceful_shutdown(shutdown())
        .await
    {
        eprintln!("error: {e}");
        process::exit(1);
    }
}

fn config() -> Result<(SocketAddr, PathBuf), String> {
    let mut addr = env::var("PDF_SIGN_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let mut dir = env::var("PDF_SIGN_DIR").unwrap_or_else(|_| "/srv/www".into());
    let mut args = env::args().skip(1);
    while let Some(flag) = args.next() {
        let value = args.next().ok_or(format!("{flag} needs a value"))?;
        match flag.as_str() {
            "--addr" => addr = value,
            "--dir" => dir = value,
            _ => return Err(format!("unknown option {flag}")),
        }
    }
    let addr = addr
        .parse()
        .map_err(|_| format!("invalid address {addr}"))?;
    Ok((addr, PathBuf::from(dir)))
}

/// Resolves on Ctrl+C or SIGTERM (what `docker stop` sends), letting in-flight requests finish.
async fn shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = term => {},
    }
    println!("shutting down");
}
