//! Text items: written as real text in the standard fonts, read back with
//! poppler's `pdftotext`. If pdftotext is missing, the checks that need it are
//! skipped with a message rather than failing.

use std::{
    io::Write,
    process::{Command, Stdio},
};

use lopdf::{Document, Object};
use pdf_stamp::{Error, Font, Item, Line, Placement, stamp, testpdf};

fn text(font: Font, size: f32, lines: &[(&str, f32, f32)]) -> Item {
    Item::Text {
        font,
        size,
        color: [0, 0, 0],
        lines: lines
            .iter()
            .map(|&(text, x, y)| Line {
                text: text.into(),
                x,
                y,
            })
            .collect(),
    }
}

fn pdftotext_available() -> bool {
    let ok = Command::new("pdftotext").arg("-v").output().is_ok();
    if !ok {
        eprintln!("warning: pdftotext not found; skipping its checks");
    }
    ok
}

/// Runs `pdftotext -cropbox <args> - -` on `pdf`. With `-cropbox`, positions
/// are in display space measured from the top-left, as the page is shown.
fn pdftotext(pdf: &[u8], args: &[&str]) -> String {
    let mut child = Command::new("pdftotext")
        .arg("-cropbox")
        .args(args)
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
    writer.join().unwrap().unwrap();
    String::from_utf8(out.stdout).unwrap()
}

/// A word's bounding box from `pdftotext -bbox`: (x_min, y_min, x_max, y_max), y down.
fn word_box(bbox_html: &str, word: &str) -> Option<[f32; 4]> {
    let line = bbox_html
        .lines()
        .find(|l| l.contains("<word") && l.contains(&format!(">{word}</word>")))?;
    let attr = |name: &str| -> f32 {
        let start = line.find(&format!("{name}=\"")).unwrap() + name.len() + 2;
        line[start..].split('"').next().unwrap().parse().unwrap()
    };
    Some([attr("xMin"), attr("yMin"), attr("xMax"), attr("yMax")])
}

#[test]
fn text_lands_upright_where_placed_on_every_fixture() {
    if !pdftotext_available() {
        return;
    }
    for fixture in testpdf::fixtures() {
        let target = fixture.target(3.0);
        let pdf = testpdf::build(&fixture, &target);
        let size = 12.0;
        let (line_x, line_y) = (4.0, 20.0);
        let placement = Placement {
            item: text(Font::Helvetica, size, &[("Hello pdf-flex", line_x, line_y)]),
            ..target.clone()
        };
        let out = stamp(&pdf, &[], &[placement]).unwrap();

        let bbox = pdftotext(&out, &["-bbox"]);
        let name = fixture.name;
        let [x0, y0, x1, y1] = word_box(&bbox, "Hello").unwrap_or_else(|| panic!("{name}: {bbox}"));
        let [next_x0, ..] = word_box(&bbox, "pdf-flex").unwrap();

        // Where it was put: the baseline starts at the line's position in the box.
        let (_, page_height) = fixture.geometry().display_size();
        let baseline_from_top = page_height - (target.y + line_y);
        assert!((x0 - (target.x + line_x)).abs() < 1.0, "{name}: x {x0}");
        assert!(
            y0 < baseline_from_top && baseline_from_top < y1,
            "{name}: baseline {baseline_from_top} outside {y0}..{y1}"
        );
        // Upright: a horizontal word about one font size tall, read left to right.
        assert!((y1 - y0 - size).abs() < 2.0, "{name}: height {}", y1 - y0);
        assert!(x1 - x0 > y1 - y0, "{name}: not horizontal");
        assert!(next_x0 > x1, "{name}: words not left to right");
    }
}

#[test]
fn text_reads_back_exactly() {
    if !pdftotext_available() {
        return;
    }
    let fixture = &testpdf::fixtures()[1]; // rotate-90
    let target = fixture.target(3.0);
    let pdf = testpdf::build(fixture, &target);
    // Two lines, using WinAnsi's extras, Latin-1, and the string delimiters.
    let lines = [
        ("Café “quoted” – 5 € ½", 0.0, 30.0),
        (r"(brackets) and \ backslash", 0.0, 15.0),
    ];
    let placement = Placement {
        item: text(Font::TimesBold, 10.0, &lines),
        ..target
    };
    let out = stamp(&pdf, &[], &[placement]).unwrap();

    let all = pdftotext(&out, &[]);
    for (line, ..) in lines {
        assert!(all.lines().any(|l| l == line), "{line:?} not in {all:?}");
    }
}

