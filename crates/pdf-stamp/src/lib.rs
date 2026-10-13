//! Stamp images and text onto PDF pages.
//!
//! Placements are given in **display space**: PDF points (1/72 in) with the
//! origin at the bottom-left of the page *as a viewer shows it*, i.e. after the
//! page's CropBox and `/Rotate` are applied. The stamp is written into the page
//! content, so every viewer shows and prints it.

mod geometry;
mod repair;
#[doc(hidden)]
pub mod testpdf;
pub mod text;

use std::collections::{BTreeMap, HashMap, hash_map::Entry};
use std::io::{Cursor, Write};

use image::{ImageReader, Limits, RgbaImage};
use lopdf::content::Content;
use lopdf::{
    DecompressError, Dictionary, Document, LoadOptions, Object, ObjectId, ParseError, Stream,
    dictionary,
};

pub use geometry::{LETTER, Matrix, PageGeometry};
pub use text::{Font, Line};

/// No single compressed stream in the input may expand beyond this many bytes
/// while loading. Real object streams are kilobytes; this stops a small file
/// from inflating into gigabytes (a "decompression bomb").
pub const MAX_DECOMPRESSED_SIZE: usize = 64 << 20;

/// Largest signature image accepted, in pixels on either side. The app's own
/// signatures are at most 1600 px; this only stops absurd inputs.
pub const MAX_IMAGE_SIDE: u32 = 10_000;

/// What to draw, and where: a box in display-space points.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Deserialize))]
pub struct Placement {
    pub item: Item,
    /// 1-based page number.
    pub page: u32,
    /// Bottom-left corner.
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// What a placement draws.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(
    feature = "serde",
    derive(serde::Deserialize),
    serde(tag = "kind", rename_all = "camelCase")
)]
pub enum Item {
    /// One of the `images` passed to [`stamp`], by index, stretched to fill the box.
    Image { image: usize },
    /// Real text (selectable and searchable) in a standard font. The caller
    /// lays it out: each line's baseline start is given relative to the box's
    /// bottom-left corner, and the box itself only positions it.
    Text {
        font: Font,
        /// Font size in points.
        size: f32,
        /// Fill colour as 0–255 RGB.
        color: [u8; 3],
        lines: Vec<Line>,
    },
}

/// Everything that can go wrong. The messages are written for end users: the
/// web app shows them as they are.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("This file isn't a PDF.")]
    NotPdf,
    #[error(
        "This PDF is password-protected or has security restrictions, so it can't be edited here. \
         Remove the protection first, for example by printing it to a new PDF."
    )]
    Encrypted,
    #[error(
        "This PDF contains a compressed section that expands to more than {} MB, so it wasn't opened. \
         The file may be corrupt.",
        MAX_DECOMPRESSED_SIZE >> 20
    )]
    TooLarge,
    #[error("This PDF is damaged and couldn't be read ({0}).")]
    Damaged(String),
    #[error("Page {page} is damaged and can't be edited ({reason}).")]
    BadPage { page: u32, reason: &'static str },
    #[error(
        "Page {page} doesn't exist: this PDF has {count} {}.",
        if *count == 1 { "page" } else { "pages" }
    )]
    NoSuchPage { page: u32, count: usize },
    #[error("A signature image couldn't be read ({0}). Try importing it again.")]
    BadImage(String),
    #[error(
        "A signature image is too large ({width} × {height} pixels). \
         The limit is {MAX_IMAGE_SIDE} pixels on each side."
    )]
    ImageTooLarge { width: u32, height: u32 },
    #[error("Placed item {} has an invalid position or size.", index + 1)]
    BadPlacement { index: usize },
    #[error(
        "The character {character:?} can't be written in {font}. \
         Use image text for other characters."
    )]
    UnsupportedCharacter { character: char, font: &'static str },
    #[error("placement uses image {index}, but only {count} images were given")]
    NoSuchImage { index: usize, count: usize },
    #[error("The edited PDF couldn't be written ({0}).")]
    Write(String),
}

pub type Result<T> = std::result::Result<T, Error>;

/// What [`inspect`] learns about a PDF.
#[derive(Debug, Clone, PartialEq)]
pub struct Info {
    /// Each page's geometry, in order. `display_size` is what viewers show.
    pub pages: Vec<PageGeometry>,
    /// The PDF carries a digital signature or certification. Stamping
    /// rewrites the file, which invalidates it, so the user should be told.
    pub digitally_signed: bool,
}

