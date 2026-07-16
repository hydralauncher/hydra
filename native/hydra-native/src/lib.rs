use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::{cmp::Ordering, collections::HashMap};

use image::codecs::gif::{GifDecoder, GifEncoder, Repeat};
use image::codecs::png::PngDecoder;
use image::codecs::webp::WebPDecoder;
use image::imageops::{crop_imm, resize, rotate180, rotate270, rotate90, FilterType};
use image::{
    AnimationDecoder, Frame, ImageDecoder, ImageFormat, ImageReader, ImageResult, RgbaImage,
};
use napi::bindgen_prelude::Error;
use napi_derive::napi;
use sysinfo::{ProcessesToUpdate, System};
use uuid::Uuid;

#[napi(object)]
pub struct ProcessedImageData {
    pub image_path: String,
    pub mime_type: String,
}

#[napi(object)]
pub struct ProcessedFriendImageData {
    pub image_path: String,
    pub mime_type: String,
    pub is_animated: bool,
}

#[napi(object)]
pub struct PreparedAnimatedPngCropData {
    pub frame_paths: Vec<String>,
    pub delays: Vec<u32>,
    pub loop_count: u32,
}

#[napi(object)]
pub struct NativeProcessPayload {
    pub exe: Option<String>,
    pub pid: u32,
    pub name: String,
    pub environ: Option<HashMap<String, String>>,
    pub cwd: Option<String>,
}

#[napi]
pub fn process_profile_image(
    image_path: String,
    target_extension: Option<String>,
) -> napi::Result<ProcessedImageData> {
    let input_path = PathBuf::from(image_path);

    if !input_path.exists() {
        return Err(Error::from_reason("Image file not found"));
    }

    let format = detect_image_format(&input_path)?;
    let animated = is_animated_image(&input_path, format)?;

    if !animated {
        return Ok(ProcessedImageData {
            image_path: input_path.to_string_lossy().to_string(),
            mime_type: mime_type_from_format_or_path(format, &input_path),
        });
    }

    let extension = target_extension
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| "webp".to_string());

    let output_format = output_format_from_extension(&extension)?;
    let output_path = build_temp_output_path(&extension);

    let image = ImageReader::open(&input_path)
        .map_err(|err| Error::from_reason(err.to_string()))?
        .with_guessed_format()
        .map_err(|err| Error::from_reason(err.to_string()))?
        .decode()
        .map_err(|err| Error::from_reason(err.to_string()))?;

    image
        .save_with_format(&output_path, output_format)
        .map_err(|err| Error::from_reason(err.to_string()))?;

    Ok(ProcessedImageData {
        image_path: output_path.to_string_lossy().to_string(),
        mime_type: mime_type_from_format_or_path(Some(output_format), &output_path),
    })
}

#[napi]
pub async fn process_friend_image(
    image_path: String,
    output_path_base: String,
    width: u32,
    height: u32,
    preserve_animation: bool,
) -> napi::Result<ProcessedFriendImageData> {
    tokio::task::spawn_blocking(move || {
        process_friend_image_sync(
            image_path,
            output_path_base,
            width,
            height,
            preserve_animation,
        )
    })
    .await
    .map_err(|err| Error::from_reason(err.to_string()))?
}

#[napi]
pub async fn prepare_animated_png_crop(
    image_path: String,
    left: u32,
    top: u32,
    width: u32,
    height: u32,
    output_width: u32,
    output_height: u32,
    rotation: u16,
) -> napi::Result<PreparedAnimatedPngCropData> {
    tokio::task::spawn_blocking(move || {
        prepare_animated_png_crop_sync(
            image_path,
            left,
            top,
            width,
            height,
            output_width,
            output_height,
            rotation,
        )
    })
    .await
    .map_err(|err| Error::from_reason(err.to_string()))?
}

