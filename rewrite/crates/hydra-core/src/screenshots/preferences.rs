//! shared/screenshot-preferences.ts, shared/screenshot-input.ts,
//! shared/local-screenshots.ts and the upload error keys: the screenshot
//! settings as the service reads them, and the hotkey / gamepad rules the
//! Settings → Screenshots tab validates with.

use serde_json::{Map, Value};

/// A keyboard binding (ScreenshotHotkeyBinding). `key` is a KeyboardEvent.code.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hotkey {
    pub key: String,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

impl Hotkey {
    /// DEFAULT_SCREENSHOT_HOTKEY
    pub fn default_binding() -> Hotkey {
        Hotkey {
            key: "F10".into(),
            ctrl: false,
            alt: false,
            shift: false,
        }
    }

    /// The JSON stored in `userPreferences.screenshotHotkey`.
    pub fn to_json(&self) -> Value {
        serde_json::json!({ "key": self.key, "ctrl": self.ctrl, "alt": self.alt, "shift": self.shift })
    }
}

/// SCREENSHOT_GAMEPAD_BUTTONS, in display order.
pub const GAMEPAD_BUTTONS: [&str; 16] = [
    "a",
    "b",
    "x",
    "y",
    "lb",
    "rb",
    "lt",
    "rt",
    "back",
    "start",
    "ls",
    "rs",
    "dpadUp",
    "dpadDown",
    "dpadLeft",
    "dpadRight",
];
/// DEFAULT_SCREENSHOT_GAMEPAD_COMBO
pub const DEFAULT_GAMEPAD_COMBO: [&str; 2] = ["back", "ls"];
pub const GAMEPAD_COMBO_MIN_BUTTONS: usize = 2;
pub const GAMEPAD_COMBO_MAX_BUTTONS: usize = 4;

/// SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH
pub const CUSTOM_GAME_TITLE_MAX_LENGTH: usize = 100;
/// SCREENSHOT_DESCRIPTION_MAX_LENGTH (UTF-16 code units, like String.slice)
pub const DESCRIPTION_MAX_LENGTH: usize = 200;
/// SCREENSHOT_VISIBILITY_OPTIONS
pub const VISIBILITY_OPTIONS: [&str; 3] = ["PUBLIC", "FRIENDS", "PRIVATE"];

const PUNCTUATION_KEYS: [&str; 11] = [
    "Backquote",
    "Minus",
    "Equal",
    "BracketLeft",
    "BracketRight",
    "Backslash",
    "Semicolon",
    "Quote",
    "Comma",
    "Period",
    "Slash",
];
const TYPING_CONTROL_KEYS: [&str; 4] = ["Space", "Enter", "Tab", "Backspace"];
const ARROW_KEYS: [&str; 4] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const NAVIGATION_KEYS: [&str; 6] = ["Insert", "Delete", "Home", "End", "PageUp", "PageDown"];
const SYSTEM_KEYS: [&str; 4] = ["Escape", "PrintScreen", "ScrollLock", "Pause"];
const NUMPAD_KEYS: [&str; 6] = [
    "NumpadAdd",
    "NumpadSubtract",
    "NumpadMultiply",
    "NumpadDivide",
    "NumpadDecimal",
    "NumpadEnter",
];

fn is_letter_key(key: &str) -> bool {
    key.len() == 4 && key.starts_with("Key") && key.as_bytes()[3].is_ascii_uppercase()
}

fn is_digit_key(key: &str) -> bool {
    key.len() == 6 && key.starts_with("Digit") && key.as_bytes()[5].is_ascii_digit()
}

fn is_numpad_digit_key(key: &str) -> bool {
    key.len() == 7 && key.starts_with("Numpad") && key.as_bytes()[6].is_ascii_digit()
}

fn is_function_key(key: &str) -> bool {
    key.strip_prefix('F')
        .and_then(|n| n.parse::<u8>().ok().filter(|_| !n.starts_with('0')))
        .is_some_and(|n| (1..=24).contains(&n))
}

