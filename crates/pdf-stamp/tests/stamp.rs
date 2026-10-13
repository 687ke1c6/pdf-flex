use lopdf::{Document, Object};
use pdf_stamp::{Error, Item, PageGeometry, Placement, stamp, testpdf};

fn sample() -> (Vec<u8>, f32) {
    let sig = testpdf::sample_signature_png();
    let img = image::load_from_memory(&sig).unwrap();
    (sig, img.width() as f32 / img.height() as f32)
}

#[test]
fn stamps_every_fixture() {
    let (sig, aspect) = sample();
    for fixture in testpdf::fixtures() {
        let target = fixture.target(aspect);
        let out = stamp(&testpdf::build(&fixture, &target), &[&sig], &[target]).unwrap();

        let doc = Document::load_mem(&out).unwrap();
        let page_id = doc.get_pages()[&1];
        let page = doc.get_dictionary(page_id).unwrap();

        // Geometry (including inherited /Rotate) survives the round trip.
        assert_eq!(
            PageGeometry::read(&doc, page_id),
            fixture.geometry(),
            "{}",
            fixture.name
        );

        // Original content is wrapped: [q] + original + [Q + stamp].
        assert_eq!(
            page.get(b"Contents").unwrap().as_array().unwrap().len(),
            3,
            "{}",
            fixture.name
        );

        // The image is registered alongside the inherited font, and has an alpha mask.
        let resources = page.get(b"Resources").unwrap().as_dict().unwrap();
        assert!(
            resources
                .get(b"Font")
                .unwrap()
                .as_dict()
                .unwrap()
                .has(b"F1")
        );
        let image_id = resources
            .get(b"XObject")
            .unwrap()
            .as_dict()
            .unwrap()
            .get(b"PdfFlex0")
            .unwrap();
        let image = doc
            .get_object(image_id.as_reference().unwrap())
            .unwrap()
            .as_stream()
            .unwrap();
        assert!(
            matches!(image.dict.get(b"SMask"), Ok(Object::Reference(_))),
            "{}",
            fixture.name
        );
    }
}

#[test]
fn placements_on_one_page_share_one_image() {
    let (sig, aspect) = sample();
    let fixture = &testpdf::fixtures()[0];
    let target = fixture.target(aspect);
    let second = Placement {
        y: 300.0,
        ..target.clone()
    };
    let out = stamp(
        &testpdf::build(fixture, &target),
        &[&sig],
        &[target, second],
    )
    .unwrap();

    let doc = Document::load_mem(&out).unwrap();
    let images = doc
        .objects
        .values()
        .filter(|o| {
            o.as_stream().is_ok_and(|s| {
                s.dict
                    .get(b"Subtype")
                    .and_then(Object::as_name)
                    .is_ok_and(|n| n == b"Image")
            })
        })
        .count();
    assert_eq!(images, 2, "one RGB image plus its mask");
}

#[test]
fn rejects_missing_page() {
    let (sig, aspect) = sample();
    let fixture = &testpdf::fixtures()[0];
    let target = Placement {
        page: 2,
        ..fixture.target(aspect)
    };
    let err = stamp(&testpdf::build(fixture, &target), &[&sig], &[target]).unwrap_err();
    assert!(matches!(err, Error::NoSuchPage { page: 2, count: 1 }));
}

#[test]
fn no_placements_returns_input_unchanged() {
    let fixture = &testpdf::fixtures()[0];
    let pdf = testpdf::build(fixture, &fixture.target(3.0));
    assert_eq!(stamp(&pdf, &[b"not an image"], &[]).unwrap(), pdf);
}

/// Counts image XObjects (each RGB image plus its mask counts as two).
fn image_count(doc: &Document) -> usize {
    doc.objects
        .values()
        .filter(|o| {
            o.as_stream().is_ok_and(|s| {
                s.dict
                    .get(b"Subtype")
                    .and_then(Object::as_name)
                    .is_ok_and(|n| n == b"Image")
            })
        })
        .count()
}

