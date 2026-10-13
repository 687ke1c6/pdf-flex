//! Stamps every file in `tests/corpus/` and checks the result.
//!
//! For each file that should sign, every page gets an opaque black box with a
//! line of black text on it, and:
//! - the output reloads with the same page count and catalog entries (forms,
//!   tags, metadata, outlines are not dropped);
//! - `qpdf --check` passes with no warnings;
//! - rendered with poppler, the box is black exactly where it was placed and
//!   every pixel outside it matches the original;
//! - poppler's `pdftotext` finds each page's text on that page.
//!
//! qpdf, `pdftoppm` and `pdftotext` are external tools; if one is missing, its
//! checks are skipped with a message rather than failing. Outputs are written to
//! `target/tmp/corpus/` for checking by eye.

use std::{
    fs,
    io::{Cursor, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use lopdf::Document;
use pdf_stamp::{Error, Font, Item, Line, PageGeometry, Placement, inspect, load, stamp};

enum Expect {
    /// Stamping succeeds and the output passes every check.
    Signs,
    /// Like `Signs`, but poppler can't render the original (it fails, or draws
    /// a blank page), while the output renders fully: the stamp, and the
    /// page's own content around it.
    SignsAndRenders,
    /// Stamping is refused with this error.
    Fails(fn(&Error) -> bool),
}
use Expect::*;

const CASES: &[(&str, Expect)] = &[
    // Real files: public-domain US government documents (see corpus/README.md).
    ("real/irs-w9-xfa-form.pdf", Signs),
    ("real/word-pdfmaker-tagged.pdf", Signs),
    ("real/macos-preview-incremental.pdf", Signs),
    ("real/acrobat-scan-jpx.pdf", Signs),
    // Generated: see examples/corpus.rs for how each is made.
    ("generated/base.pdf", Signs),
    ("generated/junk-before-header.pdf", Signs),
    ("generated/wrong-xref-offsets.pdf", Signs),
    // Neither poppler nor pdf.js can open this one; the repaired output opens in both.
    ("generated/no-xref-or-trailer.pdf", SignsAndRenders),
    ("generated/no-eof-marker.pdf", Signs),
    (
        "generated/truncated-half.pdf",
        Fails(|e| matches!(e, Error::Damaged(_))),
    ),
    ("generated/unclosed-q.pdf", Signs),
    // Poppler draws nothing after a Q without a q; pdf.js ignores the Q.
    ("generated/extra-Q.pdf", SignsAndRenders),
    ("generated/unbalanced-cm-no-q.pdf", Signs),
    ("generated/missing-mediabox.pdf", Signs),
    ("generated/rotate-real-number.pdf", Signs),
    ("generated/user-unit-2.pdf", Signs),
    ("generated/no-contents.pdf", Signs),
    ("generated/dangling-contents.pdf", Signs),
    ("generated/contents-indirect-array.pdf", Signs),
    ("generated/shared-resources.pdf", Signs),
    ("generated/deep-page-tree.pdf", Signs),
    ("generated/pdf-2.0.pdf", Signs),
    ("generated/objstm-xrefstream-linearized.pdf", Signs),
    ("generated/empty.pdf", Fails(|e| matches!(e, Error::NotPdf))),
    (
        "generated/html-error-page.pdf",
        Fails(|e| matches!(e, Error::NotPdf)),
    ),
    (
        "generated/signature-png.pdf",
        Fails(|e| matches!(e, Error::NotPdf)),
    ),
    (
        "generated/decompression-bomb.pdf",
        Fails(|e| matches!(e, Error::TooLarge)),
    ),
    (
        "generated/encrypted-owner-password-only.pdf",
        Fails(|e| matches!(e, Error::Encrypted)),
    ),
    (
        "generated/encrypted-user-password.pdf",
        Fails(|e| matches!(e, Error::Encrypted)),
    ),
    (
        "generated/encrypted-rc4-40bit.pdf",
        Fails(|e| matches!(e, Error::Encrypted)),
    ),
];

fn corpus() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/corpus")
}

/// An opaque black 40 × 20 PNG, so the stamp is unmistakable in a render.
fn black_box() -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    image::RgbaImage::from_pixel(40, 20, image::Rgba([0, 0, 0, 255]))
        .write_to(&mut out, image::ImageFormat::Png)
        .unwrap();
    out.into_inner()
}

/// A 100 × 50 pt box centred on each page, in display space.
fn placements(doc: &Document) -> Vec<Placement> {
    doc.get_pages()
        .iter()
        .map(|(&page, &id)| {
            let (w, h) = PageGeometry::read(doc, id).display_size();
            Placement {
                item: Item::Image { image: 0 },
                page,
                x: w / 2.0 - 50.0,
                y: h / 2.0 - 25.0,
                width: 100.0,
                height: 50.0,
            }
        })
        .collect()
}

