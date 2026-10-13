//! WebAssembly bindings for [`pdf_stamp`].
//!
//! Built with `wasm-pack build --target web`; see the `demo/` page for usage.

use pdf_stamp::Placement;
use wasm_bindgen::prelude::*;

/// What [`inspect`] learns about a PDF.
#[wasm_bindgen]
pub struct Inspection {
    sizes: Vec<f64>,
    digitally_signed: bool,
}

#[wasm_bindgen]
impl Inspection {
    /// Each page's display size as a flat `[width, height, …]` array, in points.
    #[wasm_bindgen(getter)]
    pub fn sizes(&self) -> Vec<f64> {
        self.sizes.clone()
    }

    /// The PDF has a digital signature or certification, which stamping invalidates.
    #[wasm_bindgen(getter, js_name = digitallySigned)]
    pub fn digitally_signed(&self) -> bool {
        self.digitally_signed
    }
}

/// Checks that `pdf` can be edited, without changing it.
///
/// Throws with a user-facing message if the PDF can't be edited (encrypted,
/// damaged, …).
#[wasm_bindgen]
pub fn inspect(pdf: &[u8]) -> Result<Inspection, JsError> {
    let info = pdf_stamp::inspect(pdf)?;
    Ok(Inspection {
        sizes: info
            .pages
            .iter()
            .flat_map(|page| {
                let (w, h) = page.display_size();
                [f64::from(w), f64::from(h)]
            })
            .collect(),
        digitally_signed: info.digitally_signed,
    })
}

/// Stamps placements onto `pdf` and returns the new PDF bytes.
///
/// - `images`: PNG or JPEG files concatenated into one buffer.
/// - `image_lengths`: the byte length of each image in `images`, in order.
/// - `placements`: an array of `{ page, x, y, width, height, item }` objects.
///   `page` is 1-based; the rest are display-space points from the bottom-left
///   of the page as shown. `item` is what to draw:
///   - `{ kind: "image", image }`, where `image` indexes the images;
///   - `{ kind: "text", font, size, color, lines }`: `font` is a standard
///     font's PostScript name (`"Helvetica"`, `"Times-Bold"`, …), `color` is
///     `[r, g, b]` in 0–255, and `lines` are `{ text, x, y }` baselines
///     relative to the box's bottom-left corner.
///
/// Throws on invalid input.
#[wasm_bindgen]
pub fn stamp(
    pdf: &[u8],
    images: &[u8],
    image_lengths: &[u32],
    placements: JsValue,
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

    let placements: Vec<Placement> = serde_wasm_bindgen::from_value(placements)
        .map_err(|e| JsError::new(&format!("invalid placements: {e}")))?;
    Ok(pdf_stamp::stamp(pdf, &images, &placements)?)
}