fn prepare_animated_png_crop_sync(
    image_path: String,
    left: u32,
    top: u32,
    width: u32,
    height: u32,
    output_width: u32,
    output_height: u32,
    rotation: u16,
) -> napi::Result<PreparedAnimatedPngCropData> {
    if width == 0 || height == 0 || output_width == 0 || output_height == 0 {
        return Err(Error::from_reason("Invalid crop dimensions"));
    }

    if !matches!(rotation, 0 | 90 | 180 | 270) {
        return Err(Error::from_reason("Invalid rotation"));
    }

    let input_path = PathBuf::from(image_path);
    let (frame_count, loop_count) = read_apng_control(&input_path)?;
    let input_file = File::open(&input_path).map_err(|err| Error::from_reason(err.to_string()))?;
    let decoder = PngDecoder::new(BufReader::new(input_file))
        .map_err(|err| Error::from_reason(err.to_string()))?;
    let (source_width, source_height) = decoder.dimensions();
    validate_animated_input_pixels(source_width, source_height, frame_count)?;

    let decoder = decoder
        .apng()
        .map_err(|err| Error::from_reason(err.to_string()))?;
    let frames = decoder.into_frames();
    let mut frame_paths = Vec::with_capacity(frame_count as usize);
    let mut delays = Vec::with_capacity(frame_count as usize);

    let result = (|| -> napi::Result<()> {
        for frame in frames {
            let frame = frame.map_err(|err| Error::from_reason(err.to_string()))?;
            let delay = delay_to_milliseconds(&frame.delay());
            let transformed = transform_apng_frame(
                frame.into_buffer(),
                left,
                top,
                width,
                height,
                output_width,
                output_height,
                rotation,
            )?;
            let frame_path = build_temp_output_path("png");
            let frame_path_string = frame_path.to_string_lossy().to_string();
            frame_paths.push(frame_path_string);

            transformed
                .save_with_format(&frame_path, ImageFormat::Png)
                .map_err(|err| Error::from_reason(err.to_string()))?;

            delays.push(delay);
        }

        Ok(())
    })();

    if let Err(error) = result {
        cleanup_paths(&frame_paths);
        return Err(error);
    }

    if frame_paths.len() <= 1 {
        cleanup_paths(&frame_paths);
        return Err(Error::from_reason("PNG is not animated"));
    }

    Ok(PreparedAnimatedPngCropData {
        frame_paths,
        delays,
        loop_count,
    })
}

fn validate_animated_input_pixels(width: u32, height: u32, frames: u32) -> napi::Result<()> {
    const MAX_ANIMATED_INPUT_PIXELS: u64 = 1_000_000_000;
    let total_pixels = u64::from(width)
        .saturating_mul(u64::from(height))
        .saturating_mul(u64::from(frames));

    if total_pixels > MAX_ANIMATED_INPUT_PIXELS {
        return Err(Error::from_reason("Input image exceeds pixel limit"));
    }

    Ok(())
}

fn transform_apng_frame(
    frame: RgbaImage,
    left: u32,
    top: u32,
    width: u32,
    height: u32,
    output_width: u32,
    output_height: u32,
    rotation: u16,
) -> napi::Result<RgbaImage> {
    let rotated = match rotation {
        0 => frame,
        90 => rotate90(&frame),
        180 => rotate180(&frame),
        270 => rotate270(&frame),
        _ => return Err(Error::from_reason("Invalid rotation")),
    };

    if left >= rotated.width()
        || top >= rotated.height()
        || width > rotated.width() - left
        || height > rotated.height() - top
    {
        return Err(Error::from_reason("Crop region is outside image bounds"));
    }

    let cropped = crop_imm(&rotated, left, top, width, height).to_image();
    Ok(resize(
        &cropped,
        output_width,
        output_height,
        FilterType::Lanczos3,
    ))
}

fn delay_to_milliseconds(delay: &image::Delay) -> u32 {
    let (numerator, denominator) = delay.numer_denom_ms();
    if denominator == 0 {
        return numerator.max(1);
    }

    ((f64::from(numerator) / f64::from(denominator)).round() as u32).max(1)
}

fn read_apng_control(path: &Path) -> napi::Result<(u32, u32)> {
    const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

    let file = File::open(path).map_err(|err| Error::from_reason(err.to_string()))?;
    let mut reader = BufReader::new(file);
    let mut signature = [0_u8; 8];
    reader
        .read_exact(&mut signature)
        .map_err(|err| Error::from_reason(err.to_string()))?;

    if signature != PNG_SIGNATURE {
        return Err(Error::from_reason("Invalid PNG signature"));
    }

    loop {
        let mut header = [0_u8; 8];
        reader
            .read_exact(&mut header)
            .map_err(|err| Error::from_reason(err.to_string()))?;
        let chunk_length = u32::from_be_bytes(header[0..4].try_into().unwrap());
        let chunk_type = &header[4..8];

        if chunk_type == b"acTL" {
            if chunk_length != 8 {
                return Err(Error::from_reason("Invalid APNG control chunk"));
            }

            let mut control = [0_u8; 8];
            reader
                .read_exact(&mut control)
                .map_err(|err| Error::from_reason(err.to_string()))?;
            let frame_count = u32::from_be_bytes(control[0..4].try_into().unwrap());
            let loop_count = u32::from_be_bytes(control[4..8].try_into().unwrap());

            if frame_count <= 1 {
                return Err(Error::from_reason("PNG is not animated"));
            }

            return Ok((frame_count, loop_count));
        }

        if chunk_type == b"IDAT" || chunk_type == b"IEND" {
            return Err(Error::from_reason("PNG is not animated"));
        }

        reader
            .seek(SeekFrom::Current(i64::from(chunk_length) + 4))
            .map_err(|err| Error::from_reason(err.to_string()))?;
    }
}

