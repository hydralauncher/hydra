//! The in-game screenshot service's logic (src/main/services/screenshots,
//! shared/screenshot-*.ts): preferences, paths, the foreground match, the
//! local store, compression for upload, the retry policy and telemetry.
//! The app wires it to capture, input and the UI (hydra-desktop
//! `screenshots/`).

pub mod compression;
pub mod local;
pub mod matching;
pub mod paths;
pub mod preferences;
pub mod retry;
pub mod root_marker;
pub mod store;
pub mod telemetry;

pub use local::{Draft, LocalScreenshot};
pub use preferences::{Hotkey, ScreenshotPreferences};
pub use store::LocalScreenshotStore;

/// MAX_SCREENSHOT_HEIGHT (screenshot-size.ts)
pub const MAX_SCREENSHOT_HEIGHT: u32 = 1080;

/// fitScreenshotTo1080p: at most 1080px tall, keeping the aspect ratio.
pub fn fit_to_1080p(width: u32, height: u32) -> (u32, u32) {
    if height <= MAX_SCREENSHOT_HEIGHT {
        return (width, height);
    }
    let scale = f64::from(MAX_SCREENSHOT_HEIGHT) / f64::from(height);
    (
        (f64::from(width) * scale).round() as u32,
        MAX_SCREENSHOT_HEIGHT,
    )
}

/// The signed-in user's id: the `userId` claim of the stored access token
/// (HydraApi.getAuthContext().userId decodes the same JWT).
pub fn user_id_from_token(access_token: &str) -> Option<String> {
    let payload = access_token.split('.').nth(1)?;
    let bytes = base64url_decode(payload)?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    claims
        .get("userId")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn base64url_decode(input: &str) -> Option<Vec<u8>> {
    let mut bits = 0u32;
    let mut count = 0u32;
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    for byte in input.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            b'=' => continue,
            _ => return None,
        };
        bits = (bits << 6) | u32::from(value);
        count += 6;
        if count >= 8 {
            count -= 8;
            out.push((bits >> count) as u8);
            bits &= (1 << count) - 1;
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fits_to_1080p() {
        assert_eq!(fit_to_1080p(1920, 1080), (1920, 1080));
        assert_eq!(fit_to_1080p(3840, 2160), (1920, 1080));
        assert_eq!(fit_to_1080p(2560, 1600), (1728, 1080));
        assert_eq!(fit_to_1080p(800, 600), (800, 600));
    }

    #[test]
    fn reads_the_user_id_claim() {
        // {"userId":"abc123","exp":1}
        let token = "x.eyJ1c2VySWQiOiJhYmMxMjMiLCJleHAiOjF9.y";
        assert_eq!(user_id_from_token(token).as_deref(), Some("abc123"));
        assert_eq!(user_id_from_token("nope"), None);
    }
}
