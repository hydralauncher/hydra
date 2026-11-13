//! Decode a short looping clip into horizontal strips, for elements that show
//! a video through `object-fit: cover` in a thin band (the classics hero's
//! rainbow uses tv-effect.mp4 this way). Every frame is decoded once and only
//! the visible rows are kept, scaled to the band's pixel size.

use ffmpeg_next as ff;
use std::path::Path;

/// One band: the source rows it shows (fractional, `start..end`) and the
/// output size in pixels.
#[derive(Clone, Copy, Debug)]
pub struct StripSpec {
    pub row_start: f32,
    pub row_end: f32,
    pub width: u32,
    pub height: u32,
}

impl StripSpec {
    /// `object-fit: cover` of a `src_w`×`src_h` video in a `band_w`×`band_h`
    /// box (CSS px), rendered at `scale` device pixels per CSS px.
    pub fn cover(src_w: u32, src_h: u32, band_w: f32, band_h: f32, scale: f32) -> StripSpec {
        let fit = (band_w / src_w as f32).max(band_h / src_h as f32);
        let rows = band_h / fit;
        let start = (src_h as f32 - rows) / 2.0;
        StripSpec {
            row_start: start,
            row_end: start + rows,
            width: (band_w * scale).ceil().max(1.0) as u32,
            height: (band_h * scale).ceil().max(1.0) as u32,
        }
    }
}

/// RGB frames per spec: `frames[spec][frame]`, `width * height * 3` bytes each,
/// plus the frame rate.
pub struct Strips {
    pub frames: Vec<Vec<Vec<u8>>>,
    pub fps: f64,
}

/// Area-average the rows `spec.row_start..row_end` of an RGB24 image into the
/// spec's size.
fn sample(src: &[u8], stride: usize, src_w: usize, spec: &StripSpec) -> Vec<u8> {
    let (w, h) = (spec.width as usize, spec.height as usize);
    let mut out = vec![0u8; w * h * 3];
    let x_step = src_w as f32 / w as f32;
    let y_step = (spec.row_end - spec.row_start) / h as f32;
    for oy in 0..h {
        let y0 = spec.row_start + oy as f32 * y_step;
        let (ya, yb) = (
            y0.floor() as usize,
            ((y0 + y_step).ceil() as usize).max(y0.floor() as usize + 1),
        );
        for ox in 0..w {
            let x0 = ox as f32 * x_step;
            let (xa, xb) = (
                x0.floor() as usize,
                ((x0 + x_step).ceil() as usize)
                    .max(x0.floor() as usize + 1)
                    .min(src_w),
            );
            let mut sum = [0u32; 3];
            let mut n = 0u32;
            for y in ya..yb {
                let row = &src[y * stride..];
                for x in xa..xb {
                    for c in 0..3 {
                        sum[c] += row[x * 3 + c] as u32;
                    }
                    n += 1;
                }
            }
            let o = (oy * w + ox) * 3;
            for c in 0..3 {
                out[o + c] = (sum[c] / n.max(1)) as u8;
            }
        }
    }
    out
}

/// Decode every frame of `path` (software decode, RGB24) and cut the strips.
/// `specs_for(width, height)` builds the specs once the video size is known.
pub fn decode(
    path: &Path,
    specs_for: impl Fn(u32, u32) -> Vec<StripSpec>,
) -> Result<Strips, String> {
    ff::init().map_err(|e| e.to_string())?;
    let mut input = ff::format::input(path).map_err(|e| e.to_string())?;
    let stream = input
        .streams()
        .best(ff::media::Type::Video)
        .ok_or("no video stream")?;
    let index = stream.index();
    let rate = stream.avg_frame_rate();
    let fps = if rate.denominator() != 0 {
        rate.numerator() as f64 / rate.denominator() as f64
    } else {
        30.0
    };
    let mut decoder = ff::codec::context::Context::from_parameters(stream.parameters())
        .map_err(|e| e.to_string())?
        .decoder()
        .video()
        .map_err(|e| e.to_string())?;
    let (width, height) = (decoder.width(), decoder.height());
    let specs = specs_for(width, height);
    for spec in &specs {
        if spec.row_start < 0.0 || spec.row_end > height as f32 {
            return Err(format!(
                "strip rows {spec:?} outside a {width}x{height} video"
            ));
        }
    }
    let mut scaler = ff::software::scaling::Context::get(
        decoder.format(),
        width,
        height,
        ff::format::Pixel::RGB24,
        width,
        height,
        ff::software::scaling::Flags::BILINEAR,
    )
    .map_err(|e| e.to_string())?;
    let mut frames: Vec<Vec<Vec<u8>>> = vec![Vec::new(); specs.len()];
    let mut decoded = ff::frame::Video::empty();
    let mut rgb = ff::frame::Video::empty();
    let mut take = |decoder: &mut ff::decoder::Video, frames: &mut Vec<Vec<Vec<u8>>>| {
        while decoder.receive_frame(&mut decoded).is_ok() {
            if scaler.run(&decoded, &mut rgb).is_err() {
                continue;
            }
            let stride = rgb.stride(0);
            for (spec, out) in specs.iter().zip(frames.iter_mut()) {
                out.push(sample(rgb.data(0), stride, width as usize, spec));
            }
        }
    };
    for (stream, packet) in input.packets() {
        if stream.index() == index && decoder.send_packet(&packet).is_ok() {
            take(&mut decoder, &mut frames);
        }
    }
    let _ = decoder.send_eof();
    take(&mut decoder, &mut frames);
    if frames.first().is_none_or(Vec::is_empty) {
        return Err("no frames decoded".into());
    }
    Ok(Strips { frames, fps })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cover_rows() {
        // tv-effect.mp4 (1164x720) in a 382x14.405 band: the middle ~44 rows.
        let spec = StripSpec::cover(1164, 720, 382.0, 14.405, 1.0);
        assert!((spec.row_end - spec.row_start - 43.89).abs() < 0.05);
        assert!((spec.row_start + spec.row_end - 720.0).abs() < 0.01);
        assert_eq!((spec.width, spec.height), (382, 15));
    }
}
