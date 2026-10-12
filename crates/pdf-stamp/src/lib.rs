//! Stamp signature images onto PDF pages.
//!
//! Placements are given in **display space**: PDF points (1/72 in) with the
//! origin at the bottom-left of the page *as a viewer shows it*, i.e. after the
//! page's CropBox and `/Rotate` are applied. The stamp is written into the page
//! content, so every viewer shows and prints it.

mod geometry;
#[doc(hidden)]
pub mod testpdf;

use std::collections::{BTreeMap, HashMap, hash_map::Entry};

use image::RgbaImage;
use lopdf::{Dictionary, Document, Object, ObjectId, Stream, dictionary};

pub use geometry::{Matrix, PageGeometry};

/// Which image to draw where, in display-space points.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    /// Index into the `images` passed to [`stamp`].
    pub image: usize,
    /// 1-based page number.
    pub page: u32,
    /// Bottom-left corner.
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("could not process PDF: {0}")]
    Pdf(#[from] lopdf::Error),
    #[error("could not read signature image: {0}")]
    Image(#[from] image::ImageError),
    #[error("encrypted PDFs are not supported")]
    Encrypted,
    #[error("page {page} does not exist (the document has {count} pages)")]
    NoSuchPage { page: u32, count: usize },
    #[error("placement uses image {index}, but only {count} images were given")]
    NoSuchImage { index: usize, count: usize },
    #[error("page {page} is malformed: {reason}")]
    BadPage { page: u32, reason: &'static str },
}

pub type Result<T> = std::result::Result<T, Error>;

/// Returns a copy of `pdf` with each placement's image (PNG or JPEG bytes from `images`) drawn on it.
pub fn stamp(pdf: &[u8], images: &[&[u8]], placements: &[Placement]) -> Result<Vec<u8>> {
    let mut doc = Document::load_mem(pdf)?;
    if doc.was_encrypted() {
        return Err(Error::Encrypted);
    }

    let pages = doc.get_pages();
    let mut by_page: BTreeMap<u32, Vec<&Placement>> = BTreeMap::new();
    for p in placements {
        if p.image >= images.len() {
            return Err(Error::NoSuchImage {
                index: p.image,
                count: images.len(),
            });
        }
        if !pages.contains_key(&p.page) {
            return Err(Error::NoSuchPage {
                page: p.page,
                count: pages.len(),
            });
        }
        by_page.entry(p.page).or_default().push(p);
    }
    if by_page.is_empty() {
        return Ok(pdf.to_vec());
    }

    // Each image used is embedded once and shared by all its placements.
    let mut image_ids: HashMap<usize, ObjectId> = HashMap::new();
    for p in placements {
        if let Entry::Vacant(slot) = image_ids.entry(p.image) {
            let decoded = image::load_from_memory(images[p.image])?.into_rgba8();
            slot.insert(add_image(&mut doc, &decoded)?);
        }
    }

    for (page, placements) in by_page {
        let page_id = pages[&page];
        let geometry = PageGeometry::read(&doc, page_id).ok_or(Error::BadPage {
            page,
            reason: "no valid MediaBox",
        })?;
        let to_user = geometry.display_to_user();

        // Resource name for each image used on this page.
        let mut names: HashMap<usize, String> = HashMap::new();
        for p in &placements {
            if let Entry::Vacant(slot) = names.entry(p.image) {
                let name = add_xobject_resource(&mut doc, page_id, image_ids[&p.image])?;
                slot.insert(String::from_utf8_lossy(&name).into_owned());
            }
        }

        let mut ops = String::new();
        for p in placements {
            ops += &format!(
                "q {to_user} cm {} 0 0 {} {} {} cm /{} Do Q\n",
                p.width, p.height, p.x, p.y, names[&p.image]
            );
        }
        wrap_contents(&mut doc, page_id, page, ops.as_bytes())?;
    }

    let mut out = Vec::new();
    doc.save_to(&mut out).expect("writing to a Vec cannot fail");
    Ok(out)
}

/// Adds the image as an RGB XObject, with an `/SMask` if it has any transparency.
fn add_image(doc: &mut Document, image: &RgbaImage) -> Result<ObjectId> {
    let (width, height) = image.dimensions();
    let mut rgb = Vec::with_capacity(image.len() / 4 * 3);
    let mut alpha = Vec::with_capacity(image.len() / 4);
    for px in image.pixels() {
        rgb.extend_from_slice(&px.0[..3]);
        alpha.push(px.0[3]);
    }

    let image_dict = |color_space: &str| {
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => width,
            "Height" => height,
            "ColorSpace" => color_space,
            "BitsPerComponent" => 8,
        }
    };

    let mut dict = image_dict("DeviceRGB");
    if alpha.iter().any(|&a| a < 255) {
        let mut mask = Stream::new(image_dict("DeviceGray"), alpha);
        mask.compress()?;
        dict.set("SMask", doc.add_object(mask));
    }
    let mut stream = Stream::new(dict, rgb);
    stream.compress()?;
    Ok(doc.add_object(stream))
}

/// Registers the image in the page's `/XObject` resources and returns the name it was given.
///
/// Resources may be inherited or shared with other pages, so the page gets its
/// own copy of the effective dictionary rather than editing a shared one.
fn add_xobject_resource(
    doc: &mut Document,
    page_id: ObjectId,
    image_id: ObjectId,
) -> Result<Vec<u8>> {
    let mut resources = geometry::inherited(doc, page_id, b"Resources")
        .and_then(|o| o.as_dict().ok())
        .cloned()
        .unwrap_or_default();
    let mut xobjects = resources
        .get(b"XObject")
        .ok()
        .and_then(|o| doc.dereference(o).ok())
        .and_then(|(_, o)| o.as_dict().ok())
        .cloned()
        .unwrap_or_default();

    let name = (0..)
        .map(|i| format!("PdfSign{i}").into_bytes())
        .find(|n| !xobjects.has(n))
        .expect("an unused name exists");
    xobjects.set(name.clone(), image_id);
    resources.set("XObject", xobjects);
    doc.get_dictionary_mut(page_id)?.set("Resources", resources);
    Ok(name)
}

/// Wraps the existing content in `q … Q` and appends `ops` after it.
///
/// Existing content can leave the graphics state (e.g. the transformation
/// matrix) modified; isolating it means the stamp always starts from a clean state.
fn wrap_contents(doc: &mut Document, page_id: ObjectId, page: u32, ops: &[u8]) -> Result<()> {
    let existing = match doc.get_dictionary(page_id)?.get(b"Contents") {
        Ok(Object::Reference(id)) => match doc.get_object(*id)? {
            Object::Array(items) => items.clone(),
            _ => vec![Object::Reference(*id)],
        },
        Ok(Object::Array(items)) => items.clone(),
        Ok(_) => {
            return Err(Error::BadPage {
                page,
                reason: "Contents is not a stream or array",
            });
        }
        Err(_) => Vec::new(),
    };

    let open = doc.add_object(Stream::new(Dictionary::new(), b"q\n".to_vec()));
    let mut close = Stream::new(Dictionary::new(), [b"\nQ\n".as_slice(), ops].concat());
    close.compress()?;
    let close = doc.add_object(close);

    let mut contents = Vec::with_capacity(existing.len() + 2);
    contents.push(open.into());
    contents.extend(existing);
    contents.push(close.into());
    doc.get_dictionary_mut(page_id)?.set("Contents", contents);
    Ok(())
}
