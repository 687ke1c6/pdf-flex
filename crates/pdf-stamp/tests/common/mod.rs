//! Helpers shared by the integration tests.

use std::{
    io::Write,
    process::{Command, Stdio},
};

/// Resolution for render comparisons: 1 pixel = 1 pt.
pub const DPI: u32 = 72;

pub struct Gray {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u8>,
}

pub fn render(pdf: &[u8], page: u32) -> Result<Gray, String> {
    let mut child = Command::new("pdftoppm")
        // The crop box is what viewers show: display space, as placements use.
        .args([
            "-cropbox",
            "-gray",
            "-r",
            &DPI.to_string(),
            "-f",
            &page.to_string(),
            "-l",
            &page.to_string(),
            "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    // Feed stdin from a thread so a large page can't deadlock on a full pipe.
    let mut stdin = child.stdin.take().unwrap();
    let input = pdf.to_vec();
    let writer = std::thread::spawn(move || stdin.write_all(&input));
    let out = child.wait_with_output().unwrap();
    let _ = writer.join();
    // Binary PGM: "P5\n<w> <h>\n255\n<pixels>".
    let mut fields = out.stdout.splitn(4, |&b| b.is_ascii_whitespace());
    let (magic, w, h) = (fields.next(), fields.next(), fields.next());
    if magic != Some(b"P5".as_slice()) {
        return Err(format!("pdftoppm couldn't render page {page}"));
    }
    let num =
        |f: Option<&[u8]>| -> usize { std::str::from_utf8(f.unwrap()).unwrap().parse().unwrap() };
    let (width, height) = (num(w), num(h));
    let rest = fields.next().unwrap();
    let start = rest.iter().position(|&b| b == b'\n').unwrap() + 1;
    Ok(Gray {
        width,
        height,
        pixels: rest[start..].to_vec(),
    })
}

/// Whether `pdftoppm` is installed; if not, says so, so callers can skip render checks.
#[allow(dead_code)]
pub fn poppler_available() -> bool {
    let ok = Command::new("pdftoppm").arg("-v").output().is_ok();
    if !ok {
        eprintln!("warning: pdftoppm not found; skipping render checks");
    }
    ok
}
