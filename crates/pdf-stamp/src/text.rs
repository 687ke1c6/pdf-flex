//! Text in the standard PDF fonts: font names and WinAnsi encoding.
//!
//! The 12 standard text fonts (Helvetica, Times and Courier, each regular, bold,
//! italic and bold italic) are built into every PDF viewer, so they are never
//! embedded. With `/WinAnsiEncoding` they cover Western European Latin text;
//! anything else is refused rather than silently replaced.

/// A standard PDF font. Serialised as its PostScript name, e.g. `"Helvetica-Bold"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Deserialize))]
pub enum Font {
    #[cfg_attr(feature = "serde", serde(rename = "Helvetica"))]
    Helvetica,
    #[cfg_attr(feature = "serde", serde(rename = "Helvetica-Bold"))]
    HelveticaBold,
    #[cfg_attr(feature = "serde", serde(rename = "Helvetica-Oblique"))]
    HelveticaOblique,
    #[cfg_attr(feature = "serde", serde(rename = "Helvetica-BoldOblique"))]
    HelveticaBoldOblique,
    #[cfg_attr(feature = "serde", serde(rename = "Times-Roman"))]
    TimesRoman,
    #[cfg_attr(feature = "serde", serde(rename = "Times-Bold"))]
    TimesBold,
    #[cfg_attr(feature = "serde", serde(rename = "Times-Italic"))]
    TimesItalic,
    #[cfg_attr(feature = "serde", serde(rename = "Times-BoldItalic"))]
    TimesBoldItalic,
    #[cfg_attr(feature = "serde", serde(rename = "Courier"))]
    Courier,
    #[cfg_attr(feature = "serde", serde(rename = "Courier-Bold"))]
    CourierBold,
    #[cfg_attr(feature = "serde", serde(rename = "Courier-Oblique"))]
    CourierOblique,
    #[cfg_attr(feature = "serde", serde(rename = "Courier-BoldOblique"))]
    CourierBoldOblique,
}

impl Font {
    pub const ALL: [Font; 12] = {
        use Font::*;
        [
            Helvetica,
            HelveticaBold,
            HelveticaOblique,
            HelveticaBoldOblique,
            TimesRoman,
            TimesBold,
            TimesItalic,
            TimesBoldItalic,
            Courier,
            CourierBold,
            CourierOblique,
            CourierBoldOblique,
        ]
    };

    /// The font with this PostScript name, e.g. `"Times-Bold"`.
    pub fn from_base_font(name: &str) -> Option<Font> {
        Font::ALL.into_iter().find(|f| f.base_font() == name)
    }

    /// The PostScript name, used as the font's `/BaseFont`.
    pub fn base_font(self) -> &'static str {
        use Font::*;
        match self {
            Helvetica => "Helvetica",
            HelveticaBold => "Helvetica-Bold",
            HelveticaOblique => "Helvetica-Oblique",
            HelveticaBoldOblique => "Helvetica-BoldOblique",
            TimesRoman => "Times-Roman",
            TimesBold => "Times-Bold",
            TimesItalic => "Times-Italic",
            TimesBoldItalic => "Times-BoldItalic",
            Courier => "Courier",
            CourierBold => "Courier-Bold",
            CourierOblique => "Courier-Oblique",
            CourierBoldOblique => "Courier-BoldOblique",
        }
    }

    /// The family name users know it by.
    pub fn family(self) -> &'static str {
        use Font::*;
        match self {
            Helvetica | HelveticaBold | HelveticaOblique | HelveticaBoldOblique => "Helvetica",
            TimesRoman | TimesBold | TimesItalic | TimesBoldItalic => "Times",
            Courier | CourierBold | CourierOblique | CourierBoldOblique => "Courier",
        }
    }
}

/// One line of text and where its baseline starts, in points from the
/// bottom-left corner of the placement's box.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Deserialize))]
pub struct Line {
    pub text: String,
    pub x: f32,
    pub y: f32,
}

/// The WinAnsiEncoding byte for `c`, if it has one.
///
/// Printable ASCII and Latin-1 map to themselves; 0x80–0x9F hold the extra
/// Windows-1252 characters (€, curly quotes, dashes, …). Controls have no byte.
pub fn winansi(c: char) -> Option<u8> {
    let byte = match c {
        ' '..='~' | '\u{A0}'..='\u{FF}' => c as u8,
        '€' => 0x80,
        '‚' => 0x82,
        'ƒ' => 0x83,
        '„' => 0x84,
        '…' => 0x85,
        '†' => 0x86,
        '‡' => 0x87,
        'ˆ' => 0x88,
        '‰' => 0x89,
        'Š' => 0x8A,
        '‹' => 0x8B,
        'Œ' => 0x8C,
        'Ž' => 0x8E,
        '‘' => 0x91,
        '’' => 0x92,
        '“' => 0x93,
        '”' => 0x94,
        '•' => 0x95,
        '–' => 0x96,
        '—' => 0x97,
        '˜' => 0x98,
        '™' => 0x99,
        'š' => 0x9A,
        '›' => 0x9B,
        'œ' => 0x9C,
        'ž' => 0x9E,
        'Ÿ' => 0x9F,
        _ => return None,
    };
    Some(byte)
}

/// `text` as a PDF literal string, parentheses included, or the first
/// character that WinAnsiEncoding can't represent.
pub fn literal(text: &str) -> Result<Vec<u8>, char> {
    let mut out = Vec::with_capacity(text.len() + 2);
    out.push(b'(');
    for c in text.chars() {
        let byte = winansi(c).ok_or(c)?;
        if matches!(byte, b'(' | b')' | b'\\') {
            out.push(b'\\');
        }
        out.push(byte);
    }
    out.push(b')');
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_and_latin1_map_to_themselves() {
        assert_eq!(winansi('A'), Some(0x41));
        assert_eq!(winansi('é'), Some(0xE9));
        assert_eq!(winansi('ÿ'), Some(0xFF));
        assert_eq!(winansi('\u{A0}'), Some(0xA0));
    }

    #[test]
    fn windows_extras_use_0x80_to_0x9f() {
        assert_eq!(winansi('€'), Some(0x80));
        assert_eq!(winansi('“'), Some(0x93));
        assert_eq!(winansi('—'), Some(0x97));
        assert_eq!(winansi('Ÿ'), Some(0x9F));
    }

    #[test]
    fn controls_and_other_scripts_have_no_byte() {
        for c in ['\t', '\n', '\u{7F}', '\u{81}', 'ł', 'Ω', '中', '😀'] {
            assert_eq!(winansi(c), None, "{c:?}");
        }
    }

    #[test]
    fn fonts_are_found_by_postscript_name() {
        for font in Font::ALL {
            assert_eq!(Font::from_base_font(font.base_font()), Some(font));
        }
        assert_eq!(Font::from_base_font("Arial"), None);
    }

    #[test]
    fn literal_escapes_delimiters_and_backslash() {
        assert_eq!(literal(r"a(b)\c").unwrap(), br"(a\(b\)\\c)");
        assert_eq!(literal("").unwrap(), b"()");
        assert_eq!(literal("5 €").unwrap(), b"(5 \x80)");
    }

    #[test]
    fn literal_reports_the_first_unsupported_character() {
        assert_eq!(literal("Łódź"), Err('Ł'));
    }
}