#[test]
fn fonts_are_added_once_and_registered_per_page() {
    let fixture = &testpdf::fixtures()[0];
    let target = fixture.target(3.0);
    let pdf = testpdf::build(fixture, &target);
    let at = |item, y| Placement {
        item,
        y,
        ..target.clone()
    };
    let placements = [
        at(text(Font::Helvetica, 10.0, &[("one", 0.0, 0.0)]), 100.0),
        at(text(Font::Helvetica, 14.0, &[("two", 0.0, 0.0)]), 200.0),
        at(text(Font::CourierBold, 10.0, &[("three", 0.0, 0.0)]), 300.0),
    ];
    let out = stamp(&pdf, &[], &placements).unwrap();
    let doc = Document::load_mem(&out).unwrap();

    let mut added: Vec<&str> = doc
        .objects
        .values()
        .filter_map(|o| o.as_dict().ok())
        .filter(|d| {
            d.get(b"Encoding")
                .and_then(Object::as_name)
                .is_ok_and(|e| e == b"WinAnsiEncoding")
        })
        .map(|d| std::str::from_utf8(d.get(b"BaseFont").unwrap().as_name().unwrap()).unwrap())
        .collect();
    added.sort();
    assert_eq!(added, ["Courier-Bold", "Helvetica"]);

    // The page keeps its inherited font and gains one name per new font.
    let page = doc.get_dictionary(doc.get_pages()[&1]).unwrap();
    let fonts = page
        .get(b"Resources")
        .and_then(Object::as_dict)
        .and_then(|r| r.get(b"Font"))
        .and_then(Object::as_dict)
        .unwrap();
    let mut names: Vec<_> = fonts
        .iter()
        .map(|(k, _)| String::from_utf8_lossy(k).into_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["F1", "PdfFlexF0", "PdfFlexF1"]);
}

#[test]
fn images_and_text_share_a_page() {
    let sig = testpdf::sample_signature_png();
    let fixture = &testpdf::fixtures()[0];
    let target = fixture.target(3.0);
    let pdf = testpdf::build(fixture, &target);
    let placements = [
        target.clone(),
        Placement {
            item: text(Font::Helvetica, 10.0, &[("Signed", 0.0, 0.0)]),
            y: 300.0,
            ..target.clone()
        },
    ];
    let out = stamp(&pdf, &[&sig], &placements).unwrap();
    let doc = Document::load_mem(&out).unwrap();
    let resources = doc
        .get_dictionary(doc.get_pages()[&1])
        .unwrap()
        .get(b"Resources")
        .unwrap()
        .as_dict()
        .unwrap();
    let has = |kind: &[u8], name: &[u8]| {
        resources
            .get(kind)
            .and_then(Object::as_dict)
            .is_ok_and(|d| d.has(name))
    };
    assert!(has(b"XObject", b"PdfFlex0") && has(b"Font", b"PdfFlexF0"));
    if pdftotext_available() {
        assert!(pdftotext(&out, &[]).contains("Signed"));
    }
}

#[test]
fn empty_text_is_allowed() {
    let fixture = &testpdf::fixtures()[0];
    let target = fixture.target(3.0);
    let pdf = testpdf::build(fixture, &target);
    for lines in [&[][..], &[("", 0.0, 0.0)]] {
        let placement = Placement {
            item: text(Font::Helvetica, 10.0, lines),
            ..target.clone()
        };
        assert!(stamp(&pdf, &[], &[placement]).is_ok());
    }
}

#[test]
fn refuses_characters_outside_winansi() {
    let fixture = &testpdf::fixtures()[0];
    let target = fixture.target(3.0);
    let pdf = testpdf::build(fixture, &target);
    let placement = Placement {
        item: text(
            Font::TimesItalic,
            10.0,
            &[("fine", 0.0, 10.0), ("Łódź", 0.0, 0.0)],
        ),
        ..target
    };
    let err = stamp(&pdf, &[], &[placement]).unwrap_err();
    assert!(
        matches!(
            err,
            Error::UnsupportedCharacter {
                character: 'Ł',
                font: "Times"
            }
        ),
        "{err:?}"
    );
    assert_eq!(
        err.to_string(),
        "The character 'Ł' can't be written in Times. Use image text for other characters."
    );
}

#[test]
fn rejects_invalid_sizes_and_positions() {
    let fixture = &testpdf::fixtures()[0];
    let target = fixture.target(3.0);
    let pdf = testpdf::build(fixture, &target);
    let at = |size, x| Placement {
        item: text(Font::Courier, size, &[("x", x, 0.0)]),
        ..target.clone()
    };
    for (size, x) in [
        (0.0, 0.0),
        (-3.0, 0.0),
        (f32::NAN, 0.0),
        (10.0, f32::INFINITY),
    ] {
        let err = stamp(&pdf, &[], &[at(10.0, 0.0), at(size, x)]).unwrap_err();
        assert!(
            matches!(err, Error::BadPlacement { index: 1 }),
            "{size} {x}: {err:?}"
        );
    }
}
