//! Screenshot capture preferences: shared/screenshot-input.ts (hotkey and
//! gamepad combo validation) and shared/screenshot-preferences.ts
//! (resolveScreenshotPreferences, formatScreenshotHotkey).

use serde_json::{Map, Value, json};

/// ScreenshotHotkeyBinding (`key` is a DOM KeyboardEvent.code)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hotkey {
    pub key: String,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

impl Default for Hotkey {
    /// DEFAULT_SCREENSHOT_HOTKEY
    fn default() -> Self {
        Self {
            key: "F10".into(),
            ctrl: false,
            alt: false,
            shift: false,
        }
    }
}

impl Hotkey {
    pub fn to_value(&self) -> Value {
        json!({ "key": self.key, "ctrl": self.ctrl, "alt": self.alt, "shift": self.shift })
    }
}

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
pub const DEFAULT_GAMEPAD_COMBO: [&str; 2] = ["back", "ls"];
pub const COMBO_MIN: usize = 2;
pub const COMBO_MAX: usize = 4;

const PUNCTUATION: [&str; 11] = [
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
const TYPING_CONTROL: [&str; 4] = ["Space", "Enter", "Tab", "Backspace"];
const ARROWS: [&str; 4] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const NAVIGATION: [&str; 6] = ["Insert", "Delete", "Home", "End", "PageUp", "PageDown"];
const SYSTEM: [&str; 4] = ["Escape", "PrintScreen", "ScrollLock", "Pause"];
const NUMPAD_OTHER: [&str; 6] = [
    "NumpadAdd",
    "NumpadSubtract",
    "NumpadMultiply",
    "NumpadDivide",
    "NumpadDecimal",
    "NumpadEnter",
];

fn suffix_of<'a>(key: &'a str, prefix: &str) -> Option<&'a str> {
    key.strip_prefix(prefix).filter(|rest| !rest.is_empty())
}

fn is_letter(key: &str) -> bool {
    suffix_of(key, "Key").is_some_and(|c| c.len() == 1 && c.chars().all(|c| c.is_ascii_uppercase()))
}
fn is_digit(key: &str) -> bool {
    suffix_of(key, "Digit").is_some_and(|c| c.len() == 1 && c.chars().all(|c| c.is_ascii_digit()))
}
fn is_numpad_digit(key: &str) -> bool {
    suffix_of(key, "Numpad").is_some_and(|c| c.len() == 1 && c.chars().all(|c| c.is_ascii_digit()))
}
fn is_function(key: &str) -> bool {
    suffix_of(key, "F")
        .and_then(|n| n.parse::<u8>().ok().filter(|_| !n.starts_with('0')))
        .is_some_and(|n| (1..=24).contains(&n))
}

/// SCREENSHOT_HOTKEY_KEYS
pub fn is_supported_key(key: &str) -> bool {
    is_function(key)
        || is_letter(key)
        || is_digit(key)
        || is_numpad_digit(key)
        || NUMPAD_OTHER.contains(&key)
        || PUNCTUATION.contains(&key)
        || TYPING_CONTROL.contains(&key)
        || ARROWS.contains(&key)
        || NAVIGATION.contains(&key)
        || SYSTEM.contains(&key)
}

fn requires_modifier(key: &str) -> bool {
    is_letter(key)
        || is_digit(key)
        || is_numpad_digit(key)
        || PUNCTUATION.contains(&key)
        || TYPING_CONTROL.contains(&key)
        || ARROWS.contains(&key)
}

/// validateScreenshotHotkey: None when valid, else the screenshots_input key.
pub fn validate_hotkey(hotkey: &Hotkey, meta: bool) -> Option<&'static str> {
    let key = hotkey.key.as_str();
    if !is_supported_key(key) {
        return Some("hotkey_unsupported_key");
    }
    let reserved = meta
        || key == "Escape"
        || (hotkey.alt && (key == "F4" || key == "Tab"))
        || (hotkey.alt && !hotkey.ctrl && key == "Space")
        || (hotkey.ctrl && hotkey.alt && (key == "Delete" || key == "Backspace"))
        || (hotkey.ctrl
            && hotkey.alt
            && suffix_of(key, "F")
                .and_then(|n| n.parse::<u8>().ok())
                .is_some_and(|n| (1..=12).contains(&n)));
    if reserved {
        return Some("hotkey_reserved");
    }
    if requires_modifier(key) && !hotkey.ctrl && !hotkey.alt {
        return Some("hotkey_modifier_required");
    }
    None
}

