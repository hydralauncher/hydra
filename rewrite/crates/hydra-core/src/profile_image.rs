//! events/profile: getProfileImageMetadata, cropProfileImage and
//! processProfileImage (native addon), with the `image` crate instead of
//! sharp.
//!
//! Differences from sharp: static crops are written as lossless WebP (sharp:
//! lossy quality 90), and animated crops as animated GIF, because the image
//! crate can't encode animated WebP.

use std::path::{Path, PathBuf};

use image::codecs::gif::{GifDecoder, GifEncoder, Repeat};
use image::codecs::png::PngDecoder;
use image::codecs::webp::WebPDecoder;
use image::imageops::FilterType;
use image::{AnimationDecoder, DynamicImage, Frame, ImageFormat, ImageReader, RgbaImage};

const HEADER_BYTES: usize = 256 * 1024;

/// ProfileImageMetadata
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Metadata {
    pub mime_type: Option<String>,
    pub is_animated: bool,
}

/// The crop rectangle in source pixels (in the rotated orientation the user
/// sees), the output size, and the clockwise rotation (0/90/180/270).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Crop {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
    pub output_width: u32,
    pub output_height: u32,
    pub rotation: i32,
}

fn mime_by_extension(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "apng" => "image/apng",
        "gif" => "image/gif",
        "png" => "image/png",
        "webp" => "image/webp",
        "jpg" | "jpeg" => "image/jpeg",
        _ => return None,
    })
}

fn read_header(path: &Path) -> std::io::Result<Vec<u8>> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut buffer = vec![0u8; HEADER_BYTES];
    let mut read = 0;
    while read < buffer.len() {
        let n = file.read(&mut buffer[read..])?;
        if n == 0 {
            break;
        }
        read += n;
    }
    buffer.truncate(read);
    Ok(buffer)
}

fn skip_gif_sub_blocks(buffer: &[u8], mut offset: usize) -> Option<usize> {
    while offset < buffer.len() {
        let size = buffer[offset] as usize;
        offset += 1;
        if size == 0 {
            return Some(offset);
        }
        offset += size;
    }
    None
}

/// isGifAnimated: more than one image descriptor.
pub fn gif_is_animated(buffer: &[u8]) -> Option<bool> {
    if buffer.len() < 13 {
        return None;
    }
    let mut frames = 0;
    let mut offset = 13;
    let packed = buffer[10];
    if packed & 0x80 != 0 {
        offset += 3 * (1 << ((packed & 0x07) + 1));
    }
    while offset < buffer.len() {
        let marker = buffer[offset];
        offset += 1;
        match marker {
            0x2c => {
                frames += 1;
                if frames > 1 {
                    return Some(true);
                }
                if offset + 9 > buffer.len() {
                    return None;
                }
                let image_packed = buffer[offset + 8];
                offset += 9;
                if image_packed & 0x80 != 0 {
                    offset += 3 * (1 << ((image_packed & 0x07) + 1));
                }
                offset = skip_gif_sub_blocks(buffer, offset + 1)?;
            }
            0x21 => offset = skip_gif_sub_blocks(buffer, offset + 1)?,
            0x3b => return Some(false),
            _ => return None,
        }
    }
    None
}

/// isWebpAnimated: the VP8X animation flag, or an ANIM chunk.
pub fn webp_is_animated(buffer: &[u8]) -> Option<bool> {
    if buffer.len() < 21 {
        return None;
    }
    if &buffer[0..4] != b"RIFF" || &buffer[8..12] != b"WEBP" {
        return Some(false);
    }
    let mut offset = 12;
    while offset + 8 <= buffer.len() {
        let kind = &buffer[offset..offset + 4];
        let size = u32::from_le_bytes(buffer[offset + 4..offset + 8].try_into().ok()?) as usize;
        let data = offset + 8;
        if kind == b"VP8X" {
            return Some(data < buffer.len() && buffer[data] & 0x02 != 0);
        }
        if kind == b"ANIM" {
            return Some(true);
        }
        offset = data + size + (size % 2);
    }
    None
}

