//! Frame checks and geometry: screenshot-frame-validation.ts,
//! desktop-duplication-frame.ts (sampleBgraFrame), windows-client-area-crop.ts.

use crate::Frame;

/// SCREENSHOT_FRAME_SAMPLE_SIZE
pub const SAMPLE_SIZE: u32 = 32;
const MAX_BLANK_FRAME_CHANNEL_RANGE: u8 = 8;
const MAX_NEAR_BLACK_CHANNEL_VALUE: u8 = 16;
const MIN_NEAR_BLACK_PIXEL_RATIO: f64 = 0.98;
const MAX_BLACK_FRAME_AVERAGE_CHANNEL_VALUE: f64 = 8.0;

/// sampleBgraFrame: a SAMPLE_SIZE² grid of pixels taken at cell centers.
pub fn sample_bgra(pixels: &[u8], width: u32, height: u32) -> Vec<u8> {
    let size = SAMPLE_SIZE as usize;
    let mut sample = vec![0u8; size * size * 4];
    if width == 0 || height == 0 || pixels.len() < (width * height * 4) as usize {
        return sample;
    }
    for row in 0..size {
        let y = (((row as f64 + 0.5) * f64::from(height)) / size as f64).floor() as usize;
        for column in 0..size {
            let x = (((column as f64 + 0.5) * f64::from(width)) / size as f64).floor() as usize;
            let from = (y * width as usize + x) * 4;
            let to = (row * size + column) * 4;
            sample[to..to + 4].copy_from_slice(&pixels[from..from + 4]);
        }
    }
    sample
}

/// ScreenshotColorRange: (min, max) per red, green, blue.
pub type ColorRange = [(u8, u8); 3];

/// getBitmapColorRange (BGRA input)
pub fn color_range(bgra: &[u8]) -> ColorRange {
    let mut range = [(255u8, 0u8); 3];
    for pixel in bgra.chunks_exact(4) {
        for (channel, value) in [pixel[2], pixel[1], pixel[0]].into_iter().enumerate() {
            range[channel].0 = range[channel].0.min(value);
            range[channel].1 = range[channel].1.max(value);
        }
    }
    range
}

/// isNearlyUniformScreenshot
pub fn is_nearly_uniform(range: &ColorRange) -> bool {
    range
        .iter()
        .all(|(min, max)| max.saturating_sub(*min) <= MAX_BLANK_FRAME_CHANNEL_RANGE)
}

/// isMostlyBlackScreenshot (BGRA input)
pub fn is_mostly_black(bgra: &[u8]) -> bool {
    let pixel_count = bgra.len() / 4;
    if pixel_count == 0 {
        return false;
    }
    let mut near_black = 0usize;
    let mut total = 0u64;
    for pixel in bgra.chunks_exact(4) {
        let (blue, green, red) = (pixel[0], pixel[1], pixel[2]);
        total += u64::from(red) + u64::from(green) + u64::from(blue);
        if red <= MAX_NEAR_BLACK_CHANNEL_VALUE
            && green <= MAX_NEAR_BLACK_CHANNEL_VALUE
            && blue <= MAX_NEAR_BLACK_CHANNEL_VALUE
        {
            near_black += 1;
        }
    }
    near_black as f64 / pixel_count as f64 >= MIN_NEAR_BLACK_PIXEL_RATIO
        && total as f64 / (pixel_count * 3) as f64 <= MAX_BLACK_FRAME_AVERAGE_CHANNEL_VALUE
}

/// isBlankBgraSample
pub fn is_blank_sample(bgra: &[u8]) -> bool {
    is_nearly_uniform(&color_range(bgra)) || is_mostly_black(bgra)
}

/// Whether a whole BGRA frame is blank (sampled like the desktop duplication path).
pub fn is_blank_frame(frame: &Frame) -> bool {
    is_blank_sample(&sample_bgra(&frame.pixels, frame.width, frame.height))
}

/// ScreenRect (window_bounds.rs uses the same fields).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }
    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }
}

