# Test corpus

`tests/corpus.rs` stamps every PDF here and checks the result; it lists what
each file should do. `crates/pdf-stamp-wasm/corpus.ts` checks that pdf.js and
the WASM build agree on each file's pages.

## real/

Unmodified downloads. All are works of the US federal government, which are in
the public domain (17 U.S.C. § 105).

| File | What it exercises | Source |
|---|---|---|
| `irs-w9-xfa-form.pdf` | AcroForm + XFA form (Adobe Designer), object streams | IRS Form W-9 (Rev. March 2024), https://www.irs.gov/pub/irs-pdf/fw9.pdf |
| `word-pdfmaker-tagged.pdf` | Word export (Acrobat PDFMaker for Word), tagged PDF | House Appropriations Committee, FY25 THUD Member Day instructions, https://appropriations.house.gov/sites/evo-subsites/republicans-appropriations.house.gov/files/evo-media-document/fy25-transportation-housing-and-urban-development-and-related-agencies-member-day-instructions.pdf |
| `macos-preview-incremental.pdf` | Written by LibreOffice, then edited and saved in macOS Preview as an incremental update; embedded signature images | Letter from members of Congress to the Department of Education, 27 Feb 2025, https://larson.house.gov/sites/evo-subsites/larson.house.gov/files/evo-media-document/rep-lee-letter-to-ed-ocr-re-dear-colleague-letter.pdf |
| `acrobat-scan-jpx.pdf` | Scanned pages (Acrobat image conversion), JPEG 2000 images, non-standard page size | Eisenhower Library, farewell address press release, 17 Jan 1961, https://www.eisenhowerlibrary.gov/sites/default/files/research/online-documents/farewell-address/1961-01-17-press-release.pdf |

## generated/

Written by `just corpus` (`examples/corpus.rs`), which uses qpdf for the
object-stream and encrypted variants. Each file reproduces one real-world
oddity: broken or missing cross-reference tables, junk before the header,
unbalanced graphics state, missing MediaBox, `/UserUnit`, real-number
`/Rotate`, unusual `/Contents`, shared resources, deep page trees, PDF 2.0,
encryption, a decompression bomb, and files that aren't PDFs at all.