#[test]
fn different_images_on_one_page_get_separate_resources() {
    let (sig, aspect) = sample();
    // A second, opaque image: a solid red 30 x 10 PNG.
    let mut red = std::io::Cursor::new(Vec::new());
    image::RgbaImage::from_pixel(30, 10, image::Rgba([200, 0, 0, 255]))
        .write_to(&mut red, image::ImageFormat::Png)
        .unwrap();
    let red = red.into_inner();

    let fixture = &testpdf::fixtures()[0];
    let target = fixture.target(aspect);
    let other = Placement {
        item: Item::Image { image: 1 },
        y: 300.0,
        ..target
    };
    let out = stamp(
        &testpdf::build(fixture, &target),
        &[&sig, &red],
        &[target, other],
    )
    .unwrap();

    let doc = Document::load_mem(&out).unwrap();
    let page = doc.get_dictionary(doc.get_pages()[&1]).unwrap();
    let xobjects = page
        .get(b"Resources")
        .unwrap()
        .as_dict()
        .unwrap()
        .get(b"XObject")
        .unwrap()
        .as_dict()
        .unwrap();
    assert!(xobjects.has(b"PdfFlex0") && xobjects.has(b"PdfFlex1"));
    assert_eq!(
        image_count(&doc),
        3,
        "signature + its mask, and the opaque red image (no mask)"
    );
}

#[test]
fn unused_images_are_not_embedded() {
    let (sig, aspect) = sample();
    let fixture = &testpdf::fixtures()[0];
    let target = Placement {
        item: Item::Image { image: 1 },
        ..fixture.target(aspect)
    };
    let out = stamp(
        &testpdf::build(fixture, &target),
        &[b"never decoded", &sig],
        &[target],
    )
    .unwrap();
    assert_eq!(image_count(&Document::load_mem(&out).unwrap()), 2);
}

#[test]
fn rejects_missing_image() {
    let (sig, aspect) = sample();
    let fixture = &testpdf::fixtures()[0];
    let target = Placement {
        item: Item::Image { image: 1 },
        ..fixture.target(aspect)
    };
    let err = stamp(&testpdf::build(fixture, &target), &[&sig], &[target]).unwrap_err();
    assert!(matches!(err, Error::NoSuchImage { index: 1, count: 1 }));
}

fn png(width: u32, height: u32) -> Vec<u8> {
    let mut out = std::io::Cursor::new(Vec::new());
    image::GrayImage::new(width, height)
        .write_to(&mut out, image::ImageFormat::Png)
        .unwrap();
    out.into_inner()
}

#[test]
fn rejects_invalid_placements() {
    let (sig, aspect) = sample();
    let fixture = &testpdf::fixtures()[0];
    let target = fixture.target(aspect);
    let pdf = testpdf::build(fixture, &target);
    for bad in [
        Placement {
            x: f32::NAN,
            ..target.clone()
        },
        Placement {
            width: 0.0,
            ..target.clone()
        },
        Placement {
            height: -5.0,
            ..target.clone()
        },
        Placement {
            y: f32::INFINITY,
            ..target.clone()
        },
    ] {
        let err = stamp(&pdf, &[&sig], &[target.clone(), bad.clone()]).unwrap_err();
        assert!(
            matches!(err, Error::BadPlacement { index: 1 }),
            "{bad:?}: {err:?}"
        );
    }
}

#[test]
fn rejects_unreadable_and_oversized_images() {
    let fixture = &testpdf::fixtures()[0];
    let target = fixture.target(3.0);
    let pdf = testpdf::build(fixture, &target);

    let err = stamp(&pdf, &[b"not an image"], std::slice::from_ref(&target)).unwrap_err();
    assert!(matches!(err, Error::BadImage(_)), "{err:?}");

    // The size is refused from the header, before the pixels are decoded.
    let err = stamp(&pdf, &[&png(10_001, 1)], std::slice::from_ref(&target)).unwrap_err();
    assert!(
        matches!(
            err,
            Error::ImageTooLarge {
                width: 10_001,
                height: 1
            }
        ),
        "{err:?}"
    );
    assert!(stamp(&pdf, &[&png(10_000, 1)], &[target]).is_ok());
}