/// isPngAnimated: an acTL chunk before the first IDAT.
pub fn png_is_animated(buffer: &[u8]) -> Option<bool> {
    const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if buffer.len() < SIGNATURE.len() + 12 {
        return None;
    }
    if buffer[..8] != SIGNATURE {
        return Some(false);
    }
    let mut offset = 8;
    while offset + 12 <= buffer.len() {
        let size = u32::from_be_bytes(buffer[offset..offset + 4].try_into().ok()?) as usize;
        let kind = &buffer[offset + 4..offset + 8];
        if kind == b"acTL" {
            return Some(true);
        }
        if kind == b"IDAT" || kind == b"IEND" {
            return Some(false);
        }
        offset += 12 + size;
    }
    None
}

/// getProfileImageMetadata. A file that can't be read counts as animated,
/// like the Electron fallback.
pub fn metadata(path: &Path) -> Metadata {
    let header = read_header(path).unwrap_or_default();
    let mime = crate::profile::sniff_mime(&header).or_else(|| mime_by_extension(path));
    let can_animate = matches!(
        mime,
        Some("image/gif" | "image/apng" | "image/webp" | "image/png")
    );
    if !can_animate {
        return Metadata {
            mime_type: mime.map(str::to_string),
            is_animated: false,
        };
    }
    let animated = match mime {
        Some("image/gif") => gif_is_animated(&header),
        Some("image/webp") => webp_is_animated(&header),
        _ => png_is_animated(&header),
    };
    Metadata {
        mime_type: mime.map(str::to_string),
        is_animated: animated.unwrap_or(true),
    }
}

fn temp_path(suffix: &str) -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    std::env::temp_dir().join(format!("hydra-temp-{stamp}-{suffix}"))
}

fn rotate(image: DynamicImage, rotation: i32) -> DynamicImage {
    match rotation {
        90 => image.rotate90(),
        180 => image.rotate180(),
        270 => image.rotate270(),
        _ => image,
    }
}

/// The extract region, clamped to the rotated frame like cropProfileImage.
fn region(crop: &Crop, frame_width: u32, frame_height: u32) -> (u32, u32, u32, u32) {
    let clamp = |v: f64, lo: f64, hi: f64| v.max(lo).min(hi);
    let left = clamp(crop.left.round(), 0.0, frame_width as f64 - 1.0);
    let top = clamp(crop.top.round(), 0.0, frame_height as f64 - 1.0);
    let width = clamp(crop.width.round(), 1.0, frame_width as f64 - left);
    let height = clamp(crop.height.round(), 1.0, frame_height as f64 - top);
    (left as u32, top as u32, width as u32, height as u32)
}

fn crop_frame(image: DynamicImage, crop: &Crop) -> RgbaImage {
    let rotation = crop.rotation.rem_euclid(360);
    let rotated = rotate(image, rotation);
    let (left, top, width, height) = region(crop, rotated.width(), rotated.height());
    rotated
        .crop_imm(left, top, width, height)
        .resize_exact(crop.output_width, crop.output_height, FilterType::Lanczos3)
        .to_rgba8()
}

fn animation_frames(path: &Path, mime: Option<&str>) -> Option<Vec<Frame>> {
    let file = std::io::BufReader::new(std::fs::File::open(path).ok()?);
    let frames = match mime {
        Some("image/gif") => GifDecoder::new(file).ok()?.into_frames().collect_frames(),
        Some("image/webp") => WebPDecoder::new(file).ok()?.into_frames().collect_frames(),
        _ => PngDecoder::new(file)
            .ok()?
            .apng()
            .ok()?
            .into_frames()
            .collect_frames(),
    };
    frames.ok().filter(|f| f.len() > 1)
}

/// cropProfileImage: rotate, crop, resize to the output size. Animated
/// sources keep their frames (written as GIF); others become WebP.
pub fn crop(source: &Path, crop: &Crop) -> Result<PathBuf, String> {
    let meta = metadata(source);
    if meta.is_animated
        && let Some(frames) = animation_frames(source, meta.mime_type.as_deref())
    {
        let output = temp_path("profile-crop.gif");
        let file = std::fs::File::create(&output).map_err(|e| e.to_string())?;
        let mut encoder = GifEncoder::new_with_speed(file, 10);
        encoder
            .set_repeat(Repeat::Infinite)
            .map_err(|e| e.to_string())?;
        let cropped = frames.into_iter().map(|frame| {
            let delay = frame.delay();
            let image = DynamicImage::ImageRgba8(frame.into_buffer());
            Frame::from_parts(crop_frame(image, crop), 0, 0, delay)
        });
        encoder.encode_frames(cropped).map_err(|e| e.to_string())?;
        return Ok(output);
    }
    let image = ImageReader::open(source)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;
    let output = temp_path("profile-crop.webp");
    crop_frame(image, crop)
        .save_with_format(&output, ImageFormat::WebP)
        .map_err(|e| e.to_string())?;
    Ok(output)
}