/// SCREENSHOT_HOTKEY_KEYS, in the renderer's order.
pub fn hotkey_keys() -> Vec<String> {
    let mut keys: Vec<String> = (1..=24).map(|n| format!("F{n}")).collect();
    keys.extend(('A'..='Z').map(|c| format!("Key{c}")));
    keys.extend(('0'..='9').map(|c| format!("Digit{c}")));
    keys.extend(('0'..='9').map(|c| format!("Numpad{c}")));
    keys.extend(NUMPAD_KEYS.iter().map(|k| k.to_string()));
    for group in [
        &PUNCTUATION_KEYS[..],
        &TYPING_CONTROL_KEYS,
        &ARROW_KEYS,
        &NAVIGATION_KEYS,
        &SYSTEM_KEYS,
    ] {
        keys.extend(group.iter().map(|k| k.to_string()));
    }
    keys
}

fn is_supported_key(key: &str) -> bool {
    is_function_key(key)
        || is_letter_key(key)
        || is_digit_key(key)
        || is_numpad_digit_key(key)
        || [
            &NUMPAD_KEYS[..],
            &PUNCTUATION_KEYS,
            &TYPING_CONTROL_KEYS,
            &ARROW_KEYS,
            &NAVIGATION_KEYS,
            &SYSTEM_KEYS,
        ]
        .iter()
        .any(|group| group.contains(&key))
}

/// KEYS_REQUIRING_MODIFIER
fn requires_modifier(key: &str) -> bool {
    is_letter_key(key)
        || is_digit_key(key)
        || is_numpad_digit_key(key)
        || PUNCTUATION_KEYS.contains(&key)
        || TYPING_CONTROL_KEYS.contains(&key)
        || ARROW_KEYS.contains(&key)
}

/// ScreenshotHotkeyError
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HotkeyError {
    Reserved,
    ModifierRequired,
    UnsupportedKey,
}

impl HotkeyError {
    /// The `settings` translation key the tab shows.
    pub fn as_str(self) -> &'static str {
        match self {
            HotkeyError::Reserved => "hotkey_reserved",
            HotkeyError::ModifierRequired => "hotkey_modifier_required",
            HotkeyError::UnsupportedKey => "hotkey_unsupported_key",
        }
    }
}

/// isReservedHotkey
fn is_reserved(key: &str, ctrl: bool, alt: bool, meta: bool) -> bool {
    if meta || key == "Escape" {
        return true;
    }
    if alt && (key == "F4" || key == "Tab") {
        return true;
    }
    if alt && !ctrl && key == "Space" {
        return true;
    }
    if ctrl && alt && (key == "Delete" || key == "Backspace") {
        return true;
    }
    ctrl && alt
        && key
            .strip_prefix('F')
            .and_then(|n| n.parse::<u8>().ok().filter(|_| !n.starts_with('0')))
            .is_some_and(|n| (1..=12).contains(&n))
}

/// validateScreenshotHotkey (`meta` is the Windows/Command key)
pub fn validate_hotkey(hotkey: &Hotkey, meta: bool) -> Result<(), HotkeyError> {
    if !is_supported_key(&hotkey.key) {
        return Err(HotkeyError::UnsupportedKey);
    }
    if is_reserved(&hotkey.key, hotkey.ctrl, hotkey.alt, meta) {
        return Err(HotkeyError::Reserved);
    }
    if requires_modifier(&hotkey.key) && !hotkey.ctrl && !hotkey.alt {
        return Err(HotkeyError::ModifierRequired);
    }
    Ok(())
}

/// normalizeScreenshotHotkey: a valid stored binding, else F10.
pub fn normalize_hotkey(value: Option<&Value>) -> Hotkey {
    let parsed = value.and_then(Value::as_object).and_then(|binding| {
        Some(Hotkey {
            key: binding.get("key")?.as_str()?.to_string(),
            ctrl: binding.get("ctrl")?.as_bool()?,
            alt: binding.get("alt")?.as_bool()?,
            shift: binding.get("shift")?.as_bool()?,
        })
    });
    match parsed {
        Some(hotkey) if validate_hotkey(&hotkey, false).is_ok() => hotkey,
        _ => Hotkey::default_binding(),
    }
}