/// Checks that `pdf` can be edited, without changing it.
///
/// Returns the same error [`stamp`] would for an unusable file, so a frontend
/// can warn as soon as a document is opened rather than when it is saved.
pub fn inspect(pdf: &[u8]) -> Result<Info> {
    let doc = load(pdf)?;
    Ok(Info {
        pages: doc
            .get_pages()
            .values()
            .map(|&id| PageGeometry::read(&doc, id))
            .collect(),
        digitally_signed: digitally_signed(&doc),
    })
}

/// Looks up `key` in the document catalog, following references.
fn catalog_entry<'a>(doc: &'a Document, key: &[u8]) -> Option<&'a Object> {
    let entry = doc.catalog().ok()?.get(key).ok()?;
    doc.dereference(entry).ok().map(|(_, o)| o)
}

/// Whether the form says signatures exist (`/SigFlags` bit 1), or the
/// document is certified (`/Perms /DocMDP`).
fn digitally_signed(doc: &Document) -> bool {
    let sig_flags = catalog_entry(doc, b"AcroForm")
        .and_then(|f| f.as_dict().ok())
        .and_then(|f| f.get(b"SigFlags").ok())
        .and_then(|o| o.as_i64().ok())
        .unwrap_or(0);
    let certified = catalog_entry(doc, b"Perms")
        .and_then(|p| p.as_dict().ok())
        .is_some_and(|p| p.has(b"DocMDP"));
    sig_flags & 1 != 0 || certified
}

/// Removes Adobe Reader usage rights (`/Perms /UR3`).
///
/// They are a signature over the original file, so any change breaks them,
/// and Acrobat Reader then warns that the document "has been changed since it
/// was created" and disables features. Tools that modify PDFs remove them.
fn drop_usage_rights(doc: &mut Document) {
    let Ok(root) = doc.trailer.get(b"Root").and_then(Object::as_reference) else {
        return;
    };
    let Some(mut perms) = catalog_entry(doc, b"Perms")
        .and_then(|p| p.as_dict().ok())
        .cloned()
    else {
        return;
    };
    if perms.remove(b"UR3").is_none() {
        return;
    }
    // Written back as a direct copy, so a shared dictionary is never edited.
    if let Ok(catalog) = doc.get_dictionary_mut(root) {
        if perms.is_empty() {
            catalog.remove(b"Perms");
        } else {
            catalog.set("Perms", perms);
        }
    }
}

/// Loads untrusted PDF bytes the way [`stamp`] does: with bounded
/// decompression, recovery from a broken cross-reference table, and
/// user-facing errors.
pub fn load(pdf: &[u8]) -> Result<Document> {
    if !pdf.windows(5).any(|w| w == b"%PDF-") {
        return Err(Error::NotPdf);
    }
    let err = match load_checked(pdf) {
        Ok(doc) => return Ok(doc),
        // Recovering can't help with these.
        Err(e @ (Error::NotPdf | Error::Encrypted | Error::TooLarge)) => return Err(e),
        Err(e) => e,
    };
    // The cross-reference table may be wrong or missing: rebuild it the way
    // viewers do and try again. Encrypted files need the original trailer.
    if pdf.windows(8).any(|w| w == b"/Encrypt") {
        return Err(err);
    }
    match repair::append_rebuilt_xref(pdf).map(|fixed| load_checked(&fixed)) {
        Some(Ok(doc)) => Ok(doc),
        _ => Err(err),
    }
}

/// One load attempt: lenient parsing, bounded decompression, and at least one page.
fn load_checked(pdf: &[u8]) -> Result<Document> {
    let options = |strict| LoadOptions {
        strict,
        max_decompressed_size: Some(MAX_DECOMPRESSED_SIZE),
        ..Default::default()
    };
    let doc = Document::load_mem_with_options(pdf, options(false)).map_err(load_error)?;
    if doc.was_encrypted() || doc.trailer.has(b"Encrypt") {
        return Err(Error::Encrypted);
    }
    if doc.get_pages().is_empty() {
        // Lenient loading skips objects it can't decode, including streams over
        // the size limit. A strict load reports the first such failure, which
        // tells a decompression bomb apart from ordinary damage.
        return Err(
            match Document::load_mem_with_options(pdf, options(true)).map_err(load_error) {
                Err(Error::TooLarge) => Error::TooLarge,
                _ => Error::Damaged("no pages could be found".into()),
            },
        );
    }
    Ok(doc)
}

