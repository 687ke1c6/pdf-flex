//! Rebuilds a lost or wrong cross-reference table, as PDF viewers do.
//!
//! lopdf reconstructs the table only when it can't be parsed at all. It gives up
//! when the table parses but points at the wrong offsets, or when there is no
//! trailer to name the document catalog. pdf.js, poppler and Acrobat all recover
//! from both by scanning the file for objects, so users never notice the damage.
//! This module does the same: it scans for `N G obj` headers, finds the catalog,
//! and appends a fresh table and trailer that lopdf then reads instead.

use std::fmt::Write;

/// Returns `pdf` with a rebuilt cross-reference table appended, or `None` if no
/// objects or no catalog could be found.
pub fn append_rebuilt_xref(pdf: &[u8]) -> Option<Vec<u8>> {
    // Offsets count from the header, which is where lopdf starts reading.
    let start = find(pdf, b"%PDF-", 0)?;
    let body = &pdf[start..];

    let mut offsets: Vec<Option<(usize, u16)>> = Vec::new();
    let mut root = None;
    for (offset, number, generation) in object_headers(body) {
        let slot = number as usize;
        if slot >= offsets.len() {
            offsets.resize(slot + 1, None);
        }
        // Incremental updates append, so later copies win.
        offsets[slot] = Some((offset, generation));
        if is_catalog(body, offset) {
            root = Some((number, generation));
        }
    }
    let (root_number, root_generation) = root?;

    let mut table = String::new();
    let xref_at = body.len() + 1;
    let _ = write!(table, "\nxref\n0 {}\n0000000000 65535 f \n", offsets.len());
    for entry in &offsets[1..] {
        let _ = match entry {
            Some((offset, generation)) => writeln!(table, "{offset:010} {generation:05} n "),
            None => writeln!(table, "0000000000 65535 f "),
        };
    }
    let _ = write!(
        table,
        "trailer\n<< /Size {} /Root {root_number} {root_generation} R >>\nstartxref\n{xref_at}\n%%EOF\n",
        offsets.len()
    );
    Some([body, table.as_bytes()].concat())
}

/// Every `N G obj` header at the start of a line, skipping stream data so
/// that bytes inside a stream are never mistaken for a header.
fn object_headers(body: &[u8]) -> Vec<(usize, u32, u16)> {
    const MAX_OBJECTS: u32 = 8_000_000;
    let mut found = Vec::new();
    let mut pos = 0;
    while pos < body.len() {
        let line_start = pos == 0 || matches!(body[pos - 1], b'\n' | b'\r');
        if line_start && let Some((number, generation, len)) = parse_header(&body[pos..]) {
            if number > 0 && number < MAX_OBJECTS {
                found.push((pos, number, generation));
            }
            pos += len;
            continue;
        }
        if body[pos..].starts_with(b"stream")
            && matches!(body.get(pos + 6), Some(b'\r' | b'\n'))
            && !body[..pos].ends_with(b"end")
        {
            match find(body, b"endstream", pos + 6) {
                Some(end) => pos = end + 9,
                None => break,
            }
            continue;
        }
        pos += 1;
    }
    found
}

/// Parses `N G obj` (with optional leading blanks), returning the numbers and the length consumed.
fn parse_header(s: &[u8]) -> Option<(u32, u16, usize)> {
    let mut i = s.iter().take_while(|b| matches!(b, b' ' | b'\t')).count();
    let number = digits(s, &mut i)?;
    blanks(s, &mut i)?;
    let generation = digits(s, &mut i)?;
    blanks(s, &mut i)?;
    if !s[i..].starts_with(b"obj") {
        return None;
    }
    i += 3;
    // "obj" must end the token: "objx" is not a header.
    if s.get(i).is_some_and(|b| b.is_ascii_alphanumeric()) {
        return None;
    }
    Some((number.try_into().ok()?, generation.try_into().ok()?, i))
}

fn digits(s: &[u8], i: &mut usize) -> Option<u64> {
    let n = s[*i..]
        .iter()
        .take(10)
        .take_while(|b| b.is_ascii_digit())
        .count();
    if n == 0 {
        return None;
    }
    let value = std::str::from_utf8(&s[*i..*i + n]).ok()?.parse().ok()?;
    *i += n;
    Some(value)
}

fn blanks(s: &[u8], i: &mut usize) -> Option<()> {
    let n = s[*i..]
        .iter()
        .take_while(|b| b.is_ascii_whitespace())
        .count();
    *i += n;
    (n > 0).then_some(())
}

/// Whether the object starting at `offset` is a dictionary with `/Type /Catalog`.
fn is_catalog(body: &[u8], offset: usize) -> bool {
    // Look only at the object's own text, up to its end or the next stream.
    let end = [find(body, b"endobj", offset), find(body, b"stream", offset)]
        .into_iter()
        .flatten()
        .min()
        .unwrap_or(body.len());
    let text = &body[offset..end];
    let Some(at) = find(text, b"/Type", 0) else {
        return false;
    };
    let rest = &text[at + 5..];
    let skip = rest.iter().take_while(|b| b.is_ascii_whitespace()).count();
    let rest = &rest[skip..];
    rest.starts_with(b"/Catalog") && !rest.get(8).is_some_and(|b| b.is_ascii_alphanumeric())
}

fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    haystack
        .get(from..)?
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|p| p + from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_headers() {
        assert_eq!(parse_header(b"12 0 obj\n"), Some((12, 0, 8)));
        assert_eq!(parse_header(b"  3 1 obj<<"), Some((3, 1, 9)));
        assert_eq!(parse_header(b"3 0 objx"), None);
        assert_eq!(parse_header(b"3 obj"), None);
    }

    #[test]
    fn skips_headers_inside_streams() {
        let body = b"%PDF-1.7\n1 0 obj\n<</Length 9>>stream\n2 0 obj\nendstream\nendobj\n3 0 obj\n<<>>\nendobj\n";
        let numbers: Vec<u32> = object_headers(body).iter().map(|h| h.1).collect();
        assert_eq!(numbers, [1, 3]);
    }

    #[test]
    fn finds_the_catalog() {
        let pdf = b"%PDF-1.7\n1 0 obj\n<</Type /Pages>>\nendobj\n2 0 obj\n<</Type/Catalog/Pages 1 0 R>>\nendobj\n";
        let fixed = append_rebuilt_xref(pdf).unwrap();
        let tail = String::from_utf8_lossy(&fixed[pdf.len()..]);
        assert!(tail.contains("/Root 2 0 R"), "{tail}");
        assert!(tail.contains("0000000009 00000 n"), "{tail}");
    }

    #[test]
    fn needs_a_catalog() {
        assert!(append_rebuilt_xref(b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n").is_none());
        assert!(append_rebuilt_xref(b"no header").is_none());
    }
}