fn cleanup_paths(paths: &[String]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}

fn process_friend_image_sync(
    image_path: String,
    output_path_base: String,
    width: u32,
    height: u32,
    preserve_animation: bool,
) -> napi::Result<ProcessedFriendImageData> {
    if width == 0 || height == 0 {
        return Err(Error::from_reason("Invalid output dimensions"));
    }

    let input_path = PathBuf::from(image_path);

    if !input_path.exists() {
        return Err(Error::from_reason("Image file not found"));
    }

    let format = detect_image_format(&input_path)?;
    let is_animated = preserve_animation && is_animated_image(&input_path, format)?;

    if is_animated {
        let output_path = with_extension(&output_path_base, "gif");
        resize_animated_image(&input_path, format, &output_path, width, height)?;

        return Ok(ProcessedFriendImageData {
            image_path: output_path.to_string_lossy().to_string(),
            mime_type: "image/gif".to_string(),
            is_animated: true,
        });
    }

    let output_path = with_extension(&output_path_base, "webp");
    resize_static_image(&input_path, &output_path, width, height)?;

    Ok(ProcessedFriendImageData {
        image_path: output_path.to_string_lossy().to_string(),
        mime_type: "image/webp".to_string(),
        is_animated: false,
    })
}

#[napi]
pub fn list_processes() -> Vec<NativeProcessPayload> {
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);

    let mut processes: Vec<NativeProcessPayload> = system
        .processes()
        .values()
        .map(|process| {
            let include_linux_extras = !cfg!(target_os = "windows");

            NativeProcessPayload {
                exe: process
                    .exe()
                    .map(|value| value.to_string_lossy().to_string()),
                pid: process.pid().as_u32(),
                name: process.name().to_string_lossy().to_string(),
                cwd: if include_linux_extras {
                    process
                        .cwd()
                        .map(|value| value.to_string_lossy().to_string())
                } else {
                    None
                },
                environ: if include_linux_extras {
                    let env_map: HashMap<String, String> = process
                        .environ()
                        .iter()
                        .filter_map(|entry| {
                            let entry_value = entry.to_string_lossy();
                            entry_value.split_once('=').and_then(|(key, value)| {
                                if key.is_empty() {
                                    None
                                } else {
                                    Some((key.to_string(), value.to_string()))
                                }
                            })
                        })
                        .collect();

                    if env_map.is_empty() {
                        None
                    } else {
                        Some(env_map)
                    }
                } else {
                    None
                },
            }
        })
        .collect();

    processes.sort_by(|left, right| {
        let by_pid = left.pid.cmp(&right.pid);
        if by_pid == Ordering::Equal {
            left.name.cmp(&right.name)
        } else {
            by_pid
        }
    });

    processes
}

fn detect_image_format(path: &Path) -> napi::Result<Option<ImageFormat>> {
    let reader = ImageReader::open(path).map_err(|err| Error::from_reason(err.to_string()))?;

    let guessed = reader
        .with_guessed_format()
        .map_err(|err| Error::from_reason(err.to_string()))?;

    Ok(guessed.format())
}

fn is_animated_image(path: &Path, format: Option<ImageFormat>) -> napi::Result<bool> {
    match format {
        Some(ImageFormat::Gif) => is_gif_animated(path),
        Some(ImageFormat::WebP) => is_webp_animated(path),
        Some(ImageFormat::Png) => is_apng(path),
        _ => Ok(false),
    }
}

fn is_gif_animated(path: &Path) -> napi::Result<bool> {
    let file = File::open(path).map_err(|err| Error::from_reason(err.to_string()))?;
    let decoder =
        GifDecoder::new(BufReader::new(file)).map_err(|err| Error::from_reason(err.to_string()))?;

    let mut frames = decoder.into_frames();
    let _ = frames.next().transpose();
    Ok(matches!(frames.next().transpose(), Ok(Some(_))))
}