#[test]
fn shared_resources_are_copied_not_edited() {
    let pdf = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/corpus/generated/shared-resources.pdf"
    ))
    .unwrap();
    let (sig, _) = sample();
    let target = Placement {
        item: Item::Image { image: 0 },
        page: 1,
        x: 40.0,
        y: 40.0,
        width: 150.0,
        height: 50.0,
    };
    let out = stamp(&pdf, &[&sig], &[target]).unwrap();

    let doc = Document::load_mem(&out).unwrap();
    let pages = doc.get_pages();
    let resources = |page| {
        doc.get_dictionary(pages[&page])
            .unwrap()
            .get(b"Resources")
            .unwrap()
            .clone()
    };
    // Page 2 still points at the shared dictionary, which gained nothing.
    let shared = resources(2).as_reference().unwrap();
    let xobjects = doc
        .get_dictionary(shared)
        .unwrap()
        .get(b"XObject")
        .unwrap()
        .as_reference()
        .unwrap();
    let xobjects = doc.get_dictionary(xobjects).unwrap();
    assert!(xobjects.has(b"Fm0") && !xobjects.has(b"PdfFlex0"));
    // Page 1 has its own copy with both the original form and the signature.
    let own = resources(1);
    let own = own
        .as_dict()
        .unwrap()
        .get(b"XObject")
        .unwrap()
        .as_dict()
        .unwrap();
    assert!(own.has(b"Fm0") && own.has(b"PdfFlex0"));
}

#[test]
fn errors_read_as_plain_sentences() {
    let err = stamp(b"<html>", &[], &[]).unwrap_err();
    assert_eq!(err.to_string(), "This file isn't a PDF.");
    assert!(
        Error::Encrypted
            .to_string()
            .starts_with("This PDF is password-protected")
    );
}

#[test]
fn removes_reader_usage_rights() {
    let pdf = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/corpus/real/irs-w9-xfa-form.pdf"
    ))
    .unwrap();
    let has_usage_rights = |pdf: &[u8]| {
        let doc = Document::load_mem(pdf).unwrap();
        let perms = doc.catalog().unwrap().get(b"Perms").ok().cloned();
        perms.is_some_and(|p| {
            doc.dereference(&p)
                .unwrap()
                .1
                .as_dict()
                .unwrap()
                .has(b"UR3")
        })
    };
    assert!(has_usage_rights(&pdf));
    // Usage rights are not a signature the user needs warning about.
    assert!(!pdf_stamp::inspect(&pdf).unwrap().digitally_signed);

    let (sig, _) = sample();
    let target = Placement {
        item: Item::Image { image: 0 },
        page: 1,
        x: 40.0,
        y: 40.0,
        width: 150.0,
        height: 50.0,
    };
    let out = stamp(&pdf, &[&sig], &[target]).unwrap();
    assert!(!has_usage_rights(&out));
    // The form itself is kept.
    let doc = Document::load_mem(&out).unwrap();
    assert!(doc.catalog().unwrap().has(b"AcroForm"));
}

#[test]
fn detects_digital_signatures() {
    let fixture = &testpdf::fixtures()[0];
    let pdf = testpdf::build(fixture, &fixture.target(3.0));
    assert!(!pdf_stamp::inspect(&pdf).unwrap().digitally_signed);

    let with_catalog = |key: &str, value: Object| {
        let mut doc = Document::load_mem(&pdf).unwrap();
        doc.catalog_mut().unwrap().set(key, value);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    };
    let sig_flags = |flags: i64| {
        with_catalog(
            "AcroForm",
            lopdf::dictionary! { "Fields" => Vec::<Object>::new(), "SigFlags" => flags }.into(),
        )
    };
    // Bit 1 is SignaturesExist; bit 2 alone (AppendOnly) comes with usage rights too.
    assert!(pdf_stamp::inspect(&sig_flags(3)).unwrap().digitally_signed);
    assert!(!pdf_stamp::inspect(&sig_flags(2)).unwrap().digitally_signed);
    let certified = with_catalog(
        "Perms",
        lopdf::dictionary! { "DocMDP" => lopdf::dictionary! {} }.into(),
    );
    assert!(pdf_stamp::inspect(&certified).unwrap().digitally_signed);
}
