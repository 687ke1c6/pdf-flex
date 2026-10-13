//! Vector shapes: paths drawn with PDF path operators, stroked and/or filled.
//!
//! The caller builds the path in points relative to the placement box's
//! bottom-left corner (y up), so line widths are never distorted by the box.

use std::io::Write;

/// One step of a path, as PDF path operators.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Deserialize), serde(tag = "op"))]
pub enum Segment {
    /// Starts a new subpath (`m`).
    #[cfg_attr(feature = "serde", serde(rename = "M"))]
    MoveTo { x: f32, y: f32 },
    /// A straight line (`l`).
    #[cfg_attr(feature = "serde", serde(rename = "L"))]
    LineTo { x: f32, y: f32 },
    /// A cubic Bézier curve (`c`).
    #[cfg_attr(feature = "serde", serde(rename = "C"))]
    CurveTo {
        x1: f32,
        y1: f32,
        x2: f32,
        y2: f32,
        x: f32,
        y: f32,
    },
    /// Closes the subpath (`h`).
    #[cfg_attr(feature = "serde", serde(rename = "Z"))]
    Close,
}

impl Segment {
    fn numbers(&self) -> Vec<f32> {
        match *self {
            Segment::MoveTo { x, y } | Segment::LineTo { x, y } => vec![x, y],
            Segment::CurveTo {
                x1,
                y1,
                x2,
                y2,
                x,
                y,
            } => vec![x1, y1, x2, y2, x, y],
            Segment::Close => vec![],
        }
    }
}

/// How a path's outline is drawn.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Deserialize))]
pub struct Stroke {
    /// 0–255 RGB.
    pub color: [u8; 3],
    /// Line width in points.
    pub width: f32,
}

/// Whether a shape can be drawn: a path starting with a move, finite numbers,
/// a positive line width, and something to paint (a stroke, a fill or both).
pub fn is_valid(path: &[Segment], stroke: Option<&Stroke>, fill: Option<&[u8; 3]>) -> bool {
    let starts = matches!(path.first(), Some(Segment::MoveTo { .. }));
    let finite = path.iter().flat_map(Segment::numbers).all(f32::is_finite);
    let width_ok = stroke.is_none_or(|s| s.width.is_finite() && s.width > 0.0);
    starts && finite && width_ok && (stroke.is_some() || fill.is_some())
}

fn channel(c: u8) -> f32 {
    f32::from(c) / 255.0
}

/// Writes the operators for a shape, after the box's origin has been moved to (0, 0).
pub fn write(
    ops: &mut Vec<u8>,
    path: &[Segment],
    stroke: Option<&Stroke>,
    fill: Option<&[u8; 3]>,
    rounded: bool,
) {
    let w = "writing to a Vec cannot fail";
    if rounded {
        // Round caps and joins (the default is butt caps and mitred corners).
        ops.extend_from_slice(b" 1 J 1 j");
    }
    if let Some(Stroke {
        color: [r, g, b],
        width,
    }) = stroke
    {
        write!(
            ops,
            " {} {} {} RG {width} w",
            channel(*r),
            channel(*g),
            channel(*b)
        )
        .expect(w);
    }
    if let Some([r, g, b]) = fill {
        write!(ops, " {} {} {} rg", channel(*r), channel(*g), channel(*b)).expect(w);
    }
    for segment in path {
        match *segment {
            Segment::MoveTo { x, y } => write!(ops, " {x} {y} m"),
            Segment::LineTo { x, y } => write!(ops, " {x} {y} l"),
            Segment::CurveTo {
                x1,
                y1,
                x2,
                y2,
                x,
                y,
            } => write!(ops, " {x1} {y1} {x2} {y2} {x} {y} c"),
            Segment::Close => write!(ops, " h"),
        }
        .expect(w);
    }
    let paint: &[u8] = match (stroke, fill) {
        (Some(_), Some(_)) => b" B",
        (Some(_), None) => b" S",
        (None, _) => b" f",
    };
    ops.extend_from_slice(paint);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect() -> Vec<Segment> {
        vec![
            Segment::MoveTo { x: 0.0, y: 0.0 },
            Segment::LineTo { x: 10.0, y: 0.0 },
            Segment::LineTo { x: 10.0, y: 5.0 },
            Segment::Close,
        ]
    }

    fn written(stroke: Option<&Stroke>, fill: Option<&[u8; 3]>, rounded: bool) -> String {
        let mut ops = Vec::new();
        write(&mut ops, &rect(), stroke, fill, rounded);
        String::from_utf8(ops).unwrap()
    }

    #[test]
    fn writes_path_operators_and_the_right_paint() {
        let stroke = Stroke {
            color: [255, 0, 0],
            width: 2.0,
        };
        assert_eq!(
            written(Some(&stroke), None, false),
            " 1 0 0 RG 2 w 0 0 m 10 0 l 10 5 l h S"
        );
        assert_eq!(
            written(None, Some(&[0, 0, 255]), false),
            " 0 0 1 rg 0 0 m 10 0 l 10 5 l h f"
        );
        assert!(
            written(Some(&stroke), Some(&[255, 255, 255]), true)
                .starts_with(" 1 J 1 j 1 0 0 RG 2 w 1 1 1 rg")
        );
        assert!(written(Some(&stroke), Some(&[255, 255, 255]), false).ends_with(" B"));
    }

    #[test]
    fn validity() {
        let stroke = Stroke {
            color: [0, 0, 0],
            width: 1.0,
        };
        assert!(is_valid(&rect(), Some(&stroke), None));
        assert!(!is_valid(&rect(), None, None), "nothing to paint");
        assert!(!is_valid(&[], Some(&stroke), None), "empty path");
        assert!(
            !is_valid(&rect()[1..], Some(&stroke), None),
            "doesn't start with a move"
        );
        let thin = Stroke {
            width: 0.0,
            ..stroke
        };
        assert!(!is_valid(&rect(), Some(&thin), None));
        let nan = [Segment::MoveTo {
            x: f32::NAN,
            y: 0.0,
        }];
        assert!(!is_valid(&nan, None, Some(&[0, 0, 0])));
    }
}