/// normalizeScreenshotHotkey
pub fn normalize_hotkey(value: Option<&Value>) -> Hotkey {
    let parsed = value.and_then(|v| {
        Some(Hotkey {
            key: v.get("key")?.as_str()?.to_string(),
            ctrl: v.get("ctrl")?.as_bool()?,
            alt: v.get("alt")?.as_bool()?,
            shift: v.get("shift")?.as_bool()?,
        })
    });
    match parsed {
        Some(hotkey) if validate_hotkey(&hotkey, false).is_none() => hotkey,
        _ => Hotkey::default(),
    }
}

/// formatScreenshotHotkey: "Ctrl + Alt + S"
pub fn format_hotkey(hotkey: &Hotkey) -> String {
    let key = hotkey
        .key
        .strip_prefix("Key")
        .or_else(|| hotkey.key.strip_prefix("Digit"))
        .filter(|rest| !rest.is_empty())
        .unwrap_or(&hotkey.key);
    let mut parts = Vec::new();
    if hotkey.ctrl {
        parts.push("Ctrl");
    }
    if hotkey.alt {
        parts.push("Alt");
    }
    if hotkey.shift {
        parts.push("Shift");
    }
    parts.push(key);
    parts.join(" + ")
}

/// validateScreenshotGamepadCombo: None when valid.
pub fn validate_combo(buttons: &[String]) -> Option<&'static str> {
    if buttons
        .iter()
        .any(|b| !GAMEPAD_BUTTONS.contains(&b.as_str()))
    {
        return Some("gamepad_combo_unsupported_button");
    }
    let mut unique: Vec<&str> = buttons.iter().map(String::as_str).collect();
    unique.sort_unstable();
    unique.dedup();
    if unique.len() < COMBO_MIN {
        return Some("gamepad_combo_too_short");
    }
    if unique.len() > COMBO_MAX {
        return Some("gamepad_combo_too_long");
    }
    None
}

pub fn has_duplicates(buttons: &[String]) -> bool {
    buttons
        .iter()
        .enumerate()
        .any(|(i, b)| buttons[..i].contains(b))
}

/// normalizeScreenshotGamepadCombo: valid combos come back in button order.
pub fn normalize_combo(value: Option<&Value>) -> Vec<String> {
    let list: Option<Vec<String>> = value.and_then(Value::as_array).and_then(|a| {
        a.iter()
            .map(|v| v.as_str().map(str::to_string))
            .collect::<Option<Vec<_>>>()
    });
    match list {
        Some(list) if validate_combo(&list).is_none() => GAMEPAD_BUTTONS
            .iter()
            .filter(|b| list.iter().any(|l| l == *b))
            .map(|b| b.to_string())
            .collect(),
        _ => DEFAULT_GAMEPAD_COMBO
            .iter()
            .map(|b| b.to_string())
            .collect(),
    }
}

/// isSameScreenshotGamepadCombo (same length, same members)
pub fn same_combo(left: &[String], right: &[String]) -> bool {
    left.len() == right.len() && left.iter().all(|b| right.contains(b))
}

pub fn is_default_combo(combo: &[String]) -> bool {
    let default: Vec<String> = DEFAULT_GAMEPAD_COMBO
        .iter()
        .map(|b| b.to_string())
        .collect();
    same_combo(combo, &default)
}

/// resolveScreenshotPreferences
#[derive(Clone, Debug, PartialEq)]
pub struct Resolved {
    pub enabled: bool,
    pub hotkey: Hotkey,
    pub gamepad_enabled: bool,
    pub gamepad_combo: Vec<String>,
    pub capture_sound: bool,
    pub toast: bool,
    pub default_visibility: String,
    pub hide_community: bool,
}

