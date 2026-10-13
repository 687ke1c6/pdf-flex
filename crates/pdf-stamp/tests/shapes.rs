//! Shape items, checked by rendering with poppler's `pdftoppm`: each shape is
//! drawn where it was placed, on every fixture (rotations and crop boxes), and
//! nothing else on the page changes. Skipped with a message if pdftoppm is missing.

mod common;

use common::{Gray, poppler_available, render};
use pdf_stamp::{Error, Item, Placement, Segment, Stroke, stamp, testpdf};

const BLACK: [u8; 3] = [0, 0, 0];

fn rect_path(w: f32, h: f32) -> Vec<Segment> {
    vec![
        Segment::MoveTo { x: 0.0, y: 0.0 },
        Segment::LineTo { x: w, y: 0.0 },
        Segment::LineTo { x: w, y: h },
        Segment::LineTo { x: 0.0, y: h },
        Segment::Close,
    ]
}

/// An ellipse filling a w × h box, as four Bézier curves.
fn ellipse_path(w: f32, h: f32) -> Vec<Segment> {
    let k = 0.552_284_8;
    let (rx, ry, cx, cy) = (w / 2.0, h / 2.0, w / 2.0, h / 2.0);
    let curve = |x1, y1, x2, y2, x, y| Segment::CurveTo {
        x1,
        y1,
        x2,
        y2,
        x,
        y,
    };
    vec![
        Segment::MoveTo { x: cx + rx, y: cy },
        curve(cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry),
        curve(cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy),
        curve(cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry),
        curve(cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy),
        Segment::Close,
    ]
}

fn shape(
    item_path: Vec<Segment>,
    stroke: Option<Stroke>,
    fill: Option<[u8; 3]>,
    rounded: bool,
) -> Item {
    Item::Shape {
        path: item_path,
        stroke,
        fill,
        rounded,
    }
}

fn at(item: Item, x: f32, y: f32, width: f32, height: f32) -> Placement {
    Placement {
        item,
        page: 1,
        x,
        y,
        width,
        height,
    }
}

/// The grey level at a display-space point (y up), at 1 px per pt.
fn pixel(img: &Gray, page_height: f32, x: f32, y: f32) -> u8 {
    let (px, py) = (x as usize, (page_height - y) as usize);
    img.pixels[py * img.width + px]
}