fn is_webp_animated(path: &Path) -> napi::Result<bool> {
    let file = File::open(path).map_err(|err| Error::from_reason(err.to_string()))?;
    let decoder = WebPDecoder::new(BufReader::new(file))
        .map_err(|err| Error::from_reason(err.to_string()))?;

    Ok(decoder.has_animation())
}

fn is_apng(path: &Path) -> napi::Result<bool> {
    let file = File::open(path).map_err(|err| Error::from_reason(err.to_string()))?;
    let decoder =
        PngDecoder::new(BufReader::new(file)).map_err(|err| Error::from_reason(err.to_string()))?;

    decoder
        .is_apng()
        .map_err(|err| Error::from_reason(err.to_string()))
}

fn resize_animated_image(
    input_path: &Path,
    format: Option<ImageFormat>,
    output_path: &Path,
    width: u32,
    height: u32,
) -> napi::Result<()> {
    match format {
        Some(ImageFormat::Gif) => {
            let input_file =
                File::open(input_path).map_err(|err| Error::from_reason(err.to_string()))?;
            let decoder = GifDecoder::new(BufReader::new(input_file))
                .map_err(|err| Error::from_reason(err.to_string()))?;
            encode_animation_frames_to_gif(decoder.into_frames(), output_path, width, height)
        }
        Some(ImageFormat::WebP) => {
            let input_file =
                File::open(input_path).map_err(|err| Error::from_reason(err.to_string()))?;
            let decoder = WebPDecoder::new(BufReader::new(input_file))
                .map_err(|err| Error::from_reason(err.to_string()))?;
            encode_animation_frames_to_gif(decoder.into_frames(), output_path, width, height)
        }
        Some(ImageFormat::Png) => {
            let input_file =
                File::open(input_path).map_err(|err| Error::from_reason(err.to_string()))?;
            let decoder = PngDecoder::new(BufReader::new(input_file))
                .map_err(|err| Error::from_reason(err.to_string()))?
                .apng()
                .map_err(|err| Error::from_reason(err.to_string()))?;
            encode_animation_frames_to_gif(decoder.into_frames(), output_path, width, height)
        }
        _ => Err(Error::from_reason("Unsupported animated image format")),
    }
}

fn encode_animation_frames_to_gif<I>(
    frames: I,
    output_path: &Path,
    width: u32,
    height: u32,
) -> napi::Result<()>
where
    I: IntoIterator<Item = ImageResult<Frame>>,
{
    let output_file =
        File::create(output_path).map_err(|err| Error::from_reason(err.to_string()))?;
    let mut encoder = GifEncoder::new(BufWriter::new(output_file));
    encoder
        .set_repeat(Repeat::Infinite)
        .map_err(|err| Error::from_reason(err.to_string()))?;

    for frame in frames {
        let frame = frame.map_err(|err| Error::from_reason(err.to_string()))?;
        let delay = frame.delay().clone();
        let resized = resize_cover_rgba(&frame.into_buffer(), width, height)?;

        encoder
            .encode_frame(Frame::from_parts(resized, 0, 0, delay))
            .map_err(|err| Error::from_reason(err.to_string()))?;
    }

    Ok(())
}

fn resize_static_image(
    input_path: &Path,
    output_path: &Path,
    width: u32,
    height: u32,
) -> napi::Result<()> {
    let image = ImageReader::open(input_path)
        .map_err(|err| Error::from_reason(err.to_string()))?
        .with_guessed_format()
        .map_err(|err| Error::from_reason(err.to_string()))?
        .decode()
        .map_err(|err| Error::from_reason(err.to_string()))?
        .to_rgba8();

    let resized = resize_cover_rgba(&image, width, height)?;
    resized
        .save_with_format(output_path, ImageFormat::WebP)
        .map_err(|err| Error::from_reason(err.to_string()))
}

fn resize_cover_rgba(image: &RgbaImage, width: u32, height: u32) -> napi::Result<RgbaImage> {
    let source_width = image.width();
    let source_height = image.height();

    if source_width == 0 || source_height == 0 {
        return Err(Error::from_reason("Could not read source image dimensions"));
    }

    let width_scale = width as f32 / source_width as f32;
    let height_scale = height as f32 / source_height as f32;
    let scale = width_scale.max(height_scale);

    let resized_width = ((source_width as f32 * scale).ceil() as u32).max(width);
    let resized_height = ((source_height as f32 * scale).ceil() as u32).max(height);
    let resized = resize(image, resized_width, resized_height, FilterType::Lanczos3);

    let left = (resized_width.saturating_sub(width)) / 2;
    let top = (resized_height.saturating_sub(height)) / 2;

    Ok(crop_imm(&resized, left, top, width, height).to_image())
}

