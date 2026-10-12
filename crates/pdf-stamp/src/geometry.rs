//! Page boxes, rotation, and the mapping from display space to PDF user space.

use std::fmt;

use lopdf::{Document, Object, ObjectId};

/// A 2D affine transform in PDF order: `[a b c d e f]` maps `(x, y)` to
/// `(a·x + c·y + e, b·x + d·y + f)`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Matrix(pub [f32; 6]);

impl Matrix {
    pub fn apply(&self, x: f32, y: f32) -> (f32, f32) {
        let [a, b, c, d, e, f] = self.0;
        (a * x + c * y + e, b * x + d * y + f)
    }
}

/// Formats as the six operands of a `cm` operator.
impl fmt::Display for Matrix {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let [a, b, c, d, e, g] = self.0;
        write!(f, "{a} {b} {c} {d} {e} {g}")
    }
}

/// The visible area of a page and how a viewer rotates it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageGeometry {
    /// Visible area in user space, normalised to `[llx, lly, urx, ury]`.
    pub crop: [f32; 4],
    /// Clockwise display rotation: 0, 90, 180 or 270.
    pub rotate: u16,
}

impl PageGeometry {
    pub fn new(crop: [f32; 4], rotate: i64) -> Self {
        let rotate = rotate.rem_euclid(360);
        // The spec requires a multiple of 90; viewers treat anything else as 0.
        let rotate = if rotate % 90 == 0 { rotate as u16 } else { 0 };
        Self {
            crop: normalise(crop),
            rotate,
        }
    }

    /// Reads MediaBox, CropBox and Rotate, following inheritance through the page tree.
    pub fn read(doc: &Document, page_id: ObjectId) -> Option<Self> {
        let media = inherited(doc, page_id, b"MediaBox").and_then(|o| rect(doc, o))?;
        let crop = inherited(doc, page_id, b"CropBox")
            .and_then(|o| rect(doc, o))
            .and_then(|c| intersect(c, media))
            .unwrap_or(media);
        let rotate = inherited(doc, page_id, b"Rotate")
            .and_then(|o| o.as_i64().ok())
            .unwrap_or(0);
        Some(Self::new(crop, rotate))
    }

    /// Width and height of the page as a viewer shows it, in points.
    pub fn display_size(&self) -> (f32, f32) {
        let [llx, lly, urx, ury] = self.crop;
        let (w, h) = (urx - llx, ury - lly);
        if self.rotate % 180 == 90 {
            (h, w)
        } else {
            (w, h)
        }
    }

    /// Maps display space (origin bottom-left of the page as shown, y up) to user space.
    pub fn display_to_user(&self) -> Matrix {
        let [llx, lly, urx, ury] = self.crop;
        let (w, h) = (urx - llx, ury - lly);
        Matrix(match self.rotate {
            90 => [0.0, 1.0, -1.0, 0.0, llx + w, lly],
            180 => [-1.0, 0.0, 0.0, -1.0, llx + w, lly + h],
            270 => [0.0, -1.0, 1.0, 0.0, llx, lly + h],
            _ => [1.0, 0.0, 0.0, 1.0, llx, lly],
        })
    }
}

/// Looks up a page attribute, walking up `/Parent` links for inheritable keys.
pub(crate) fn inherited<'a>(
    doc: &'a Document,
    page_id: ObjectId,
    key: &[u8],
) -> Option<&'a Object> {
    let mut id = page_id;
    // Bounded walk: malformed files can contain Parent cycles.
    for _ in 0..64 {
        let dict = doc.get_dictionary(id).ok()?;
        if let Ok(obj) = dict.get(key) {
            return doc.dereference(obj).ok().map(|(_, o)| o);
        }
        id = dict.get(b"Parent").and_then(Object::as_reference).ok()?;
    }
    None
}

fn rect(doc: &Document, obj: &Object) -> Option<[f32; 4]> {
    let arr = obj.as_array().ok()?;
    if arr.len() != 4 {
        return None;
    }
    let mut out = [0.0; 4];
    for (slot, item) in out.iter_mut().zip(arr) {
        *slot = doc.dereference(item).ok()?.1.as_float().ok()?;
    }
    Some(normalise(out))
}

fn normalise([x0, y0, x1, y1]: [f32; 4]) -> [f32; 4] {
    [x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1)]
}

fn intersect(a: [f32; 4], b: [f32; 4]) -> Option<[f32; 4]> {
    let r = [
        a[0].max(b[0]),
        a[1].max(b[1]),
        a[2].min(b[2]),
        a[3].min(b[3]),
    ];
    (r[0] < r[2] && r[1] < r[3]).then_some(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CROP: [f32; 4] = [50.0, 100.0, 650.0, 900.0]; // 600 × 800

    fn corners(rotate: i64) -> ((f32, f32), (f32, f32)) {
        let g = PageGeometry::new(CROP, rotate);
        let (w, h) = g.display_size();
        let m = g.display_to_user();
        (m.apply(0.0, 0.0), m.apply(w, h))
    }

    #[test]
    fn display_size_swaps_on_quarter_turns() {
        assert_eq!(PageGeometry::new(CROP, 0).display_size(), (600.0, 800.0));
        assert_eq!(PageGeometry::new(CROP, 90).display_size(), (800.0, 600.0));
        assert_eq!(PageGeometry::new(CROP, 180).display_size(), (600.0, 800.0));
        assert_eq!(PageGeometry::new(CROP, -90).display_size(), (800.0, 600.0));
    }

    // Display bottom-left lands on the user-space corner a clockwise rotation moves there.
    #[test]
    fn display_corners_map_to_crop_corners() {
        assert_eq!(corners(0), ((50.0, 100.0), (650.0, 900.0)));
        assert_eq!(corners(90), ((650.0, 100.0), (50.0, 900.0)));
        assert_eq!(corners(180), ((650.0, 900.0), (50.0, 100.0)));
        assert_eq!(corners(270), ((50.0, 900.0), (650.0, 100.0)));
    }

    #[test]
    fn invalid_rotation_is_ignored() {
        assert_eq!(PageGeometry::new(CROP, 45).rotate, 0);
        assert_eq!(PageGeometry::new(CROP, 450).rotate, 90);
    }

    #[test]
    fn crop_is_clipped_to_media() {
        assert_eq!(
            intersect([0.0, 0.0, 100.0, 100.0], [50.0, 50.0, 200.0, 200.0]),
            Some([50.0, 50.0, 100.0, 100.0])
        );
        assert_eq!(
            intersect([0.0, 0.0, 10.0, 10.0], [20.0, 20.0, 30.0, 30.0]),
            None
        );
    }
}