#[test]
fn shapes_land_where_placed_on_every_fixture() {
    if !poppler_available() {
        return;
    }
    let stroke = |width| {
        Some(Stroke {
            color: BLACK,
            width,
        })
    };
    for fixture in testpdf::fixtures() {
        let name = fixture.name;
        let target = fixture.target(3.0);
        let pdf = testpdf::build(&fixture, &target);
        let (_, h) = fixture.geometry().display_size();

        // A filled rectangle, a stroked ellipse and a thick line, clear of the fixture's own drawing.
        let rect = at(
            shape(rect_path(120.0, 60.0), None, Some(BLACK), false),
            60.0,
            150.0,
            120.0,
            60.0,
        );
        let ellipse = at(
            shape(ellipse_path(120.0, 80.0), stroke(4.0), None, false),
            260.0,
            200.0,
            120.0,
            80.0,
        );
        let line_path = vec![
            Segment::MoveTo { x: 0.0, y: 0.0 },
            Segment::LineTo { x: 150.0, y: 50.0 },
        ];
        let line = at(
            shape(line_path, stroke(6.0), None, true),
            50.0,
            300.0,
            150.0,
            50.0,
        );
        let out = stamp(&pdf, &[], &[rect, ellipse, line]).unwrap();

        let before = render(&pdf, 1).unwrap();
        let after = render(&out, 1).unwrap();
        let dark = |x, y| pixel(&after, h, x, y) < 60;
        let unchanged = |x, y| pixel(&after, h, x, y).abs_diff(pixel(&before, h, x, y)) <= 8;

        // Rectangle: solid inside.
        for (x, y) in [(65.0, 155.0), (120.0, 180.0), (175.0, 205.0)] {
            assert!(dark(x, y), "{name}: rectangle not filled at {x},{y}");
        }
        // Ellipse: its outline is dark at the ends of both axes; inside and the box corners are untouched.
        for (x, y) in [
            (261.5, 240.0),
            (378.5, 240.0),
            (320.0, 201.5),
            (320.0, 278.5),
        ] {
            assert!(dark(x, y), "{name}: no ellipse outline at {x},{y}");
        }
        for (x, y) in [(320.0, 240.0), (263.0, 203.0), (377.0, 277.0)] {
            assert!(unchanged(x, y), "{name}: ellipse drew at {x},{y}");
        }
        // Line: dark along it, clear beside it.
        for t in [0.1, 0.5, 0.9] {
            assert!(
                dark(50.0 + 150.0 * t, 300.0 + 50.0 * t),
                "{name}: line missing at t={t}"
            );
        }
        assert!(unchanged(125.0, 345.0), "{name}: line drew off its path");

        // Nothing outside the three boxes changed.
        let boxes = [
            (60.0, 150.0, 120.0, 60.0),
            (260.0, 200.0, 120.0, 80.0),
            (50.0, 300.0, 150.0, 50.0),
        ];
        let margin = 5.0;
        let mut changed = 0;
        for py in 0..before.height {
            for px in 0..before.width {
                let (x, y) = (px as f32 + 0.5, h - py as f32 - 0.5);
                let inside = boxes.iter().any(|&(bx, by, bw, bh)| {
                    x > bx - margin
                        && x < bx + bw + margin
                        && y > by - margin
                        && y < by + bh + margin
                });
                let i = py * before.width + px;
                if !inside && before.pixels[i].abs_diff(after.pixels[i]) > 8 {
                    changed += 1;
                }
            }
        }
        assert_eq!(
            changed, 0,
            "{name}: {changed} px changed outside the shapes"
        );
    }
}

#[test]
fn stroke_and_fill_together_use_one_paint_operator() {
    let fixture = &testpdf::fixtures()[0];
    let target = fixture.target(3.0);
    let pdf = testpdf::build(fixture, &target);
    let item = shape(
        rect_path(20.0, 10.0),
        Some(Stroke {
            color: [255, 0, 0],
            width: 2.0,
        }),
        Some([255, 255, 255]),
        false,
    );
    let out = stamp(&pdf, &[], &[at(item, 10.0, 10.0, 20.0, 10.0)]).unwrap();
    let doc = lopdf::Document::load_mem(&out).unwrap();
    let content = String::from_utf8_lossy(&doc.get_page_content(doc.get_pages()[&1])).into_owned();
    assert!(
        content.contains("1 0 0 RG 2 w 1 1 1 rg 0 0 m 20 0 l 20 10 l 0 10 l h B"),
        "{content}"
    );
}

#[test]
fn rejects_shapes_that_cant_be_drawn() {
    let fixture = &testpdf::fixtures()[0];
    let target = fixture.target(3.0);
    let pdf = testpdf::build(fixture, &target);
    let good = at(
        shape(rect_path(10.0, 10.0), None, Some(BLACK), false),
        10.0,
        10.0,
        10.0,
        10.0,
    );
    let bad = [
        shape(rect_path(10.0, 10.0), None, None, false),
        shape(vec![], None, Some(BLACK), false),
        shape(rect_path(f32::NAN, 10.0), None, Some(BLACK), false),
        shape(
            rect_path(10.0, 10.0),
            Some(Stroke {
                color: BLACK,
                width: -1.0,
            }),
            None,
            false,
        ),
    ];
    for item in bad {
        let err = stamp(
            &pdf,
            &[],
            &[good.clone(), at(item.clone(), 10.0, 10.0, 10.0, 10.0)],
        )
        .unwrap_err();
        assert!(
            matches!(err, Error::BadPlacement { index: 1 }),
            "{item:?}: {err:?}"
        );
    }
}
