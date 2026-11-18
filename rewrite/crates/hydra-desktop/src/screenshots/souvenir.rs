//! services/screenshot.ts (ScreenshotService): achievement souvenir
//! screenshots, saved under `achievementScreenshotsPath` (default
//! `<userData>/Screenshots`) as
//! `<game>-<hash>/<achievement>-<hash>.jpeg`, at most 1080p, JPEG quality 80.
//!
//! For the achievement watcher: call these from a worker thread.
//! `cleanupOldScreenshots` stays with the souvenir stores (achievements).

use std::path::{Path, PathBuf};

use hydra_capture::Frame;
use hydra_capture::window_capture::CaptureError;
use hydra_core::screenshots::{fit_to_1080p, paths};
use image::imageops::FilterType;
use image::{DynamicImage, RgbImage};
use serde_json::Value;

use super::capture::{WindowTarget, acquire_frame};

/// SCREENSHOT_QUALITY
const QUALITY: u8 = 80;

/// GameScreenshotCaptureTarget: the running game to capture.
#[derive(Clone, Debug, Default)]
pub struct CaptureTarget {
    /// launchedGamePids.get(gameKey)
    pub process_id: Option<u32>,
    /// executablePath + trackingExecutablePaths
    pub executable_paths: Vec<String>,
    pub wine_prefix_path: Option<String>,
    /// levelKeys.game(shop, objectId)
    pub game_key: Option<String>,
    /// a known window (HWND) to capture instead of the foreground one
    pub window_handle: Option<String>,
    pub x11_window_id: Option<String>,
    /// cropToClientArea (false for souvenirs, like Electron)
    pub crop_to_client_area: bool,
}

