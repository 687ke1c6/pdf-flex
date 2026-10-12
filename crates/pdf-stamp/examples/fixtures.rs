//! Writes the test PDFs, a sample signature, and stamped copies to `out/`.
//!
//! Open `out/stamped/*.pdf`: on every page the signature should fill the dashed
//! blue box, upright, with no red "OUTSIDE CROP" text visible.

use std::fs;

use pdf_stamp::testpdf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    fs::create_dir_all("out/fixtures")?;
    fs::create_dir_all("out/stamped")?;

    let sig = testpdf::sample_signature_png();
    fs::write("out/sig.png", &sig)?;
    let img = image::load_from_memory(&sig)?;
    let aspect = img.width() as f32 / img.height() as f32;

    for fixture in testpdf::fixtures() {
        let target = fixture.target(aspect);
        let pdf = testpdf::build(&fixture, &target);
        fs::write(format!("out/fixtures/{}.pdf", fixture.name), &pdf)?;
        let stamped = pdf_stamp::stamp(&pdf, &[&sig], &[target])?;
        fs::write(format!("out/stamped/{}.pdf", fixture.name), stamped)?;
        println!("{}", fixture.name);
    }
    Ok(())
}