/// ImageCropRect
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Crop {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

const MAX_TOP_TRIM_PIXELS: f64 = 200.0;
const MAX_TOP_TRIM_RATIO: f64 = 0.25;
const MAX_BORDER_TRIM_PIXELS: i32 = 16;

/// getClientAreaCrop: the client area inside a window image whose size maps
/// to the window frame. None when the crop would be a no-op or looks wrong.
pub fn client_area_crop(frame: Rect, client: Rect, image: (u32, u32)) -> Option<Crop> {
    let left = client.left.max(frame.left);
    let top = client.top.max(frame.top);
    let right = client.right.min(frame.right);
    let bottom = client.bottom.min(frame.bottom);
    if right <= left || bottom <= top || frame.width() <= 0 || frame.height() <= 0 {
        return None;
    }
    let top_trim = f64::from(top - frame.top);
    let max_top_trim = MAX_TOP_TRIM_PIXELS.min(f64::from(frame.height()) * MAX_TOP_TRIM_RATIO);
    if top_trim > max_top_trim
        || left - frame.left > MAX_BORDER_TRIM_PIXELS
        || frame.right - right > MAX_BORDER_TRIM_PIXELS
        || frame.bottom - bottom > MAX_BORDER_TRIM_PIXELS
    {
        return None;
    }
    let scale_x = f64::from(image.0) / f64::from(frame.width());
    let scale_y = f64::from(image.1) / f64::from(frame.height());
    let x = (f64::from(left - frame.left) * scale_x).round() as i64;
    let y = (f64::from(top - frame.top) * scale_y).round() as i64;
    let width = (i64::from(image.0) - x).min((f64::from(right - left) * scale_x).round() as i64);
    let height = (i64::from(image.1) - y).min((f64::from(bottom - top) * scale_y).round() as i64);
    if width <= 0 || height <= 0 {
        return None;
    }
    if x == 0 && y == 0 && width == i64::from(image.0) && height == i64::from(image.1) {
        return None;
    }
    Some(Crop {
        x: x as u32,
        y: y as u32,
        width: width as u32,
        height: height as u32,
    })
}

/// Cuts a BGRA frame down to `crop` (clamped to the frame).
pub fn crop(frame: Frame, crop: Crop) -> Frame {
    let x = crop.x.min(frame.width);
    let y = crop.y.min(frame.height);
    let width = crop.width.min(frame.width - x);
    let height = crop.height.min(frame.height - y);
    if width == 0 || height == 0 || (width == frame.width && height == frame.height) {
        return frame;
    }
    let stride = frame.width as usize * 4;
    let row = width as usize * 4;
    let mut pixels = Vec::with_capacity(row * height as usize);
    for line in y as usize..(y + height) as usize {
        let start = line * stride + x as usize * 4;
        pixels.extend_from_slice(&frame.pixels[start..start + row]);
    }
    Frame {
        width,
        height,
        pixels,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(width: u32, height: u32, bgra: [u8; 4]) -> Frame {
        Frame {
            width,
            height,
            pixels: bgra.repeat((width * height) as usize),
        }
    }

    #[test]
    fn uniform_and_black_frames_are_blank() {
        assert!(is_blank_frame(&solid(64, 48, [0, 0, 0, 255])));
        assert!(is_blank_frame(&solid(64, 48, [200, 120, 40, 255])));
        let mut frame = solid(64, 64, [0, 0, 0, 255]);
        // a stripe of color across half the frame
        for y in 0..32 {
            for x in 0..64 {
                let i = ((y * 64 + x) * 4) as usize;
                frame.pixels[i..i + 3].copy_from_slice(&[30, 160, 220]);
            }
        }
        assert!(!is_blank_frame(&frame));
    }

    #[test]
    fn mostly_black_needs_a_low_average() {
        // 1 bright pixel in 100 is still "mostly black" by ratio (99%), and
        // the average stays under 8
        let mut pixels = [5u8, 5, 5, 255].repeat(100);
        pixels[0..3].copy_from_slice(&[255, 255, 255]);
        assert!(is_mostly_black(&pixels));
        let pixels = [16u8, 16, 16, 255].repeat(100);
        assert!(!is_mostly_black(&pixels));
    }

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> Rect {
        Rect {
            left,
            top,
            right,
            bottom,
        }
    }

    fn cut(x: u32, y: u32, width: u32, height: u32) -> Option<Crop> {
        Some(Crop {
            x,
            y,
            width,
            height,
        })
    }

    // windows-client-area-crop.test.ts, case by case
    #[test]
    fn client_area_crop_matches_electron() {
        assert_eq!(
            client_area_crop(
                rect(100, 50, 1100, 850),
                rect(101, 110, 1099, 849),
                (1000, 800)
            ),
            cut(1, 60, 998, 739)
        );
        assert_eq!(
            client_area_crop(rect(0, 0, 1000, 800), rect(0, 60, 1000, 800), (2000, 1600)),
            cut(0, 120, 2000, 1480)
        );
        let bounds = rect(0, 0, 1920, 1080);
        assert_eq!(client_area_crop(bounds, bounds, (1920, 1080)), None);
        assert_eq!(
            client_area_crop(rect(0, 0, 10, 10), rect(20, 20, 30, 30), (10, 10)),
            None
        );
        let frame = rect(0, 0, 1000, 800);
        assert_eq!(
            client_area_crop(frame, rect(0, 250, 1000, 800), (1000, 800)),
            None
        );
        assert_eq!(
            client_area_crop(frame, rect(40, 60, 1000, 800), (1000, 800)),
            None
        );
        assert_eq!(
            client_area_crop(frame, rect(0, 60, 1000, 700), (1000, 800)),
            None
        );
        let small = rect(0, 0, 320, 240);
        assert_eq!(
            client_area_crop(small, rect(0, 70, 320, 240), (320, 240)),
            None
        );
        assert_eq!(
            client_area_crop(small, rect(0, 51, 320, 240), (320, 240)),
            cut(0, 51, 320, 189)
        );
    }

    #[test]
    fn crops_bgra_rows() {
        let mut frame = solid(4, 3, [0, 0, 0, 255]);
        frame.pixels[(4 + 1) * 4] = 9; // (1, 1)
        let cropped = crop(
            frame,
            Crop {
                x: 1,
                y: 1,
                width: 2,
                height: 2,
            },
        );
        assert_eq!((cropped.width, cropped.height), (2, 2));
        assert_eq!(cropped.pixels[0], 9);
    }
}
