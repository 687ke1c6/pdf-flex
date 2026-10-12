use lopdf::{Document, Object};
use pdf_stamp::{Error, PageGeometry, Placement, stamp, testpdf};

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
            Some(fixture.geometry()),
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
            .get(b"PdfSign0")
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
    let second = Placement { y: 300.0, ..target };
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
        image: 1,
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
    assert!(xobjects.has(b"PdfSign0") && xobjects.has(b"PdfSign1"));
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
        image: 1,
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
        image: 1,
        ..fixture.target(aspect)
    };
    let err = stamp(&testpdf::build(fixture, &target), &[&sig], &[target]).unwrap_err();
    assert!(matches!(err, Error::NoSuchImage { index: 1, count: 1 }));
}