fn load_error(e: lopdf::Error) -> Error {
    use lopdf::Error as E;
    match e {
        E::Parse(ParseError::InvalidFileHeader) => Error::NotPdf,
        E::Decompress(DecompressError::MemoryLimitExceeded { .. }) => Error::TooLarge,
        E::Decryption(_) | E::InvalidPassword | E::AlreadyEncrypted => Error::Encrypted,
        other => Error::Damaged(other.to_string()),
    }
}

/// Decodes a PNG or JPEG, refusing images too large to be a signature.
fn decode_image(bytes: &[u8]) -> Result<RgbaImage> {
    let bad = |e: image::ImageError| Error::BadImage(e.to_string());
    let reader = || {
        ImageReader::new(Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|e| Error::BadImage(e.to_string()))
    };
    // The header alone gives the size, so oversized images are refused before decoding.
    let (width, height) = reader()?.into_dimensions().map_err(bad)?;
    if width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE {
        return Err(Error::ImageTooLarge { width, height });
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_SIDE);
    limits.max_image_height = Some(MAX_IMAGE_SIDE);
    let mut reader = reader()?;
    reader.limits(limits);
    Ok(reader.decode().map_err(bad)?.into_rgba8())
}

/// Returns a copy of `pdf` with each placement drawn on it. `images` are the
/// PNG or JPEG files that image items refer to by index.
pub fn stamp(pdf: &[u8], images: &[&[u8]], placements: &[Placement]) -> Result<Vec<u8>> {
    let mut doc = load(pdf)?;

    let pages = doc.get_pages();
    let mut by_page: BTreeMap<u32, Vec<&Placement>> = BTreeMap::new();
    for (index, p) in placements.iter().enumerate() {
        check_item(&p.item, index, images.len())?;
        if !pages.contains_key(&p.page) {
            return Err(Error::NoSuchPage {
                page: p.page,
                count: pages.len(),
            });
        }
        let finite = [p.x, p.y, p.width, p.height].iter().all(|v| v.is_finite());
        if !finite || p.width <= 0.0 || p.height <= 0.0 {
            return Err(Error::BadPlacement { index });
        }
        by_page.entry(p.page).or_default().push(p);
    }
    if by_page.is_empty() {
        return Ok(pdf.to_vec());
    }
    drop_usage_rights(&mut doc);

    // Each image and font used is added once and shared by all its placements.
    let mut image_ids: HashMap<usize, ObjectId> = HashMap::new();
    let mut font_ids: HashMap<Font, ObjectId> = HashMap::new();
    for p in placements {
        match p.item {
            Item::Image { image } => {
                if let Entry::Vacant(slot) = image_ids.entry(image) {
                    let decoded = decode_image(images[image])?;
                    slot.insert(add_image(&mut doc, &decoded));
                }
            }
            Item::Text { font, .. } => {
                font_ids.entry(font).or_insert_with(|| {
                    doc.add_object(dictionary! {
                        "Type" => "Font",
                        "Subtype" => "Type1",
                        "BaseFont" => font.base_font(),
                        "Encoding" => "WinAnsiEncoding",
                    })
                });
            }
        }
    }

    for (page, placements) in by_page {
        let page_id = pages[&page];
        let to_user = PageGeometry::read(&doc, page_id).display_to_user();

        // Resource names for the images and fonts used on this page.
        let mut image_names: HashMap<usize, String> = HashMap::new();
        let mut font_names: HashMap<Font, String> = HashMap::new();
        for p in &placements {
            match p.item {
                Item::Image { image } => {
                    if let Entry::Vacant(slot) = image_names.entry(image) {
                        let name = add_resource(
                            &mut doc,
                            page_id,
                            page,
                            Resource::XObject,
                            image_ids[&image],
                        )?;
                        slot.insert(name);
                    }
                }
                Item::Text { font, .. } => {
                    if let Entry::Vacant(slot) = font_names.entry(font) {
                        let name =
                            add_resource(&mut doc, page_id, page, Resource::Font, font_ids[&font])?;
                        slot.insert(name);
                    }
                }
            }
        }

        // Each item is drawn in its own q … Q, from display space.
        let mut ops = Vec::new();
        for p in placements {
            write!(ops, "q {to_user} cm ").expect("writing to a Vec cannot fail");
            match &p.item {
                Item::Image { image } => write!(
                    ops,
                    "{} 0 0 {} {} {} cm /{} Do",
                    p.width, p.height, p.x, p.y, image_names[image]
                )
                .expect("writing to a Vec cannot fail"),
                Item::Text {
                    font,
                    size,
                    color,
                    lines,
                } => {
                    let name = &font_names[font];
                    write_text(&mut ops, p, name, *font, *size, *color, lines)?;
                }
            }
            ops.extend_from_slice(b" Q\n");
        }
        wrap_contents(&mut doc, page_id, page, &ops)?;
    }

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|e| Error::Write(e.to_string()))?;
    Ok(out)
}

