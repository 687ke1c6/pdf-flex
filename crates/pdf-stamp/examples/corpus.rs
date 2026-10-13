//! Writes the generated half of the test corpus to `tests/corpus/generated/`.
//!
//! Run with `just corpus`. The outputs are committed, so `cargo test` needs
//! neither this example nor qpdf. Each file reproduces one way real-world PDFs
//! are unusual or broken; `tests/corpus.rs` says what stamping each one should do.

use std::{fs, path::Path, process::Command};

use lopdf::xref::XrefType;
use lopdf::{Dictionary, Document, Object, ObjectId, SaveOptions, Stream, dictionary};
use pdf_stamp::testpdf;

const OUT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/corpus/generated");

fn main() {
    let out = Path::new(OUT);
    fs::create_dir_all(out).unwrap();
    let write = |name: &str, bytes: &[u8]| {
        fs::write(out.join(name), bytes).unwrap();
        println!("wrote {name} ({} bytes)", bytes.len());
    };

    let plain = &testpdf::fixtures()[0];
    // Re-saved with a classic xref table, so the byte-level damage below means something.
    let base = save(&mut Document::load_mem(&testpdf::build(plain, &plain.target(3.0))).unwrap());
    write("base.pdf", &base);

    // --- Byte-level damage, as produced by broken uploads and sloppy writers ---
    write(
        "junk-before-header.pdf",
        &[b"Content-Type: application/pdf\r\n\r\n".as_slice(), &base].concat(),
    );
    // Every xref offset is now off by the inserted length.
    let first_line = base.iter().position(|&b| b == b'\n').unwrap() + 1;
    write(
        "wrong-xref-offsets.pdf",
        &[
            &base[..first_line],
            b"% this comment shifts every object by 48 bytes\n".as_slice(),
            &base[first_line..],
        ]
        .concat(),
    );
    let xref = rfind(&base, b"\nxref").unwrap() + 1;
    write("no-xref-or-trailer.pdf", &base[..xref]);
    let eof = rfind(&base, b"%%EOF").unwrap();
    write("no-eof-marker.pdf", &base[..eof]);
    write("truncated-half.pdf", &base[..base.len() / 2]);

    // --- Content streams that leave the graphics state modified ---
    write(
        "unclosed-q.pdf",
        &single_page(
            dictionary! {},
            // Two saves, never restored, with a transform that would shrink and
            // shift anything drawn after it.
            &format!("q q 0.5 0 0 0.5 100 100 cm {}", LABEL),
        ),
    );
    write(
        "extra-Q.pdf",
        &single_page(dictionary! {}, &format!("Q Q {LABEL}")),
    );
    write(
        "unbalanced-cm-no-q.pdf",
        &single_page(dictionary! {}, &format!("1 0 0 1 200 300 cm {LABEL}")),
    );

    // --- Unusual page dictionaries ---
    write(
        "missing-mediabox.pdf",
        &build(|doc, pages| {
            let c = content(doc, LABEL);
            vec![page(doc, pages, dictionary! { "Contents" => c })]
        }),
    );
    write(
        "rotate-real-number.pdf",
        &single_page(dictionary! { "Rotate" => Object::Real(90.0) }, LABEL),
    );
    write(
        "user-unit-2.pdf",
        &build(|doc, pages| {
            let c = content(doc, LABEL);
            vec![page(
                doc,
                pages,
                dictionary! {
                    "MediaBox" => rect([0.0, 0.0, 306.0, 396.0]),
                    "UserUnit" => 2,
                    "Contents" => c,
                },
            )]
        }),
    );
    write("no-contents.pdf", &single_page_raw(dictionary! {}));
    write(
        "dangling-contents.pdf",
        &single_page_raw(dictionary! { "Contents" => (999, 0) }),
    );
    write(
        "contents-indirect-array.pdf",
        &build(|doc, pages| {
            let a = content(doc, "0.6 G 20 20 572 752 re S");
            let b = content(doc, LABEL);
            let array = doc.add_object(vec![Object::Reference(a), Object::Reference(b)]);
            vec![page(
                doc,
                pages,
                dictionary! { "MediaBox" => rect(pdf_stamp::LETTER), "Contents" => array },
            )]
        }),
    );
    write("shared-resources.pdf", &shared_resources());
    write("deep-page-tree.pdf", &deep_page_tree());
    write("pdf-2.0.pdf", &{
        let mut doc = Document::load_mem(&base).unwrap();
        doc.version = "2.0".into();
        save(&mut doc)
    });

    // --- Not PDFs at all ---
    write("empty.pdf", b"");
    write(
        "html-error-page.pdf",
        b"<!doctype html><title>404 Not Found</title>",
    );
    write("signature-png.pdf", &testpdf::sample_signature_png());

    // --- Decompression bomb: an object stream that inflates to ~80 MB ---
    write("decompression-bomb.pdf", &bomb());

    // --- Variants only qpdf can make (skipped with a warning if it's missing) ---
    let qpdf = |name: &str, args: &[&str]| {
        let dst = out.join(name);
        let status = Command::new("qpdf")
            .args(args)
            .arg(out.join("base.pdf"))
            .arg(&dst)
            .status();
        match status {
            // qpdf exits with 3 for warnings, which is fine for these inputs.
            Ok(s) if s.success() || s.code() == Some(3) => println!("wrote {name} (qpdf)"),
            Ok(s) => panic!("qpdf failed for {name}: {s}"),
            Err(e) => eprintln!("skipped {name}: qpdf not available ({e})"),
        }
    };
    qpdf(
        "objstm-xrefstream-linearized.pdf",
        &["--object-streams=generate", "--linearize"],
    );
    qpdf(
        "encrypted-owner-password-only.pdf",
        &["--encrypt", "", "owner", "256", "--print=none", "--"],
    );
    qpdf(
        "encrypted-user-password.pdf",
        &["--encrypt", "user", "owner", "256", "--"],
    );
    qpdf(
        "encrypted-rc4-40bit.pdf",
        &["--allow-weak-crypto", "--encrypt", "", "owner", "40", "--"],
    );
}