/// processProfileImage(path, "webp"): an animated image becomes its first
/// frame as WebP (avatars of non-subscribers); others pass through.
pub fn process(source: &Path) -> Result<PathBuf, String> {
    if !metadata(source).is_animated {
        return Ok(source.to_path_buf());
    }
    let image = ImageReader::open(source)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;
    let output = temp_path("profile.webp");
    image
        .save_with_format(&output, ImageFormat::WebP)
        .map_err(|e| e.to_string())?;
    Ok(output)
}

/// fitImageWithinBounds (image-crop-utils.ts)
pub fn fit_within(source: (f64, f64), bounds: (f64, f64)) -> (f64, f64) {
    if source.0 <= 0.0 || source.1 <= 0.0 || bounds.0 <= 0.0 || bounds.1 <= 0.0 {
        return bounds;
    }
    let source_ratio = source.0 / source.1;
    let bounds_ratio = bounds.0 / bounds.1;
    if source_ratio >= bounds_ratio {
        (bounds.0, (bounds.0 / source_ratio).round().max(1.0))
    } else {
        ((bounds.1 * source_ratio).round().max(1.0), bounds.1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_static_and_animated_gifs() {
        let dir = std::env::temp_dir().join(format!("hydra-crop-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("anim.gif");
        {
            let file = std::fs::File::create(&path).unwrap();
            let mut encoder = GifEncoder::new(file);
            let frames = (0..3).map(|i| {
                let img = RgbaImage::from_pixel(8, 6, image::Rgba([i * 80, 0, 0, 255]));
                Frame::new(img)
            });
            encoder.encode_frames(frames).unwrap();
        }
        let meta = metadata(&path);
        assert_eq!(meta.mime_type.as_deref(), Some("image/gif"));
        assert!(meta.is_animated);

        let output = crop(
            &path,
            &Crop {
                left: 2.0,
                top: 1.0,
                width: 4.0,
                height: 4.0,
                output_width: 16,
                output_height: 16,
                rotation: 90,
            },
        )
        .unwrap();
        let frames = animation_frames(&output, Some("image/gif")).unwrap();
        assert_eq!(frames.len(), 3);
        assert_eq!(frames[0].buffer().dimensions(), (16, 16));

        let still = dir.join("still.png");
        RgbaImage::from_pixel(20, 10, image::Rgba([0, 255, 0, 255]))
            .save(&still)
            .unwrap();
        assert!(!metadata(&still).is_animated);
        let out = crop(
            &still,
            &Crop {
                left: 0.0,
                top: 0.0,
                width: 10.0,
                height: 20.0,
                output_width: 32,
                output_height: 64,
                rotation: 270,
            },
        )
        .unwrap();
        let decoded = image::open(&out).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (32, 64));
        assert_eq!(process(&still).unwrap(), still);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clamps_regions_and_fits_bounds() {
        let crop = Crop {
            left: -5.0,
            top: 3.6,
            width: 500.0,
            height: 2.0,
            output_width: 1,
            output_height: 1,
            rotation: 0,
        };
        assert_eq!(region(&crop, 100, 50), (0, 4, 100, 2));
        assert_eq!(fit_within((1000.0, 500.0), (512.0, 512.0)), (512.0, 256.0));
        assert_eq!(fit_within((0.0, 1.0), (1600.0, 400.0)), (1600.0, 400.0));
    }

    #[test]
    fn reads_webp_and_png_animation_flags() {
        let mut vp8x = b"RIFF\0\0\0\0WEBPVP8X\x0a\0\0\0".to_vec();
        vp8x.extend_from_slice(&[0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(webp_is_animated(&vp8x), Some(true));
        let mut png = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        png.extend_from_slice(&[0, 0, 0, 8]);
        png.extend_from_slice(b"acTL");
        png.extend_from_slice(&[0; 12]);
        assert_eq!(png_is_animated(&png), Some(true));
    }
}
