//! WebAssembly bindings for [`pdf_stamp`].
//!
//! Built with `wasm-pack build --target web`; see the `demo/` page for usage.

use pdf_stamp::Placement;
use wasm_bindgen::prelude::*;

/// Numbers per placement in the flat array passed to [`stamp`].
const FIELDS: usize = 6;

/// Stamps images onto `pdf` and returns the new PDF bytes.
///
/// - `images`: PNG or JPEG files concatenated into one buffer.
/// - `image_lengths`: the byte length of each image in `images`, in order.
/// - `placements`: a flat array of `[image, page, x, y, width, height]`
///   groups. `image` indexes the images, `page` is 1-based, the rest are
///   display-space points from the bottom-left of the page as shown.
///
/// Throws on invalid input.
#[wasm_bindgen]
pub fn stamp(
    pdf: &[u8],
    images: &[u8],
    image_lengths: &[u32],
    placements: &[f64],
) -> Result<Vec<u8>, JsError> {
    let total: usize = image_lengths.iter().map(|&n| n as usize).sum();
    if total != images.len() {
        return Err(JsError::new(
            "image_lengths must add up to the size of images",
        ));
    }
    let mut rest = images;
    let images: Vec<&[u8]> = image_lengths
        .iter()
        .map(|&n| {
            let (image, tail) = rest.split_at(n as usize);
            rest = tail;
            image
        })
        .collect();

    let (groups, rest) = placements.as_chunks::<FIELDS>();
    if !rest.is_empty() {
        return Err(JsError::new(
            "placements must be [image, page, x, y, width, height] groups",
        ));
    }
    let placements: Vec<Placement> = groups
        .iter()
        .map(|&[image, page, x, y, width, height]| Placement {
            image: image as usize,
            page: page as u32,
            x: x as f32,
            y: y as f32,
            width: width as f32,
            height: height as f32,
        })
        .collect();
    Ok(pdf_stamp::stamp(pdf, &images, &placements)?)
}