/// Visible text and a frame, so a render shows whether anything moved.
const LABEL: &str = "0.6 G 2 w 20 20 572 752 re S 0 g BT /F1 24 Tf 60 700 Td (corpus page) Tj ET";

fn rfind(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).rposition(|w| w == needle)
}

fn rect(r: [f32; 4]) -> Vec<Object> {
    r.iter().map(|&v| v.into()).collect()
}

fn content(doc: &mut Document, ops: &str) -> ObjectId {
    doc.add_object(Stream::new(dictionary! {}, ops.as_bytes().to_vec()))
}

fn page(doc: &mut Document, parent: ObjectId, mut dict: Dictionary) -> ObjectId {
    dict.set("Type", "Page");
    dict.set("Parent", parent);
    doc.add_object(dict)
}

/// Builds a document whose root Pages node holds the font resource; `pages`
/// adds the page objects and returns their ids in order.
fn build(pages: impl FnOnce(&mut Document, ObjectId) -> Vec<ObjectId>) -> Vec<u8> {
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let font = doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
    });
    let kids = pages(&mut doc, pages_id);
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Count" => kids.len() as i64,
            "Kids" => kids.into_iter().map(Object::Reference).collect::<Vec<_>>(),
            "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
        }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog);
    save(&mut doc)
}

fn single_page(extra: Dictionary, ops: &str) -> Vec<u8> {
    build(|doc, pages| {
        let c = content(doc, ops);
        let mut dict = dictionary! { "MediaBox" => rect(pdf_stamp::LETTER), "Contents" => c };
        dict.extend(&extra);
        vec![page(doc, pages, dict)]
    })
}

fn single_page_raw(extra: Dictionary) -> Vec<u8> {
    build(|doc, pages| {
        let mut dict = dictionary! { "MediaBox" => rect(pdf_stamp::LETTER) };
        dict.extend(&extra);
        vec![page(doc, pages, dict)]
    })
}

/// Saves with a classic cross-reference table (lopdf defaults to a stream for new documents).
fn save(doc: &mut Document) -> Vec<u8> {
    doc.reference_table.cross_reference_type = XrefType::CrossReferenceTable;
    // A loaded document keeps the xref stream it was read from, which the
    // writer skips, leaving a gap at the end of the table that qpdf warns about.
    doc.objects
        .retain(|_, o| o.type_name().ok() != Some(b"XRef".as_slice()));
    doc.trailer.remove(b"Type");
    doc.max_id = doc.objects.keys().next_back().map_or(0, |id| id.0);
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}

