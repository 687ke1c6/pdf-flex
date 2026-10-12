//! WebAssembly bindings for [`pdf_stamp`].
//!
//! Built with `wasm-pack build --target web`; see the `demo/` page for usage.

use pdf_stamp::Placement;
use wasm_bindgen::prelude::*;

/// Numbers per placement in the flat array passed to [`stamp`].
const FIELDS: usize = 5;

/// Stamps `signature` (PNG or JPEG bytes) onto `pdf` and returns the new PDF bytes.
///
/// `placements` is a flat array of `[page, x, y, width, height]` groups: page
/// is 1-based, the rest are display-space points from the bottom-left of the
/// page as shown. Throws on invalid input.
#[wasm_bindgen]
pub fn stamp(pdf: &[u8], signature: &[u8], placements: &[f64]) -> Result<Vec<u8>, JsError> {
    let (groups, rest) = placements.as_chunks::<FIELDS>();
    if !rest.is_empty() {
        return Err(JsError::new(
            "placements must be [page, x, y, width, height] groups",
        ));
    }
    let placements: Vec<Placement> = groups
        .iter()
        .map(|&[page, x, y, width, height]| Placement {
            page: page as u32,
            x: x as f32,
            y: y as f32,
            width: width as f32,
            height: height as f32,
        })
        .collect();
    Ok(pdf_stamp::stamp(pdf, signature, &placements)?)
}
