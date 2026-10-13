//! Stamp a line (or lines) of text onto one page of a PDF.
//!
//! Usage: stamp_text <in.pdf> <text> <out.pdf> [--page N] [--at X,Y] [--size S] [--font NAME] [--color RRGGBB]
//!
//! `--at` is where the first line's baseline starts, in display-space points
//! from the bottom-left of the page as shown. `\n` in the text starts a new
//! line, 1.2 × the size below. `--font` takes a standard font's PostScript
//! name, e.g. Helvetica (the default), Times-Bold or Courier-Oblique.

use std::{env, fs, process};

use pdf_stamp::{Font, Item, Line, Placement};

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let usage = "usage: stamp_text <in.pdf> <text> <out.pdf> [--page N] [--at X,Y] [--size S] [--font NAME] [--color RRGGBB]";
    let (input, text, output) = match (args.next(), args.next(), args.next()) {
        (Some(i), Some(t), Some(o)) => (i, t, o),
        _ => return Err(usage.into()),
    };

    let (mut page, mut x, mut y, mut size) = (1u32, 40.0f32, 40.0f32, 12.0f32);
    let (mut font, mut color) = (Font::Helvetica, [0u8; 3]);
    while let Some(flag) = args.next() {
        let value = args.next().ok_or(usage)?;
        match flag.as_str() {
            "--page" => page = value.parse()?,
            "--at" => {
                let (a, b) = value.split_once(',').ok_or("--at expects X,Y")?;
                (x, y) = (a.trim().parse()?, b.trim().parse()?);
            }
            "--size" => size = value.parse()?,
            "--font" => font = Font::from_base_font(&value).ok_or("unknown font")?,
            "--color" => {
                let rgb = u32::from_str_radix(value.trim_start_matches('#'), 16)?;
                color = [(rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8];
            }
            _ => return Err(usage.into()),
        }
    }

    // The box only positions the text: its bottom-left is the last baseline.
    let texts: Vec<&str> = text.split("\\n").collect();
    let leading = size * 1.2;
    let count = texts.len();
    let lines = texts
        .iter()
        .enumerate()
        .map(|(i, t)| Line {
            text: t.to_string(),
            x: 0.0,
            y: (count - 1 - i) as f32 * leading,
        })
        .collect();
    let height = count as f32 * leading;
    let placement = Placement {
        item: Item::Text {
            font,
            size,
            color,
            lines,
        },
        page,
        x,
        y: y - height + leading,
        // Wide enough for any line; the box isn't drawn.
        width: size * text.len() as f32,
        height,
    };

    let pdf = fs::read(&input)?;
    fs::write(&output, pdf_stamp::stamp(&pdf, &[], &[placement])?)?;
    println!(
        "wrote {output} (page {page}, {count} line(s) of {} {size} pt at {x},{y})",
        font.base_font()
    );
    Ok(())
}