/// Two pages sharing one indirect Resources dictionary, whose XObject
/// dictionary is itself indirect. Stamping page 1 must leave page 2 alone.
fn shared_resources() -> Vec<u8> {
    build(|doc, pages| {
        let form = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject", "Subtype" => "Form",
                "BBox" => rect([0.0, 0.0, 100.0, 100.0]),
            },
            b"0 0 1 rg 0 0 100 100 re f".to_vec(),
        ));
        let xobjects = doc.add_object(dictionary! { "Fm0" => form });
        let font = doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
        });
        let resources = doc.add_object(dictionary! {
            "XObject" => xobjects,
            "Font" => dictionary! { "F1" => font },
        });
        (0..2)
            .map(|_| {
                let c = content(doc, &format!("q 1 0 0 1 400 600 cm /Fm0 Do Q {LABEL}"));
                page(
                    doc,
                    pages,
                    dictionary! {
                        "MediaBox" => rect(pdf_stamp::LETTER),
                        "Resources" => resources,
                        "Contents" => c,
                    },
                )
            })
            .collect()
    })
}

/// Four pages under three levels of Pages nodes, with MediaBox and Rotate
/// inherited from the root and overridden on one branch.
fn deep_page_tree() -> Vec<u8> {
    let mut doc = Document::with_version("1.7");
    let root = doc.new_object_id();
    let font = doc.add_object(dictionary! {
        "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
    });
    let leaf_parent = |doc: &mut Document, parent: ObjectId, extra: Dictionary| {
        let node = doc.new_object_id();
        let kids: Vec<Object> = (0..2)
            .map(|_| {
                let c = content(doc, LABEL);
                page(doc, node, dictionary! { "Contents" => c }).into()
            })
            .collect();
        let mut dict =
            dictionary! { "Type" => "Pages", "Parent" => parent, "Count" => 2, "Kids" => kids };
        dict.extend(&extra);
        doc.objects.insert(node, Object::Dictionary(dict));
        node
    };
    let middle = doc.new_object_id();
    let a = leaf_parent(&mut doc, middle, dictionary! {});
    let b = leaf_parent(&mut doc, middle, dictionary! { "Rotate" => 90 });
    doc.objects.insert(
        middle,
        Object::Dictionary(dictionary! {
            "Type" => "Pages", "Parent" => root, "Count" => 4,
            "Kids" => vec![a.into(), b.into()],
        }),
    );
    doc.objects.insert(
        root,
        Object::Dictionary(dictionary! {
            "Type" => "Pages", "Count" => 4, "Kids" => vec![middle.into()],
            "MediaBox" => rect([0.0, 0.0, 595.0, 842.0]),
            "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
        }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => root });
    doc.trailer.set("Root", catalog);
    save(&mut doc)
}

/// A one-page document whose catalog and page tree sit in an object stream
/// next to an 80 MB string, which compresses to well under 100 KB.
fn bomb() -> Vec<u8> {
    let mut doc = Document::with_version("1.7");
    let pages = doc.new_object_id();
    let c = content(&mut doc, LABEL);
    let p = page(
        &mut doc,
        pages,
        dictionary! { "MediaBox" => rect(pdf_stamp::LETTER), "Contents" => c },
    );
    doc.objects.insert(
        pages,
        Object::Dictionary(
            dictionary! { "Type" => "Pages", "Count" => 1, "Kids" => vec![p.into()] },
        ),
    );
    let filler = Object::string_literal(vec![b'0'; 80 << 20]);
    let filler = doc.add_object(filler);
    let catalog = doc.add_object(dictionary! {
        "Type" => "Catalog", "Pages" => pages, "Filler" => filler,
    });
    doc.trailer.set("Root", catalog);
    let mut out = Vec::new();
    doc.save_with_options(
        &mut out,
        SaveOptions::builder()
            .use_object_streams(true)
            .use_xref_streams(true)
            .compression_level(9)
            .build(),
    )
    .unwrap();
    out
}
