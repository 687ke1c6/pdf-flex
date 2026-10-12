//! Generated test PDFs and a sample signature, for tests and the `fixtures` example.
//!
//! Each fixture page is drawn in display space, so it reads upright in a viewer
//! whatever its `/Rotate`, and shows a dashed target box where a correctly
//! placed signature should land.

use std::io::Cursor;

use image::{ImageFormat, Rgba, RgbaImage};
use lopdf::{Document, Object, Stream, dictionary};

use crate::{PageGeometry, Placement};

pub struct Fixture {
    pub name: &'static str,
    pub media: [f32; 4],
    pub crop: Option<[f32; 4]>,
    pub rotate: i64,
    /// Put `/Rotate` on the parent Pages node, to exercise inheritance.
    pub rotate_on_parent: bool,
}

impl Fixture {
    pub fn geometry(&self) -> PageGeometry {
        PageGeometry::new(self.crop.unwrap_or(self.media), self.rotate)
    }

    /// The box, in display space, where the examples and tests place the signature.
    pub fn target(&self, aspect: f32) -> Placement {
        let (w, _) = self.geometry().display_size();
        let width = 150.0;
        Placement {
            image: 0,
            page: 1,
            x: w - width - 40.0,
            y: 40.0,
            width,
            height: width / aspect,
        }
    }
}

const LETTER: [f32; 4] = [0.0, 0.0, 612.0, 792.0];

pub fn fixtures() -> Vec<Fixture> {
    let fixture = |name, crop, rotate, rotate_on_parent| Fixture {
        name,
        media: LETTER,
        crop,
        rotate,
        rotate_on_parent,
    };
    let offset_crop = Some([60.0, 90.0, 560.0, 740.0]);
    vec![
        fixture("plain", None, 0, false),
        fixture("rotate-90", None, 90, false),
        fixture("rotate-180", None, 180, false),
        fixture("rotate-270-inherited", None, 270, true),
        fixture("cropbox-offset", offset_crop, 0, false),
        fixture("cropbox-offset-rotate-90", offset_crop, 90, false),
    ]
}

/// Builds a one-page PDF for `fixture`, with a target box drawn at `target`.
pub fn build(fixture: &Fixture, target: &Placement) -> Vec<u8> {
    let geometry = fixture.geometry();
    let (w, h) = geometry.display_size();

    let mut ops = String::new();
    // Red markers in the media-box corners: only visible if the CropBox is ignored.
    if fixture.crop.is_some() {
        let [llx, lly, urx, ury] = fixture.media;
        ops += "1 0 0 rg\n";
        for (x, y) in [(llx + 4.0, lly + 4.0), (urx - 150.0, ury - 14.0)] {
            ops += &format!("BT /F1 9 Tf {x} {y} Td (OUTSIDE CROP - SHOULD BE HIDDEN) Tj ET\n");
        }
    }
    // Everything else in display space, so it reads upright in a viewer.
    ops += &format!("q {} cm\n", geometry.display_to_user());
    ops += &format!("0.6 G 1 w 10 10 {} {} re S\n", w - 20.0, h - 20.0);
    ops += &format!(
        "0 g BT /F1 36 Tf {} {} Td (TOP) Tj ET\n",
        w / 2.0 - 38.0,
        h - 70.0
    );
    ops += &format!(
        "BT /F1 14 Tf 30 {} Td ({}) Tj ET\n",
        h - 110.0,
        fixture.name
    );
    ops += &format!(
        "BT /F1 10 Tf 30 {} Td (display {w} x {h} pt, /Rotate {}) Tj ET\n",
        h - 128.0,
        fixture.rotate
    );
    ops += "BT /F1 10 Tf 20 20 Td (bottom-left) Tj ET\n";
    let Placement {
        x,
        y,
        width,
        height,
        ..
    } = *target;
    ops += &format!("0 0 1 RG [4 3] 0 d {x} {y} {width} {height} re S [] 0 d\n");
    ops += &format!(
        "0 0 1 rg BT /F1 9 Tf {x} {} Td (signature should fill this box) Tj ET\n",
        y + height + 6.0
    );
    ops += "Q\n";

    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });
    let contents_id = doc.add_object(Stream::new(dictionary! {}, ops.into_bytes()));

    let mut page = dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => rect(fixture.media),
        "Contents" => contents_id,
    };
    if let Some(crop) = fixture.crop {
        page.set("CropBox", rect(crop));
    }
    if !fixture.rotate_on_parent {
        page.set("Rotate", fixture.rotate);
    }
    let page_id = doc.add_object(page);

    // Resources live on the Pages node so stamping has to handle inheritance.
    let mut pages = dictionary! {
        "Type" => "Pages",
        "Kids" => vec![page_id.into()],
        "Count" => 1,
        "Resources" => dictionary! { "Font" => dictionary! { "F1" => font_id } },
    };
    if fixture.rotate_on_parent {
        pages.set("Rotate", fixture.rotate);
    }
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);

    let mut out = Vec::new();
    doc.save_to(&mut out).expect("writing to a Vec cannot fail");
    out
}

fn rect(r: [f32; 4]) -> Vec<Object> {
    r.iter().map(|&v| v.into()).collect()
}

/// A 600 × 200 transparent PNG with a dark-blue scribble, standing in for a real signature.
pub fn sample_signature_png() -> Vec<u8> {
    let (w, h) = (600u32, 200u32);
    let mut img = RgbaImage::from_pixel(w, h, Rgba([0, 0, 0, 0]));
    let ink = Rgba([20, 30, 110, 255]);
    let steps = 4000;
    for i in 0..steps {
        let t = i as f32 / steps as f32;
        // A looping baseline scribble with a final flourish.
        let x = 30.0 + t * 540.0 + 25.0 * (t * 40.0).cos();
        let y = 100.0 + 45.0 * (t * 40.0).sin() * (1.0 - t * 0.6) + 20.0 * (t * 6.0).sin();
        dot(&mut img, x, y, 3.5, ink);
    }
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, ImageFormat::Png)
        .expect("encoding a PNG in memory cannot fail");
    out.into_inner()
}

fn dot(img: &mut RgbaImage, cx: f32, cy: f32, r: f32, ink: Rgba<u8>) {
    let (w, h) = img.dimensions();
    let (x0, x1) = (
        (cx - r).floor().max(0.0) as u32,
        ((cx + r).ceil() as u32).min(w - 1),
    );
    let (y0, y1) = (
        (cy - r).floor().max(0.0) as u32,
        ((cy + r).ceil() as u32).min(h - 1),
    );
    for y in y0..=y1 {
        for x in x0..=x1 {
            let (dx, dy) = (x as f32 - cx, y as f32 - cy);
            if dx * dx + dy * dy <= r * r {
                img.put_pixel(x, y, ink);
            }
        }
    }
}