/// formatScreenshotHotkeyKey: KeyA → A, Digit1 → 1
pub fn format_hotkey_key(key: &str) -> String {
    for prefix in ["Key", "Digit"] {
        if let Some(rest) = key.strip_prefix(prefix) {
            if !rest.is_empty() {
                return rest.to_string();
            }
        }
    }
    key.to_string()
}

/// formatScreenshotHotkey: "Ctrl + Alt + F10"
pub fn format_hotkey(hotkey: &Hotkey) -> String {
    let mut parts = Vec::new();
    if hotkey.ctrl {
        parts.push("Ctrl".to_string());
    }
    if hotkey.alt {
        parts.push("Alt".to_string());
    }
    if hotkey.shift {
        parts.push("Shift".to_string());
    }
    parts.push(format_hotkey_key(&hotkey.key));
    parts.join(" + ")
}

/// toAcceleratorKey (Electron accelerator names, for the portal shortcut)
fn accelerator_key(key: &str) -> Option<String> {
    let named = match key {
        "NumpadAdd" => Some("numadd"),
        "NumpadSubtract" => Some("numsub"),
        "NumpadMultiply" => Some("nummult"),
        "NumpadDivide" => Some("numdiv"),
        "NumpadDecimal" => Some("numdec"),
        "Backquote" => Some("`"),
        "Minus" => Some("-"),
        "Equal" => Some("="),
        "BracketLeft" => Some("["),
        "BracketRight" => Some("]"),
        "Backslash" => Some("\\"),
        "Semicolon" => Some(";"),
        "Quote" => Some("'"),
        "Comma" => Some(","),
        "Period" => Some("."),
        "Slash" => Some("/"),
        "ArrowUp" => Some("Up"),
        "ArrowDown" => Some("Down"),
        "ArrowLeft" => Some("Left"),
        "ArrowRight" => Some("Right"),
        "ScrollLock" => Some("Scrolllock"),
        _ => None,
    };
    if let Some(named) = named {
        return Some(named.to_string());
    }
    if is_function_key(key)
        || TYPING_CONTROL_KEYS.contains(&key)
        || NAVIGATION_KEYS.contains(&key)
        || key == "Escape"
        || key == "PrintScreen"
    {
        return Some(key.to_string());
    }
    if is_letter_key(key) {
        return Some(key[3..].to_string());
    }
    if is_digit_key(key) {
        return Some(key[5..].to_string());
    }
    if is_numpad_digit_key(key) {
        return Some(format!("num{}", &key[6..]));
    }
    None
}

/// toScreenshotHotkeyAccelerator: None for keys an accelerator can't name
/// (the "hotkey_portal_unsupported_key" hint).
pub fn to_accelerator(hotkey: &Hotkey) -> Option<String> {
    let key = accelerator_key(&hotkey.key)?;
    let mut parts = Vec::new();
    if hotkey.ctrl {
        parts.push("Control".to_string());
    }
    if hotkey.alt {
        parts.push("Alt".to_string());
    }
    if hotkey.shift {
        parts.push("Shift".to_string());
    }
    parts.push(key);
    Some(parts.join("+"))
}

/// ScreenshotGamepadComboError
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ComboError {
    TooShort,
    TooLong,
    UnsupportedButton,
}

impl ComboError {
    pub fn as_str(self) -> &'static str {
        match self {
            ComboError::TooShort => "gamepad_combo_too_short",
            ComboError::TooLong => "gamepad_combo_too_long",
            ComboError::UnsupportedButton => "gamepad_combo_unsupported_button",
        }
    }
}