/// getAchievementScreenshotsDirectory
pub fn achievement_screenshots_directory() -> PathBuf {
    let default = hydra_db::paths::native_user_data()
        .unwrap_or_default()
        .join("Screenshots");
    let preferred = super::service().and_then(|s| {
        s.preferences()
            .get("achievementScreenshotsPath")
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    paths::resolve_directory(preferred.as_deref(), &default)
}

fn to_rgb(frame: Frame) -> RgbImage {
    let rgb: Vec<u8> = frame
        .pixels
        .chunks_exact(4)
        .flat_map(|p| [p[2], p[1], p[0]])
        .collect();
    RgbImage::from_raw(frame.width, frame.height, rgb).unwrap_or_default()
}

/// resizeToFit: at most 1080 tall.
fn resize_to_fit(image: RgbImage) -> RgbImage {
    let (width, height) = fit_to_1080p(image.width(), image.height());
    if (width, height) == (image.width(), image.height()) {
        return image;
    }
    image::imageops::resize(&image, width, height, FilterType::Lanczos3)
}

fn write_jpeg(path: &Path, image: &RgbImage) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = hydra_core::screenshots::compression::encode_jpeg(image, QUALITY)?;
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

/// captureRawGameImage: the game's window (the foreground window when it
/// belongs to the game, or `window_handle`), blank frames retried.
pub fn capture_raw_game_image(target: &CaptureTarget) -> Result<Frame, CaptureError> {
    if hydra_capture::foreground::is_wayland_session() && target.x11_window_id.is_none() {
        // linux-game-capture-session.ts (the portal) is not ported
        return Err(CaptureError::Failed(
            "No game session available for Wayland capture".into(),
        ));
    }
    let window_target = WindowTarget {
        game_key: target.game_key.as_deref().unwrap_or_default(),
        process_id: target.process_id,
        executable_paths: &target.executable_paths,
        wine_prefix_path: target.wine_prefix_path.as_deref(),
        window_handle: target.window_handle.as_deref(),
        x11_window_id: target.x11_window_id.as_deref(),
    };
    if target.crop_to_client_area {
        return acquire_frame(&window_target);
    }
    // the window as a whole (no desktop duplication, no crop)
    #[cfg(windows)]
    {
        let handle = match &target.window_handle {
            Some(handle) => Some(handle.clone()),
            None => (0..3).find_map(|attempt| {
                if attempt > 0 {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                foreground_game_window(&window_target)
            }),
        };
        let handle = handle.ok_or_else(|| {
            CaptureError::Failed("Tracked game does not own the foreground window".into())
        })?;
        hydra_capture::window_capture::capture_window(&handle, false)
    }
    #[cfg(not(windows))]
    {
        let window = target
            .x11_window_id
            .clone()
            .or_else(|| foreground_game_window(&window_target))
            .ok_or_else(|| {
                CaptureError::Failed("Tracked game does not own the active X11 window".into())
            })?;
        hydra_capture::window_capture::capture_window(&window, false)
    }
}

/// The foreground window (HWND or X11 id) when it belongs to the game.
fn foreground_game_window(target: &WindowTarget) -> Option<String> {
    let window = hydra_capture::foreground::foreground_window()?;
    let pid = window.process_id?;
    let processes = super::foreground::processes();
    let matching = &hydra_core::screenshots::matching::is_windows_game_foreground_process;
    let belongs = if cfg!(windows) {
        matching(&processes, pid, target.process_id, target.executable_paths)
    } else {
        hydra_core::screenshots::matching::is_linux_game_window_process(
            &processes,
            pid,
            target.process_id,
            target.executable_paths,
            target.wine_prefix_path,
        )
    };
    if !belongs {
        return None;
    }
    window.window_handle.or(window.window_id)
}

/// ScreenshotService.captureGameScreenshot: the souvenir for one unlock.
/// Returns the file path.
pub fn capture_game_screenshot(
    game_title: &str,
    achievement_display_name: &str,
    game_id: &str,
    achievement_id: &str,
    target: &CaptureTarget,
) -> Result<PathBuf, String> {
    let path = paths::achievement_screenshot_path(
        &achievement_screenshots_directory(),
        game_title,
        achievement_display_name,
        game_id,
        achievement_id,
    );
    let frame = capture_raw_game_image(target).map_err(|e| e.to_string())?;
    write_jpeg(&path, &resize_to_fit(to_rgb(frame)))?;
    Ok(path)
}

/// isBlankImage: a 32x32 sample that is uniform or mostly black.
fn is_blank_image(image: &DynamicImage) -> bool {
    let sample = image.resize_exact(32, 32, FilterType::Triangle).to_rgba8();
    let bgra: Vec<u8> = sample
        .pixels()
        .flat_map(|p| [p[2], p[1], p[0], p[3]])
        .collect();
    hydra_capture::frame::is_blank_sample(&bgra)
}

/// ScreenshotService.importGameScreenshot: an emulator's own screenshot.
/// `Err("blank")` is BlankScreenshotError.
pub fn import_game_screenshot(
    source_path: &Path,
    game_title: &str,
    achievement_display_name: &str,
    game_id: &str,
    achievement_id: &str,
) -> Result<PathBuf, String> {
    let image = image::open(source_path).map_err(|_| {
        format!(
            "Could not read emulator screenshot at {}",
            source_path.display()
        )
    })?;
    if image.width() == 0 || image.height() == 0 {
        return Err(format!(
            "Could not read emulator screenshot at {}",
            source_path.display()
        ));
    }
    if is_blank_image(&image) {
        return Err("blank".into());
    }
    let path = paths::achievement_screenshot_path(
        &achievement_screenshots_directory(),
        game_title,
        achievement_display_name,
        game_id,
        achievement_id,
    );
    write_jpeg(&path, &resize_to_fit(image.into_rgb8()))?;
    Ok(path)
}

/// ScreenshotService.deleteGameScreenshot: the file, then its folder if empty.
pub fn delete_game_screenshot(
    game_title: &str,
    achievement_display_name: &str,
    game_id: &str,
    achievement_id: &str,
) {
    let path = paths::achievement_screenshot_path(
        &achievement_screenshots_directory(),
        game_title,
        achievement_display_name,
        game_id,
        achievement_id,
    );
    let _ = std::fs::remove_file(&path);
    if let Some(directory) = path.parent() {
        let empty = std::fs::read_dir(directory).is_ok_and(|mut entries| entries.next().is_none());
        if empty {
            let _ = std::fs::remove_dir(directory);
        }
    }
}
