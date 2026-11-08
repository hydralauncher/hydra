//! screenshots/screenshot-compression.ts and screenshot-compression-plan.ts:
//! the upload image and thumbnail, each inside its box and byte cap.
//! sharp's resize (`fit: "fill"`, Lanczos3) and JPEG encoder become the
//! `image` crate's.

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ExtendedColorType, RgbImage};

/// ScreenshotBox
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScreenshotBox {
    pub max_width: f64,
    pub max_height: f64,
    pub max_bytes: usize,
    pub quality: u8,
}

/// SCREENSHOT_TIER_BOXES.STANDARD
pub const STANDARD_BOX: ScreenshotBox = ScreenshotBox {
    max_width: 1280.0,
    max_height: 720.0,
    max_bytes: 2 * 1024 * 1024,
    quality: 90,
};
/// SCREENSHOT_TIER_BOXES.CLOUD
pub const CLOUD_BOX: ScreenshotBox = ScreenshotBox {
    max_width: 1920.0,
    max_height: 1080.0,
    max_bytes: 5 * 1024 * 1024,
    quality: 95,
};
/// SCREENSHOT_THUMBNAIL_BOX
pub const THUMBNAIL_BOX: ScreenshotBox = ScreenshotBox {
    max_width: 480.0,
    max_height: f64::INFINITY,
    max_bytes: 512 * 1024,
    quality: 80,
};
pub const MINIMUM_QUALITY: u8 = 50;
pub const QUALITY_STEP: u8 = 5;

/// The error codes the upload worker keeps (Error.message in Electron).
pub const UNREADABLE: &str = "screenshot_unreadable";
pub const TOO_LARGE: &str = "screenshot_too_large";
pub const COMPRESSION_FAILED: &str = "screenshot_compression_failed";

/// "STANDARD" | "CLOUD"
pub fn tier_box(quality: &str) -> ScreenshotBox {
    if quality == "CLOUD" {
        CLOUD_BOX
    } else {
        STANDARD_BOX
    }
}

/// fitSizeInsideBox
pub fn fit_size_inside_box(width: u32, height: u32, bounds: &ScreenshotBox) -> (u32, u32) {
    let (w, h) = (f64::from(width), f64::from(height));
    let scale = 1f64.min(bounds.max_width / w).min(bounds.max_height / h);
    if scale == 1.0 {
        return (width, height);
    }
    let fit = |value: f64, max: f64| value.mul_add(scale, 0.0).round().max(1.0).min(max) as u32;
    (fit(w, bounds.max_width), fit(h, bounds.max_height))
}

/// getQualitySteps: 95, 90, … down to 50.
pub fn quality_steps(initial: u8) -> Vec<u8> {
    let mut steps = Vec::new();
    let mut quality = i32::from(initial);
    while quality >= i32::from(MINIMUM_QUALITY) {
        steps.push(quality as u8);
        quality -= i32::from(QUALITY_STEP);
    }
    steps
}

/// encodeWithinByteCap: the first quality that fits, else screenshot_too_large.
pub fn encode_within_byte_cap(
    encode: impl Fn(u8) -> Result<Vec<u8>, String>,
    bounds: &ScreenshotBox,
) -> Result<(Vec<u8>, u8), String> {
    for quality in quality_steps(bounds.quality) {
        let buffer = encode(quality)?;
        if buffer.len() <= bounds.max_bytes {
            return Ok((buffer, quality));
        }
    }
    Err(TOO_LARGE.to_string())
}

pub fn encode_jpeg(image: &RgbImage, quality: u8) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    JpegEncoder::new_with_quality(&mut output, quality)
        .encode(
            image.as_raw(),
            image.width(),
            image.height(),
            ExtendedColorType::Rgb8,
        )
        .map_err(|error| error.to_string())?;
    Ok(output)
}