/// Refuses an item that can't be drawn, before anything is written.
fn check_item(item: &Item, index: usize, image_count: usize) -> Result<()> {
    match item {
        Item::Image { image } if *image >= image_count => Err(Error::NoSuchImage {
            index: *image,
            count: image_count,
        }),
        Item::Image { .. } => Ok(()),
        Item::Text {
            font, size, lines, ..
        } => {
            let positions = lines.iter().flat_map(|l| [l.x, l.y]);
            if !size.is_finite() || *size <= 0.0 || !positions.into_iter().all(f32::is_finite) {
                return Err(Error::BadPlacement { index });
            }
            for line in lines {
                text::literal(&line.text).map_err(|character| Error::UnsupportedCharacter {
                    character,
                    font: font.family(),
                })?;
            }
            Ok(())
        }
    }
}

/// Writes a text item's operators: one text object, each line placed by its
/// own text matrix, relative to the box's bottom-left corner.
fn write_text(
    ops: &mut Vec<u8>,
    p: &Placement,
    font_name: &str,
    font: Font,
    size: f32,
    [r, g, b]: [u8; 3],
    lines: &[Line],
) -> Result<()> {
    let channel = |c: u8| f32::from(c) / 255.0;
    let w = "writing to a Vec cannot fail";
    write!(
        ops,
        "1 0 0 1 {} {} cm BT /{font_name} {size} Tf {} {} {} rg",
        p.x,
        p.y,
        channel(r),
        channel(g),
        channel(b)
    )
    .expect(w);
    for line in lines.iter().filter(|l| !l.text.is_empty()) {
        let literal =
            text::literal(&line.text).map_err(|character| Error::UnsupportedCharacter {
                character,
                font: font.family(),
            })?;
        write!(ops, " 1 0 0 1 {} {} Tm ", line.x, line.y).expect(w);
        ops.extend_from_slice(&literal);
        ops.extend_from_slice(b" Tj");
    }
    ops.extend_from_slice(b" ET");
    Ok(())
}

/// Flate-compresses a new stream. Compressing in memory cannot fail in practice.
fn compressed(dict: Dictionary, content: Vec<u8>) -> Stream {
    let mut stream = Stream::new(dict, content);
    // On failure the stream is simply left uncompressed, which is still valid.
    let _ = stream.compress();
    stream
}

/// Adds the image as an RGB XObject, with an `/SMask` if it has any transparency.
fn add_image(doc: &mut Document, image: &RgbaImage) -> ObjectId {
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
        let mask = compressed(image_dict("DeviceGray"), alpha);
        dict.set("SMask", doc.add_object(mask));
    }
    doc.add_object(compressed(dict, rgb))
}

/// A kind of page resource that stamping adds.
#[derive(Clone, Copy)]
enum Resource {
    XObject,
    Font,
}

impl Resource {
    fn key(self) -> &'static str {
        match self {
            Resource::XObject => "XObject",
            Resource::Font => "Font",
        }
    }

    /// Names given to added resources: `PdfFlex0`, … for images, `PdfFlexF0`, … for fonts.
    fn prefix(self) -> &'static str {
        match self {
            Resource::XObject => "PdfFlex",
            Resource::Font => "PdfFlexF",
        }
    }
}