fn with_extension(output_path_base: &str, extension: &str) -> PathBuf {
    let mut output_path = PathBuf::from(output_path_base);
    output_path.set_extension(extension);
    output_path
}

fn output_format_from_extension(extension: &str) -> napi::Result<ImageFormat> {
    match extension {
        "png" => Ok(ImageFormat::Png),
        "jpg" | "jpeg" => Ok(ImageFormat::Jpeg),
        "webp" => Ok(ImageFormat::WebP),
        _ => Err(Error::from_reason("Unsupported target extension")),
    }
}

fn build_temp_output_path(extension: &str) -> PathBuf {
    let mut output_path = std::env::temp_dir();
    output_path.push(format!("{}.{}", Uuid::new_v4(), extension));
    output_path
}

fn mime_type_from_format_or_path(format: Option<ImageFormat>, path: &Path) -> String {
    if let Some(value) = mime_type_from_image_format(format) {
        return value.to_string();
    }

    mime_guess::from_path(path)
        .first_or_octet_stream()
        .essence_str()
        .to_string()
}

fn mime_type_from_image_format(format: Option<ImageFormat>) -> Option<&'static str> {
    match format {
        Some(ImageFormat::Png) => Some("image/png"),
        Some(ImageFormat::Jpeg) => Some("image/jpeg"),
        Some(ImageFormat::Gif) => Some("image/gif"),
        Some(ImageFormat::WebP) => Some("image/webp"),
        Some(ImageFormat::Bmp) => Some("image/bmp"),
        Some(ImageFormat::Ico) => Some("image/x-icon"),
        Some(ImageFormat::Tiff) => Some("image/tiff"),
        Some(ImageFormat::Avif) => Some("image/avif"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn transforms_rotated_apng_frames() {
        let frame = RgbaImage::from_pixel(4, 2, image::Rgba([255, 0, 0, 255]));
        let result = transform_apng_frame(frame, 0, 0, 2, 4, 20, 40, 90).unwrap();

        assert_eq!(result.width(), 20);
        assert_eq!(result.height(), 40);
    }

    #[test]
    fn reads_apng_frame_and_loop_counts() {
        let path = build_temp_output_path("png");
        let mut file = File::create(&path).unwrap();
        file.write_all(&[
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
            0, 0, 0, 8, b'a', b'c', b'T', b'L', // acTL header
            0, 0, 0, 3, // frames
            0, 0, 0, 2, // loops
        ])
        .unwrap();

        assert_eq!(read_apng_control(&path).unwrap(), (3, 2));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn enforces_animated_pixel_limit() {
        assert!(validate_animated_input_pixels(1920, 620, 241).is_ok());
        assert!(validate_animated_input_pixels(50_000, 50_000, 2).is_err());
    }

    #[test]
    fn prepares_partial_apng_frames_with_metadata() {
        let input_path = build_temp_output_path("png");
        let file = File::create(&input_path).unwrap();
        let mut encoder = png::Encoder::new(file, 4, 2);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_animated(3, 2).unwrap();
        let mut writer = encoder.write_header().unwrap();

        writer.set_frame_delay(40, 1000).unwrap();
        writer.write_image_data(&[255; 4 * 2 * 4]).unwrap();
        writer.set_frame_dimension(2, 1).unwrap();
        writer.set_frame_position(1, 1).unwrap();
        writer.set_frame_delay(50, 1000).unwrap();
        writer.set_blend_op(png::BlendOp::Source).unwrap();
        writer.write_image_data(&[0; 2 * 4]).unwrap();
        writer.reset_frame_position().unwrap();
        writer.reset_frame_dimension().unwrap();
        writer.set_frame_delay(60, 1000).unwrap();
        writer.write_image_data(&[128; 4 * 2 * 4]).unwrap();
        writer.finish().unwrap();

        let prepared = prepare_animated_png_crop_sync(
            input_path.to_string_lossy().to_string(),
            0,
            0,
            4,
            2,
            8,
            4,
            0,
        )
        .unwrap();

        assert_eq!(prepared.frame_paths.len(), 3);
        assert_eq!(prepared.delays, vec![40, 50, 60]);
        assert_eq!(prepared.loop_count, 2);

        for frame_path in &prepared.frame_paths {
            let frame = image::open(frame_path).unwrap();
            assert_eq!(frame.width(), 8);
            assert_eq!(frame.height(), 4);
        }

        cleanup_paths(&prepared.frame_paths);
        fs::remove_file(input_path).unwrap();
    }
}