/// validateScreenshotGamepadCombo
pub fn validate_gamepad_combo<S: AsRef<str>>(buttons: &[S]) -> Result<(), ComboError> {
    if buttons
        .iter()
        .any(|button| !GAMEPAD_BUTTONS.contains(&button.as_ref()))
    {
        return Err(ComboError::UnsupportedButton);
    }
    let unique: std::collections::HashSet<&str> = buttons.iter().map(AsRef::as_ref).collect();
    if unique.len() < GAMEPAD_COMBO_MIN_BUTTONS {
        return Err(ComboError::TooShort);
    }
    if unique.len() > GAMEPAD_COMBO_MAX_BUTTONS {
        return Err(ComboError::TooLong);
    }
    Ok(())
}

/// normalizeScreenshotGamepadCombo: a valid stored combo in display order,
/// else Back + LS.
pub fn normalize_gamepad_combo(value: Option<&Value>) -> Vec<String> {
    let buttons: Option<Vec<&str>> = value
        .and_then(Value::as_array)
        .and_then(|items| items.iter().map(Value::as_str).collect());
    match buttons {
        Some(buttons) if validate_gamepad_combo(&buttons).is_ok() => GAMEPAD_BUTTONS
            .iter()
            .filter(|button| buttons.contains(button))
            .map(|button| button.to_string())
            .collect(),
        _ => DEFAULT_GAMEPAD_COMBO
            .iter()
            .map(|b| b.to_string())
            .collect(),
    }
}

/// isSameScreenshotGamepadCombo
pub fn same_gamepad_combo(left: &[String], right: &[String]) -> bool {
    left.len() == right.len() && left.iter().all(|button| right.contains(button))
}

/// ResolvedScreenshotPreferences
#[derive(Clone, Debug, PartialEq)]
pub struct ScreenshotPreferences {
    pub enabled: bool,
    pub hotkey: Hotkey,
    pub gamepad_enabled: bool,
    pub gamepad_combo: Vec<String>,
    pub capture_sound_enabled: bool,
    pub toast_enabled: bool,
    /// "PUBLIC" | "FRIENDS" | "PRIVATE"
    pub default_visibility: String,
    pub show_sensitive: bool,
    pub hide_community: bool,
}

fn flag(preferences: &Map<String, Value>, key: &str, default: bool) -> bool {
    preferences
        .get(key)
        .and_then(Value::as_bool)
        .unwrap_or(default)
}

/// resolveScreenshotPreferences
pub fn resolve(preferences: &Map<String, Value>) -> ScreenshotPreferences {
    ScreenshotPreferences {
        enabled: flag(preferences, "screenshotsEnabled", true),
        hotkey: normalize_hotkey(preferences.get("screenshotHotkey")),
        gamepad_enabled: flag(preferences, "screenshotGamepadEnabled", true),
        gamepad_combo: normalize_gamepad_combo(preferences.get("screenshotGamepadCombo")),
        capture_sound_enabled: flag(preferences, "screenshotCaptureSoundEnabled", true),
        toast_enabled: flag(preferences, "screenshotToastEnabled", true),
        default_visibility: preferences
            .get("screenshotDefaultVisibility")
            .and_then(Value::as_str)
            .unwrap_or("PUBLIC")
            .to_string(),
        show_sensitive: flag(preferences, "showSensitiveScreenshots", false),
        hide_community: flag(preferences, "hideCommunityScreenshots", false),
    }
}

/// The first `max` UTF-16 code units of `value`, never splitting a surrogate
/// pair (String.slice + the TRAILING_HIGH_SURROGATE cleanup).
pub fn truncate_utf16(value: &str, max: usize) -> &str {
    let mut units = 0;
    for (index, character) in value.char_indices() {
        units += character.len_utf16();
        if units > max {
            return &value[..index];
        }
    }
    value
}

/// sanitizeScreenshotDescriptionInput: line breaks to one space, control
/// characters out, at most 200 UTF-16 units.
pub fn sanitize_description_input(value: &str) -> String {
    let mut collapsed = String::with_capacity(value.len());
    let mut in_break = false;
    for character in value.chars() {
        if matches!(character, '\r' | '\n' | '\u{2028}' | '\u{2029}') {
            if !in_break {
                collapsed.push(' ');
            }
            in_break = true;
            continue;
        }
        in_break = false;
        collapsed.push(character);
    }
    let stripped: String = collapsed
        .chars()
        .filter(|c| {
            let code = *c as u32;
            code >= 32 && !(127..=159).contains(&code)
        })
        .collect();
    truncate_utf16(&stripped, DESCRIPTION_MAX_LENGTH).to_string()
}