/// Registers `id` in the page's resources of the given kind and returns the
/// name it was given.
///
/// Resources may be inherited or shared with other pages, so the page gets its
/// own copy of the effective dictionary rather than editing a shared one.
fn add_resource(
    doc: &mut Document,
    page_id: ObjectId,
    page: u32,
    kind: Resource,
    id: ObjectId,
) -> Result<String> {
    let mut resources = geometry::inherited(doc, page_id, b"Resources")
        .and_then(|o| o.as_dict().ok())
        .cloned()
        .unwrap_or_default();
    let mut entries = resources
        .get(kind.key().as_bytes())
        .ok()
        .and_then(|o| doc.dereference(o).ok())
        .and_then(|(_, o)| o.as_dict().ok())
        .cloned()
        .unwrap_or_default();

    let name = (0..)
        .map(|i| format!("{}{i}", kind.prefix()))
        .find(|n| !entries.has(n.as_bytes()))
        .expect("an unused name exists");
    entries.set(name.as_bytes(), id);
    resources.set(kind.key(), entries);
    page_dict(doc, page_id, page)?.set("Resources", resources);
    Ok(name)
}

fn page_dict(doc: &mut Document, page_id: ObjectId, page: u32) -> Result<&mut Dictionary> {
    doc.get_dictionary_mut(page_id).map_err(|_| Error::BadPage {
        page,
        reason: "the page object is missing",
    })
}

/// Wraps the existing content in `q … Q` and appends `ops` after it.
///
/// Existing content can leave the graphics state (e.g. the transformation
/// matrix) modified; isolating it means the stamp always starts from a clean
/// state. Unbalanced content is balanced first: saves (`q`) it never restores
/// would leak their transform onto the stamp, and restores (`Q`) with nothing
/// to restore make poppler stop drawing the page altogether.
fn wrap_contents(doc: &mut Document, page_id: ObjectId, page: u32, ops: &[u8]) -> Result<()> {
    let Balance {
        missing_saves,
        unclosed_saves,
    } = save_balance(doc, page_id);
    let contents = page_dict(doc, page_id, page)?
        .get(b"Contents")
        .ok()
        .cloned();
    let existing = match contents {
        // A reference to an array of streams is flattened, and a reference to
        // anything else (normally a stream) is kept as it is.
        Some(Object::Reference(id)) => match doc.get_object(id) {
            Ok(Object::Array(items)) => items.clone(),
            Ok(_) => vec![Object::Reference(id)],
            // A dangling reference means no content, as in viewers.
            Err(_) => Vec::new(),
        },
        Some(Object::Array(items)) => items,
        // Not allowed by the spec, but seen in the wild: move it into its own object.
        Some(Object::Stream(stream)) => vec![doc.add_object(stream).into()],
        // No content: a blank page.
        None | Some(Object::Null) => Vec::new(),
        Some(_) => {
            return Err(Error::BadPage {
                page,
                reason: "its content is not a stream",
            });
        }
    };

    // The content's own extra restores use up the extra saves, so the close
    // only has to restore the content's unclosed saves and then our own.
    let open = doc.add_object(Stream::new(
        Dictionary::new(),
        b"q\n".repeat(missing_saves + 1),
    ));
    let close = doc.add_object(compressed(
        Dictionary::new(),
        [b"\n".as_slice(), &b"Q\n".repeat(unclosed_saves + 1), ops].concat(),
    ));

    let mut contents = Vec::with_capacity(existing.len() + 2);
    contents.push(open.into());
    contents.extend(existing);
    contents.push(close.into());
    page_dict(doc, page_id, page)?.set("Contents", contents);
    Ok(())
}

#[derive(Debug, Default, PartialEq)]
struct Balance {
    /// Restores (`Q`) beyond what the content itself saved.
    missing_saves: usize,
    /// Saves (`q`) still open at the end of the content.
    unclosed_saves: usize,
}

/// Counts unmatched `q` and `Q` operators in the page's content.
///
/// Content that can't be decoded counts as balanced: there is nothing better to
/// assume, and viewers will struggle with it anyway.
fn save_balance(doc: &Document, page_id: ObjectId) -> Balance {
    let Ok(bytes) = doc.get_page_content_with_limit(page_id, MAX_DECOMPRESSED_SIZE) else {
        return Balance::default();
    };
    let Ok(content) = Content::decode(&bytes) else {
        return Balance::default();
    };
    let mut balance = Balance::default();
    for op in &content.operations {
        match op.operator.as_str() {
            "q" => balance.unclosed_saves += 1,
            "Q" if balance.unclosed_saves > 0 => balance.unclosed_saves -= 1,
            "Q" => balance.missing_saves += 1,
            _ => {}
        }
    }
    balance
}
