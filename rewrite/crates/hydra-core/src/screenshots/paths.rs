//! Where screenshots go: screenshots/screenshot-file-path.ts,
//! achievement-screenshot-path.ts, achievement-screenshots-directory-path.ts
//! and screenshots/screenshots-folder.ts.

use std::path::{Component, Path, PathBuf};

use chrono::{Datelike, Local, TimeZone, Timelike};
use sha2::{Digest, Sha256};

use super::preferences::truncate_utf16;

/// SCREENSHOTS_FOLDER_NAME: <Pictures>/Hydra
pub const SCREENSHOTS_FOLDER_NAME: &str = "Hydra";
const MANUAL_SCREENSHOT_EXTENSION: &str = "jpeg";
const ACHIEVEMENT_SCREENSHOT_EXTENSION: &str = "jpeg";
const MAX_SEGMENT_UTF16: usize = 120;

fn strip_trailing_dots_and_spaces(value: &str) -> &str {
    value.trim_end_matches(['.', ' '])
}

/// sanitizePathSegment: no control characters, no `<>:"/\|?*`, at most 120
/// UTF-16 units, no trailing dots or spaces; "unknown" when nothing is left.
pub fn sanitize_path_segment(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .filter(|c| (*c as u32) > 31)
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            other => other,
        })
        .collect();
    let first = strip_trailing_dots_and_spaces(&sanitized);
    let cut = truncate_utf16(first, MAX_SEGMENT_UTF16).trim();
    let result = strip_trailing_dots_and_spaces(cut);
    if result.is_empty() {
        "unknown".to_string()
    } else {
        result.to_string()
    }
}