/// CompressedScreenshot
pub struct CompressedScreenshot {
    pub quality: String,
    pub image: Vec<u8>,
    pub thumbnail: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

fn decode(bytes: &[u8]) -> Result<DynamicImage, String> {
    image::load_from_memory(bytes).map_err(|error| {
        let message = error.to_string();
        // isUndecodableImageError: memory errors are not "unreadable"
        if message.to_lowercase().contains("memory") || message.to_lowercase().contains("alloc") {
            COMPRESSION_FAILED.to_string()
        } else {
            UNREADABLE.to_string()
        }
    })
}

fn encode_in_box(source: &RgbImage, bounds: &ScreenshotBox) -> Result<(Vec<u8>, u32, u32), String> {
    let (width, height) = fit_size_inside_box(source.width(), source.height(), bounds);
    let resized;
    let image = if (width, height) == (source.width(), source.height()) {
        source
    } else {
        resized = image::imageops::resize(source, width, height, FilterType::Lanczos3);
        &resized
    };
    let (buffer, _) = encode_within_byte_cap(|quality| encode_jpeg(image, quality), bounds)?;
    Ok((buffer, width, height))
}

/// compressScreenshotForUpload(original, quality). Errors are the codes
/// above: unreadable and too large are kept, anything else is
/// screenshot_compression_failed.
pub fn compress_for_upload(original: &[u8], quality: &str) -> Result<CompressedScreenshot, String> {
    let result = (|| {
        let source = decode(original)?.into_rgb8();
        if source.width() == 0 || source.height() == 0 {
            return Err(UNREADABLE.to_string());
        }
        let (image, width, height) = encode_in_box(&source, &tier_box(quality))?;
        drop(source);
        // the thumbnail comes from the encoded upload image, like sharp(image.buffer)
        let encoded = decode(&image)?.into_rgb8();
        let (thumbnail, _, _) = encode_in_box(&encoded, &THUMBNAIL_BOX)?;
        Ok(CompressedScreenshot {
            quality: quality.to_string(),
            image,
            thumbnail,
            width,
            height,
        })
    })();
    result.map_err(|error| match error.as_str() {
        UNREADABLE | TOO_LARGE | COMPRESSION_FAILED => error,
        other => {
            eprintln!("Could not compress a screenshot for upload: {other}");
            COMPRESSION_FAILED.to_string()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // screenshot-compression-plan.test.ts
    #[test]
    fn fits_inside_boxes() {
        assert_eq!(fit_size_inside_box(3840, 2160, &STANDARD_BOX), (1280, 720));
        assert_eq!(fit_size_inside_box(3840, 2160, &CLOUD_BOX), (1920, 1080));
        assert_eq!(fit_size_inside_box(1280, 720, &STANDARD_BOX), (1280, 720));
        assert_eq!(fit_size_inside_box(800, 600, &STANDARD_BOX), (800, 600));
        assert_eq!(fit_size_inside_box(2560, 1080, &STANDARD_BOX), (1280, 540));
        assert_eq!(fit_size_inside_box(1080, 2400, &CLOUD_BOX), (486, 1080));
        assert_eq!(fit_size_inside_box(1920, 1080, &THUMBNAIL_BOX), (480, 270));
        assert_eq!(fit_size_inside_box(10000, 1, &STANDARD_BOX), (1280, 1));
    }

    #[test]
    fn quality_steps_go_down_to_fifty() {
        assert_eq!(
            quality_steps(95),
            vec![95, 90, 85, 80, 75, 70, 65, 60, 55, 50]
        );
        assert_eq!(quality_steps(80).last(), Some(&50));
        assert_eq!(quality_steps(40), Vec::<u8>::new());
    }

    #[test]
    fn stops_at_the_first_quality_that_fits() {
        let bounds = ScreenshotBox {
            max_bytes: 100,
            ..STANDARD_BOX
        };
        let encode = |quality: u8| Ok(vec![0u8; usize::from(quality) + 20]);
        assert_eq!(encode_within_byte_cap(encode, &bounds).unwrap().1, 80);
        let never = |_| Ok(vec![0u8; 1000]);
        assert_eq!(
            encode_within_byte_cap(never, &bounds).unwrap_err(),
            TOO_LARGE
        );
    }

    #[test]
    fn compresses_a_real_jpeg() {
        let mut source = RgbImage::new(2560, 1440);
        for (x, y, pixel) in source.enumerate_pixels_mut() {
            *pixel = image::Rgb([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8]);
        }
        let original = encode_jpeg(&source, 95).unwrap();
        let compressed = compress_for_upload(&original, "STANDARD").unwrap();
        assert_eq!((compressed.width, compressed.height), (1280, 720));
        let thumbnail = image::load_from_memory(&compressed.thumbnail).unwrap();
        assert_eq!((thumbnail.width(), thumbnail.height()), (480, 270));
        assert_eq!(
            compress_for_upload(b"not an image", "CLOUD")
                .err()
                .as_deref(),
            Some(UNREADABLE)
        );
    }
}
