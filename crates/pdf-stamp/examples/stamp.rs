//! Stamp a signature onto one page of a PDF.
//!
//! Usage: stamp <in.pdf> <signature.png> <out.pdf> [--page N] [--at X,Y] [--width W]
//!
//! Coordinates are display-space points from the bottom-left of the page as shown.
//! Height follows from the image's aspect ratio.

use std::{env, fs, process};

use pdf_stamp::Placement;

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let usage = "usage: stamp <in.pdf> <signature.png> <out.pdf> [--page N] [--at X,Y] [--width W]";
    let (input, signature, output) = match (args.next(), args.next(), args.next()) {
        (Some(i), Some(s), Some(o)) => (i, s, o),
        _ => return Err(usage.into()),
    };

    let (mut page, mut x, mut y, mut width) = (1u32, 40.0f32, 40.0f32, 150.0f32);
    while let Some(flag) = args.next() {
        let value = args.next().ok_or(usage)?;
        match flag.as_str() {
            "--page" => page = value.parse()?,
            "--at" => {
                let (a, b) = value.split_once(',').ok_or("--at expects X,Y")?;
                (x, y) = (a.trim().parse()?, b.trim().parse()?);
            }
            "--width" => width = value.parse()?,
            _ => return Err(usage.into()),
        }
    }

    let pdf = fs::read(&input)?;
    let sig = fs::read(&signature)?;
    let img = image::load_from_memory(&sig)?;
    let height = width * img.height() as f32 / img.width() as f32;

    let out = pdf_stamp::stamp(
        &pdf,
        &[&sig],
        &[Placement {
            image: 0,
            page,
            x,
            y,
            width,
            height,
        }],
    )?;
    fs::write(&output, out)?;
    println!("wrote {output} (page {page}, {width}x{height} pt at {x},{y})");
    Ok(())
}