/// normalizeScreenshotDescription: trimmed, None when empty.
pub fn normalize_description(value: Option<&str>) -> Option<String> {
    let value = value.filter(|v| !v.is_empty())?;
    let normalized = sanitize_description_input(value).trim().to_string();
    (!normalized.is_empty()).then_some(normalized)
}

/// resolveScreenshotUploadQuality
pub fn upload_quality(has_cloud_subscription: bool) -> &'static str {
    if has_cloud_subscription {
        "CLOUD"
    } else {
        "STANDARD"
    }
}

/// getScreenshotUploadErrorKey (`screenshots_capture` namespace)
pub fn upload_error_key(code: Option<&str>) -> &'static str {
    match code {
        Some("screenshots/limit-reached") => "error_limit_reached",
        Some("screenshots/blocked-limit-reached") => "error_upload_blocked",
        Some("screenshot_missing") => "error_missing_file",
        Some("screenshot_too_large") => "error_too_large",
        Some("screenshot_unreadable") => "error_unreadable",
        Some("feature/feature-not-enabled") => "error_feature_disabled",
        _ => "error_generic",
    }
}

/// isScreenshotUploadRetryable
pub fn is_upload_retryable(code: Option<&str>) -> bool {
    !matches!(
        code,
        Some(
            "screenshots/limit-reached"
                | "screenshots/blocked-limit-reached"
                | "screenshot_missing"
                | "screenshot_too_large"
                | "screenshot_unreadable"
        )
    )
}