/// The text written on each page, so it can be found again.
fn marker(page: u32) -> String {
    format!("pdfflex-{page}")
}

/// A line of black text inside each box (black on black, so renders don't change).
fn text_on(boxes: &[Placement]) -> Vec<Placement> {
    boxes
        .iter()
        .map(|b| Placement {
            item: Item::Text {
                font: Font::Helvetica,
                size: 8.0,
                color: [0, 0, 0],
                lines: vec![Line {
                    text: marker(b.page),
                    x: 4.0,
                    y: 21.0,
                }],
            },
            ..b.clone()
        })
        .collect()
}

#[test]
fn every_corpus_file_has_an_expectation() {
    let mut missing = Vec::new();
    for dir in ["real", "generated"] {
        for entry in fs::read_dir(corpus().join(dir)).unwrap() {
            let name = format!("{dir}/{}", entry.unwrap().file_name().to_string_lossy());
            if name.ends_with(".pdf") && !CASES.iter().any(|(n, _)| *n == name) {
                missing.push(name);
            }
        }
    }
    assert!(missing.is_empty(), "add these to CASES: {missing:?}");
}

#[test]
fn every_corpus_file_meets_its_expectation() {
    let sig = black_box();
    let out_dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join("corpus");
    fs::create_dir_all(&out_dir).unwrap();
    let qpdf = tool_available("qpdf", "--version");
    let poppler = tool_available("pdftoppm", "-v");
    let pdftotext = tool_available("pdftotext", "-v");

    let mut failures = Vec::new();
    for (name, expect) in CASES {
        let pdf = fs::read(corpus().join(name)).unwrap();
        let tools = Tools {
            qpdf,
            poppler,
            pdftotext,
        };
        let result = check(name, &pdf, &sig, expect, &out_dir, &tools);
        match result {
            Ok(()) => println!("ok    {name}"),
            Err(why) => {
                println!("FAIL  {name}: {why}");
                failures.push(format!("{name}: {why}"));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} corpus failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// Which external tools are installed.
struct Tools {
    qpdf: bool,
    poppler: bool,
    pdftotext: bool,
}

fn check(
    name: &str,
    pdf: &[u8],
    sig: &[u8],
    expect: &Expect,
    out_dir: &Path,
    tools: &Tools,
) -> Result<(), String> {
    match expect {
        Fails(is_expected) => {
            let err = inspect(pdf).err().ok_or("inspect accepted it")?;
            if !is_expected(&err) {
                return Err(format!("inspect gave the wrong error: {err:?}"));
            }
            let err = stamp(pdf, &[sig], &[]).err().ok_or("stamp accepted it")?;
            if !is_expected(&err) {
                return Err(format!("stamp gave the wrong error: {err:?}"));
            }
            Ok(())
        }
        Signs | SignsAndRenders => {
            let info = inspect(pdf).map_err(|e| format!("inspect: {e}"))?;
            let before = load(pdf).map_err(|e| format!("load: {e}"))?;
            let placements = placements(&before);
            if placements.len() != info.pages.len() {
                return Err(format!(
                    "inspect found {} pages, load {}",
                    info.pages.len(),
                    placements.len()
                ));
            }
            let all = [placements.clone(), text_on(&placements)].concat();
            let out = stamp(pdf, &[sig], &all).map_err(|e| format!("stamp: {e}"))?;
            let out_path = out_dir.join(name.replace('/', "--"));
            fs::write(&out_path, &out).unwrap();

            // The output must load strictly as a plain PDF, with nothing to repair.
            let after = Document::load_mem(&out).map_err(|e| format!("reloading output: {e}"))?;
            if after.get_pages().len() != info.pages.len() {
                return Err(format!(
                    "output has {} pages, not {}",
                    after.get_pages().len(),
                    info.pages.len()
                ));
            }
            // Geometry must survive the round trip, or a second signing would misplace signatures.
            let after_info = inspect(&out).map_err(|e| format!("inspecting output: {e}"))?;
            if after_info != info {
                return Err("page geometry changed".into());
            }
            let catalog = |d: &Document| -> Vec<Vec<u8>> {
                d.catalog()
                    .map(|c| c.iter().map(|(k, _)| k.clone()).collect())
                    .unwrap_or_default()
            };
            let (old, new) = (catalog(&before), catalog(&after));
            let lost: Vec<_> = old
                .iter()
                // Usage rights are removed on purpose (see `stamp`).
                .filter(|k| !new.contains(k) && k.as_slice() != b"Perms")
                .map(|k| String::from_utf8_lossy(k))
                .collect();
            if !lost.is_empty() {
                return Err(format!("catalog lost {lost:?}"));
            }

            if tools.qpdf {
                qpdf_check(&out_path)?;
            }
            if tools.poppler {
                for p in &placements {
                    compare_renders(pdf, &out, p, &before, matches!(expect, SignsAndRenders))?;
                }
            }
            if tools.pdftotext {
                find_text(&out, &placements)?;
            }
            Ok(())
        }
    }
}

fn tool_available(tool: &str, arg: &str) -> bool {
    let ok = Command::new(tool).arg(arg).output().is_ok();
    if !ok {
        eprintln!("warning: {tool} not found; skipping its corpus checks");
    }
    ok
}

fn qpdf_check(path: &Path) -> Result<(), String> {
    let out = Command::new("qpdf")
        .arg("--check")
        .arg(path)
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout) + String::from_utf8_lossy(&out.stderr);
    if !out.status.success() || text.contains("WARNING") {
        return Err(format!("qpdf --check: {}", text.trim()));
    }
    Ok(())
}

/// Each page's marker text must be extracted from that page.
fn find_text(pdf: &[u8], placements: &[Placement]) -> Result<(), String> {
    let mut child = Command::new("pdftotext")
        .args(["-", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let input = pdf.to_vec();
    let writer = std::thread::spawn(move || stdin.write_all(&input));
    let out = child.wait_with_output().unwrap();
    let _ = writer.join();
    // pdftotext ends each page with a form feed.
    let text = String::from_utf8_lossy(&out.stdout);
    let pages: Vec<&str> = text.split('\x0c').collect();
    for p in placements {
        let page_text = pages.get(p.page as usize - 1).copied().unwrap_or_default();
        if !page_text.contains(&marker(p.page)) {
            return Err(format!("pdftotext didn't find the text on page {}", p.page));
        }
    }
    Ok(())
}

/// Resolution for render comparisons: 1 pixel = 1 pt.
const DPI: u32 = 72;

struct Gray {
    width: usize,
    height: usize,
    pixels: Vec<u8>,
}

fn render(pdf: &[u8], page: u32) -> Result<Gray, String> {
    let mut child = Command::new("pdftoppm")
        .args([
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

/// The stamp must be black where it was placed, and nothing else may change
/// (or, if `repaired`, something must be drawn outside it).
fn compare_renders(
    before: &[u8],
    after: &[u8],
    p: &Placement,
    doc: &Document,
    repaired: bool,
) -> Result<(), String> {
    let b = render(after, p.page)?;
    let a = match render(before, p.page) {
        Ok(a) => a,
        // Unrenderable originals compare as blank pages; only `repaired` allows that.
        Err(_) if repaired => Gray {
            width: b.width,
            height: b.height,
            pixels: vec![255; b.pixels.len()],
        },
        Err(e) => return Err(e),
    };
    if (a.width, a.height) != (b.width, b.height) {
        return Err(format!("page {} changed size when rendered", p.page));
    }
    // The page as rendered should match display space at 1 px per pt. Poppler
    // ignores /UserUnit (pdf.js and Acrobat honour it), so scale for that.
    let geometry = PageGeometry::read(doc, doc.get_pages()[&p.page]);
    let scale = DPI as f32 / 72.0 / geometry.user_unit;
    let (w, h) = geometry.display_size();
    if (a.width as f32 - w * scale).abs() > 1.5 || (a.height as f32 - h * scale).abs() > 1.5 {
        return Err(format!(
            "page {} renders at {}x{} px but its display size is {w}x{h} pt",
            p.page, a.width, a.height
        ));
    }
    // Box in pixels, y measured from the top.
    let (x0, x1) = (p.x * scale, (p.x + p.width) * scale);
    let (y0, y1) = ((h - p.y - p.height) * scale, (h - p.y) * scale);
    let (mut inside, mut inside_dark, mut outside_changed, mut outside_ink) = (0, 0, 0, 0);
    for y in 0..a.height {
        for x in 0..a.width {
            let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
            let i = y * a.width + x;
            let margin = 2.0;
            if fx > x0 + margin && fx < x1 - margin && fy > y0 + margin && fy < y1 - margin {
                inside += 1;
                inside_dark += usize::from(b.pixels[i] < 40);
            } else if !(fx > x0 - margin
                && fx < x1 + margin
                && fy > y0 - margin
                && fy < y1 + margin)
            {
                outside_changed += usize::from(a.pixels[i].abs_diff(b.pixels[i]) > 8);
                outside_ink += usize::from(b.pixels[i] < 128);
            }
        }
    }
    if inside == 0 || inside_dark < inside * 98 / 100 {
        return Err(format!(
            "page {}: stamp box is only {inside_dark}/{inside} px dark",
            p.page
        ));
    }
    if repaired {
        if outside_ink == 0 {
            return Err(format!("page {}: nothing drawn outside the stamp", p.page));
        }
    } else if outside_changed > 0 {
        return Err(format!(
            "page {}: {outside_changed} px changed outside the stamp",
            p.page
        ));
    }
    Ok(())
}