/// WINDOWS_RESERVED_DEVICE_NAME: CON, PRN, AUX, NUL, CONIN$, CONOUT$,
/// CLOCK$, COM1-9 and LPT1-9 (plus the superscript digits), alone or before
/// an extension, get a trailing `_`.
fn reserved_device_prefix(name: &str) -> Option<usize> {
    let lower = name.to_lowercase();
    let mut candidates: Vec<String> = ["con", "prn", "aux", "nul", "conin$", "conout$", "clock$"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    for base in ["com", "lpt"] {
        for digit in ['1', '2', '3', '4', '5', '6', '7', '8', '9', '¹', '²', '³'] {
            candidates.push(format!("{base}{digit}"));
        }
    }
    // longest first, like the regex alternation would after backtracking
    candidates.sort_by_key(|c| std::cmp::Reverse(c.len()));
    for candidate in candidates {
        if !lower.starts_with(&candidate) {
            continue;
        }
        // lowercasing keeps byte lengths for these ASCII/superscript names
        let rest = &name[candidate.len()..];
        let after_spaces = rest.trim_start_matches(' ');
        if after_spaces.is_empty() || after_spaces.starts_with('.') {
            return Some(candidate.len());
        }
    }
    None
}

/// toScreenshotFolderName
pub fn screenshot_folder_name(game_title: &str) -> String {
    let replaced: String = game_title
        .chars()
        .map(|c| if c == '#' || c == '%' { '_' } else { c })
        .collect();
    let sanitized = sanitize_path_segment(&replaced);
    match reserved_device_prefix(&sanitized) {
        Some(end) => format!("{}_{}", &sanitized[..end], &sanitized[end..]),
        None => sanitized,
    }
}

/// formatScreenshotTimestamp: local time, `2026-11-08_14-03-09-042`.
pub fn format_timestamp(captured_at_ms: i64) -> String {
    let date = Local
        .timestamp_millis_opt(captured_at_ms)
        .single()
        .unwrap_or_else(Local::now);
    format!(
        "{:04}-{:02}-{:02}_{:02}-{:02}-{:02}-{:03}",
        date.year(),
        date.month(),
        date.day(),
        date.hour(),
        date.minute(),
        date.second(),
        date.timestamp_subsec_millis()
    )
}

/// resolveManualScreenshotPath: <root>/<game>/<timestamp>[-<suffix>].jpeg
pub fn manual_screenshot_path(
    root: &Path,
    game_title: &str,
    captured_at_ms: i64,
    suffix: Option<&str>,
) -> PathBuf {
    let suffix = suffix
        .filter(|s| !s.is_empty() && *s != "0")
        .map(|s| format!("-{s}"))
        .unwrap_or_default();
    root.join(screenshot_folder_name(game_title)).join(format!(
        "{}{suffix}.{MANUAL_SCREENSHOT_EXTENSION}",
        format_timestamp(captured_at_ms)
    ))
}

fn stable_suffix(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest.iter().take(6).map(|b| format!("{b:02x}")).collect()
}

/// resolveAchievementScreenshotPath:
/// <root>/<game>-<sha256(gameId)[..12]>/<achievement>-<sha256(achievementId)[..12]>.jpeg
pub fn achievement_screenshot_path(
    root: &Path,
    game_title: &str,
    achievement_display_name: &str,
    game_id: &str,
    achievement_id: &str,
) -> PathBuf {
    root.join(format!(
        "{}-{}",
        sanitize_path_segment(game_title),
        stable_suffix(game_id)
    ))
    .join(format!(
        "{}-{}.{ACHIEVEMENT_SCREENSHOT_EXTENSION}",
        sanitize_path_segment(achievement_display_name),
        stable_suffix(achievement_id)
    ))
}

/// path.normalize: drop `.`, fold `..`, keep the root.
pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// resolveAchievementScreenshotsDirectory (also used for the screenshots
/// folder): a trimmed absolute preference, normalized; else the default.
pub fn resolve_directory(preferred: Option<&str>, default: &Path) -> PathBuf {
    match preferred.map(str::trim).filter(|p| !p.is_empty()) {
        Some(path) if Path::new(path).is_absolute() => normalize(Path::new(path)),
        _ => default.to_path_buf(),
    }
}

/// getScreenshotsRoot: the folder above the game folder.
pub fn screenshots_root(screenshot_path: &Path) -> PathBuf {
    screenshot_path
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_segments_like_electron() {
        assert_eq!(sanitize_path_segment("Half-Life: Alyx"), "Half-Life_ Alyx");
        assert_eq!(sanitize_path_segment("a/b\\c?*"), "a_b_c__");
        assert_eq!(sanitize_path_segment("  ...  "), "unknown");
        assert_eq!(sanitize_path_segment("Name. . "), "Name");
        assert_eq!(sanitize_path_segment("tab\there"), "tabhere");
        let long = "x".repeat(130);
        assert_eq!(sanitize_path_segment(&long).len(), 120);
    }

    #[test]
    fn folder_names_avoid_device_names() {
        assert_eq!(screenshot_folder_name("CON"), "CON_");
        assert_eq!(screenshot_folder_name("con.txt"), "con_.txt");
        assert_eq!(screenshot_folder_name("COM1 .x"), "COM1_ .x");
        assert_eq!(screenshot_folder_name("Console Wars"), "Console Wars");
        assert_eq!(screenshot_folder_name("lpt²"), "lpt²_");
        assert_eq!(screenshot_folder_name("C# 100%"), "C_ 100_");
    }

    #[test]
    fn manual_paths_have_timestamps_and_suffixes() {
        let root = Path::new("/pics/Hydra");
        let at = Local
            .with_ymd_and_hms(2026, 11, 8, 14, 3, 9)
            .unwrap()
            .timestamp_millis()
            + 42;
        assert_eq!(
            manual_screenshot_path(root, "Hades", at, None),
            root.join("Hades").join("2026-11-08_14-03-09-042.jpeg")
        );
        assert_eq!(
            manual_screenshot_path(root, "Hades", at, Some("3")),
            root.join("Hades").join("2026-11-08_14-03-09-042-3.jpeg")
        );
        assert_eq!(
            screenshots_root(&manual_screenshot_path(root, "Hades", at, None)),
            root
        );
    }

    #[test]
    fn achievement_paths_use_stable_hashes() {
        let path = achievement_screenshot_path(
            Path::new("/s"),
            "Cyberpunk 2077",
            "Breathtaking",
            "1091500",
            "ACH_1",
        );
        let game = format!("Cyberpunk 2077-{}", stable_suffix("1091500"));
        assert_eq!(
            path.parent()
                .unwrap()
                .file_name()
                .unwrap()
                .to_str()
                .unwrap(),
            game
        );
        assert!(path.to_string_lossy().ends_with(".jpeg"));
        assert_eq!(stable_suffix("abc"), "ba7816bf8f01");
    }

    #[test]
    fn resolves_directories() {
        let default = Path::new("/default");
        assert_eq!(resolve_directory(None, default), default);
        assert_eq!(resolve_directory(Some("  "), default), default);
        assert_eq!(resolve_directory(Some("relative/dir"), default), default);
        #[cfg(windows)]
        assert_eq!(
            resolve_directory(Some(" C:\\Shots\\.\\a\\..\\b "), default),
            PathBuf::from("C:\\Shots\\b")
        );
        #[cfg(not(windows))]
        assert_eq!(
            resolve_directory(Some(" /shots/./a/../b "), default),
            PathBuf::from("/shots/b")
        );
    }
}