/// getScreenshotModerationReasonKey (`screenshots_moderation` namespace)
pub fn moderation_reason_key(reason: Option<&str>) -> &'static str {
    match reason {
        Some("explicit_imagery") => "explicit_imagery",
        Some("hate_symbols") => "hate_symbols",
        Some("invalid_image") => "invalid_image",
        Some("moderation_failed") => "moderation_failed",
        Some("personal_information") => "personal_information",
        Some("real_world_gore") => "real_world_gore",
        _ => "generic",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn hotkey(key: &str, ctrl: bool, alt: bool, shift: bool) -> Hotkey {
        Hotkey {
            key: key.into(),
            ctrl,
            alt,
            shift,
        }
    }

    #[test]
    fn defaults_when_nothing_is_stored() {
        let resolved = resolve(&Map::new());
        assert!(resolved.enabled && resolved.gamepad_enabled);
        assert!(resolved.capture_sound_enabled && resolved.toast_enabled);
        assert_eq!(resolved.hotkey, Hotkey::default_binding());
        assert_eq!(resolved.gamepad_combo, vec!["back", "ls"]);
        assert_eq!(resolved.default_visibility, "PUBLIC");
        assert!(!resolved.show_sensitive && !resolved.hide_community);
    }

    #[test]
    fn validates_hotkeys_like_the_renderer() {
        assert_eq!(
            validate_hotkey(&hotkey("F10", false, false, false), false),
            Ok(())
        );
        assert_eq!(
            validate_hotkey(&hotkey("KeyS", false, false, true), false),
            Err(HotkeyError::ModifierRequired)
        );
        assert_eq!(
            validate_hotkey(&hotkey("KeyS", true, false, false), false),
            Ok(())
        );
        assert_eq!(
            validate_hotkey(&hotkey("F4", false, true, false), false),
            Err(HotkeyError::Reserved)
        );
        assert_eq!(
            validate_hotkey(&hotkey("F12", true, true, false), false),
            Err(HotkeyError::Reserved)
        );
        assert_eq!(
            validate_hotkey(&hotkey("F13", true, true, false), false),
            Ok(())
        );
        assert_eq!(
            validate_hotkey(&hotkey("Space", false, true, false), false),
            Err(HotkeyError::Reserved)
        );
        assert_eq!(
            validate_hotkey(&hotkey("Space", true, true, false), false),
            Ok(())
        );
        assert_eq!(
            validate_hotkey(&hotkey("F10", false, false, false), true),
            Err(HotkeyError::Reserved)
        );
        assert_eq!(
            validate_hotkey(&hotkey("MetaLeft", false, false, false), false),
            Err(HotkeyError::UnsupportedKey)
        );
        assert_eq!(
            validate_hotkey(&hotkey("F25", false, false, false), false),
            Err(HotkeyError::UnsupportedKey)
        );
        assert_eq!(
            hotkey_keys().len(),
            24 + 26 + 10 + 10 + 6 + 11 + 4 + 4 + 6 + 4
        );
    }

    #[test]
    fn normalizes_stored_bindings() {
        let stored = json!({ "key": "KeyP", "ctrl": true, "alt": false, "shift": true });
        assert_eq!(
            normalize_hotkey(Some(&stored)),
            hotkey("KeyP", true, false, true)
        );
        let invalid = json!({ "key": "KeyP", "ctrl": false, "alt": false, "shift": false });
        assert_eq!(normalize_hotkey(Some(&invalid)), Hotkey::default_binding());
        assert_eq!(
            normalize_hotkey(Some(&json!("F9"))),
            Hotkey::default_binding()
        );

        assert_eq!(
            normalize_gamepad_combo(Some(&json!(["rb", "a", "rb"]))),
            vec!["a", "rb"]
        );
        assert_eq!(
            normalize_gamepad_combo(Some(&json!(["a"]))),
            vec!["back", "ls"]
        );
        assert_eq!(
            normalize_gamepad_combo(Some(&json!(["a", "b", "x", "y", "lb"]))),
            vec!["back", "ls"]
        );
        assert_eq!(
            normalize_gamepad_combo(Some(&json!(["a", "turbo"]))),
            vec!["back", "ls"]
        );
    }

    #[test]
    fn formats_and_names_accelerators() {
        let binding = hotkey("KeyS", true, true, false);
        assert_eq!(format_hotkey(&binding), "Ctrl + Alt + S");
        assert_eq!(to_accelerator(&binding).as_deref(), Some("Control+Alt+S"));
        assert_eq!(
            to_accelerator(&hotkey("Numpad5", true, false, false)).as_deref(),
            Some("Control+num5")
        );
        assert_eq!(
            to_accelerator(&hotkey("ArrowUp", false, true, false)).as_deref(),
            Some("Alt+Up")
        );
        assert_eq!(to_accelerator(&hotkey("Pause", false, false, false)), None);
        assert_eq!(
            to_accelerator(&hotkey("NumpadEnter", false, false, false)),
            None
        );
    }

    #[test]
    fn normalizes_descriptions() {
        assert_eq!(normalize_description(None), None);
        assert_eq!(normalize_description(Some("   ")), None);
        assert_eq!(
            normalize_description(Some(" Boss\r\n\nfight\u{7}! ")).as_deref(),
            Some("Boss fight!")
        );
        let long = "😀".repeat(150); // 300 UTF-16 units
        let cut = sanitize_description_input(&long);
        assert_eq!(cut.encode_utf16().count(), 200);
        let odd = format!("{}😀", "a".repeat(199));
        assert_eq!(sanitize_description_input(&odd), "a".repeat(199));
    }

    #[test]
    fn upload_error_keys() {
        assert_eq!(
            upload_error_key(Some("screenshot_missing")),
            "error_missing_file"
        );
        assert_eq!(
            upload_error_key(Some("feature/feature-not-enabled")),
            "error_feature_disabled"
        );
        assert_eq!(upload_error_key(None), "error_generic");
        assert!(is_upload_retryable(Some("feature/feature-not-enabled")));
        assert!(!is_upload_retryable(Some("screenshot_too_large")));
        assert_eq!(moderation_reason_key(Some("hate_symbols")), "hate_symbols");
        assert_eq!(moderation_reason_key(Some("nope")), "generic");
    }
}