pub fn resolve(p: &Map<String, Value>) -> Resolved {
    let flag = |key: &str, default: bool| p.get(key).and_then(Value::as_bool).unwrap_or(default);
    Resolved {
        enabled: flag("screenshotsEnabled", true),
        hotkey: normalize_hotkey(p.get("screenshotHotkey")),
        gamepad_enabled: flag("screenshotGamepadEnabled", true),
        gamepad_combo: normalize_combo(p.get("screenshotGamepadCombo")),
        capture_sound: flag("screenshotCaptureSoundEnabled", true),
        toast: flag("screenshotToastEnabled", true),
        default_visibility: p
            .get("screenshotDefaultVisibility")
            .and_then(Value::as_str)
            .unwrap_or("PUBLIC")
            .to_string(),
        hide_community: flag("hideCommunityScreenshots", false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(key: &str, ctrl: bool, alt: bool, shift: bool) -> Hotkey {
        Hotkey {
            key: key.into(),
            ctrl,
            alt,
            shift,
        }
    }

    #[test]
    fn hotkey_rules() {
        assert_eq!(validate_hotkey(&Hotkey::default(), false), None);
        assert_eq!(
            validate_hotkey(&key("F24", false, false, false), false),
            None
        );
        assert_eq!(
            validate_hotkey(&key("F25", false, false, false), false),
            Some("hotkey_unsupported_key")
        );
        assert_eq!(
            validate_hotkey(&key("KeyS", false, false, true), false),
            Some("hotkey_modifier_required")
        );
        assert_eq!(
            validate_hotkey(&key("KeyS", true, false, false), false),
            None
        );
        assert_eq!(
            validate_hotkey(&key("F4", false, true, false), false),
            Some("hotkey_reserved")
        );
        assert_eq!(
            validate_hotkey(&key("F5", true, true, false), false),
            Some("hotkey_reserved")
        );
        assert_eq!(validate_hotkey(&key("F13", true, true, false), false), None);
        assert_eq!(
            validate_hotkey(&key("F10", false, false, false), true),
            Some("hotkey_reserved")
        );
        assert_eq!(
            validate_hotkey(&key("Space", false, true, false), false),
            Some("hotkey_reserved")
        );
        assert_eq!(
            validate_hotkey(&key("Space", true, true, false), false),
            None
        );
        assert_eq!(
            validate_hotkey(&key("PrintScreen", false, false, false), false),
            None
        );
        assert_eq!(
            validate_hotkey(&key("Numpad5", true, false, false), false),
            None
        );
    }

    #[test]
    fn hotkey_format_and_normalize() {
        assert_eq!(format_hotkey(&Hotkey::default()), "F10");
        assert_eq!(
            format_hotkey(&key("KeyS", true, true, true)),
            "Ctrl + Alt + Shift + S"
        );
        assert_eq!(format_hotkey(&key("Digit1", false, true, false)), "Alt + 1");
        assert_eq!(normalize_hotkey(None), Hotkey::default());
        assert_eq!(
            normalize_hotkey(Some(
                &json!({ "key": "KeyS", "ctrl": false, "alt": false, "shift": false })
            )),
            Hotkey::default()
        );
        assert_eq!(
            normalize_hotkey(Some(
                &json!({ "key": "KeyS", "ctrl": true, "alt": false, "shift": false })
            )),
            key("KeyS", true, false, false)
        );
    }

    #[test]
    fn combo_rules() {
        let combo = |b: &[&str]| b.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(validate_combo(&combo(&["back", "ls"])), None);
        assert_eq!(
            validate_combo(&combo(&["back"])),
            Some("gamepad_combo_too_short")
        );
        assert_eq!(
            validate_combo(&combo(&["back", "back"])),
            Some("gamepad_combo_too_short")
        );
        assert_eq!(
            validate_combo(&combo(&["a", "b", "x", "y", "lb"])),
            Some("gamepad_combo_too_long")
        );
        assert_eq!(
            validate_combo(&combo(&["a", "home"])),
            Some("gamepad_combo_unsupported_button")
        );
        assert!(has_duplicates(&combo(&["a", "b", "a"])));
        assert_eq!(
            normalize_combo(Some(&json!(["ls", "back"]))),
            combo(&["back", "ls"])
        );
        assert_eq!(normalize_combo(Some(&json!(["a"]))), combo(&["back", "ls"]));
        assert!(is_default_combo(&combo(&["ls", "back"])));
        assert!(!is_default_combo(&combo(&["a", "b"])));
    }

    #[test]
    fn resolve_defaults() {
        let resolved = resolve(&Map::new());
        assert!(
            resolved.enabled
                && resolved.gamepad_enabled
                && resolved.capture_sound
                && resolved.toast
        );
        assert!(!resolved.hide_community);
        assert_eq!(resolved.default_visibility, "PUBLIC");
        assert_eq!(resolved.hotkey, Hotkey::default());
    }
}
