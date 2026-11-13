//! pages/settings Screenshots tab (settings-context-screenshots.tsx and its
//! hotkey / gamepad pieces): the capture preferences, the default upload
//! visibility, the community toggle and the screenshots folder.
//!
//! The capture service itself (hotkey/gamepad input, ScreenshotInputService)
//! is ported separately; until then the status line shows the idle state.

use std::cell::RefCell;
use std::time::{Duration, Instant};

use hydra_core::screenshot_prefs::{self as sp, Hotkey};
use serde_json::{Map, Value, json};
use slint::platform::Key;
use slint::{ComponentHandle, ModelRc, SharedString, VecModel};

use crate::{AppWindow, ScreenshotsData, SelectOption, prefs, shell};

/// PRINT_SCREEN_MODIFIER_GRACE_MS
const PRINT_SCREEN_GRACE: Duration = Duration::from_millis(500);

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    /// the combo being edited (an invalid draft isn't saved)
    draft: Vec<String>,
    /// the saved combo the draft last followed
    saved: Vec<String>,
    /// modifier -> released at (None while held), for PrintScreen's keyup
    modifiers: [Option<Option<Instant>>; 4],
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn ui() -> Option<AppWindow> {
    with(|s| s.ui.upgrade())
}

fn t(key: &str) -> String {
    shell::tr(&format!("settings.{key}"))
}

pub fn init(window: &AppWindow) {
    with(|s| s.ui = window.as_weak());
    let data = window.global::<ScreenshotsData>();
    data.on_toggle(|key| toggle(&key));
    data.on_toggle_recording(|| {
        if let Some(ui) = ui() {
            let data = ui.global::<ScreenshotsData>();
            data.set_hotkey_error(Default::default());
            data.set_recording(!data.get_recording());
            with(|s| s.modifiers = Default::default());
        }
    });
    data.on_record_key(|text, ctrl, alt, shift, meta, pressed| {
        record_key(&text, [ctrl, alt, shift, meta], pressed)
    });
    data.on_reset_hotkey(|| {
        if let Some(ui) = ui() {
            ui.global::<ScreenshotsData>()
                .set_hotkey_error(Default::default());
        }
        save_hotkey(&Hotkey::default());
    });
    data.on_combo_selected(|index, value| {
        let mut draft = with(|s| s.draft.clone());
        if let Some(slot) = draft.get_mut(index as usize)
            && sp::GAMEPAD_BUTTONS.contains(&value.as_str())
        {
            *slot = value.to_string();
            update_draft(draft);
        }
    });
    data.on_combo_add(|| {
        let mut draft = with(|s| s.draft.clone());
        if let Some(unused) = sp::GAMEPAD_BUTTONS
            .iter()
            .find(|b| !draft.iter().any(|d| d == *b))
        {
            draft.push(unused.to_string());
            update_draft(draft);
        }
    });
    data.on_combo_remove(|index| {
        let mut draft = with(|s| s.draft.clone());
        if (index as usize) < draft.len() {
            draft.remove(index as usize);
            update_draft(draft);
        }
    });
    data.on_combo_reset(|| {
        update_draft(
            sp::DEFAULT_GAMEPAD_COMBO
                .iter()
                .map(|b| b.to_string())
                .collect(),
        )
    });
    data.on_visibility_selected(|value| {
        if ["PUBLIC", "FRIENDS", "PRIVATE"].contains(&value.as_str()) {
            prefs::update(Map::from_iter([(
                "screenshotDefaultVisibility".to_string(),
                json!(value.to_string()),
            )]));
            refresh();
        }
    });
    data.on_change_folder(change_folder);
    data.on_reset_folder(|| {
        // updateUserPreferences({ screenshotsFolderPath: undefined })
        let mut p = prefs::get();
        p.remove("screenshotsFolderPath");
        if let Some(db) = shell::db() {
            let _ = db.put(hydra_db::keys::USER_PREFERENCES, &p);
        }
        refresh();
    });
    data.on_open_folder(open_folder);
}

/// getDefaultScreenshotsFolder: <Pictures>/Hydra
fn default_folder() -> std::path::PathBuf {
    dirs::picture_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Pictures")))
        .unwrap_or_default()
        .join("Hydra")
}

/// getScreenshotsFolder (resolveAchievementScreenshotsDirectory): an
/// absolute preference, normalized, else the default.
pub fn folder(p: &Map<String, Value>) -> std::path::PathBuf {
    p.get("screenshotsFolderPath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty() && std::path::Path::new(s).is_absolute())
        .map(|s| std::path::PathBuf::from(s).components().collect())
        .unwrap_or_else(default_folder)
}

/// handleChooseScreenshotsPath
fn change_folder() {
    let current = folder(&prefs::get());
    if let Some(picked) = rfd::FileDialog::new().set_directory(&current).pick_folder() {
        prefs::update(Map::from_iter([(
            "screenshotsFolderPath".to_string(),
            json!(picked.to_string_lossy()),
        )]));
        refresh();
    }
}

/// openScreenshotsFolder: the first candidate that can be created
fn open_folder() {
    let mut candidates = vec![folder(&prefs::get()), default_folder()];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join("Pictures").join("Hydra"));
    }
    candidates.dedup();
    for directory in candidates {
        if std::fs::create_dir_all(&directory).is_err() {
            continue;
        }
        #[cfg(windows)]
        let _ = std::process::Command::new("explorer")
            .arg(&directory)
            .spawn();
        #[cfg(not(windows))]
        let _ = std::process::Command::new("xdg-open")
            .arg(&directory)
            .spawn();
        return;
    }
}

fn toggle(key: &str) {
    let resolved = sp::resolve(&prefs::get());
    let current = match key {
        "screenshotsEnabled" => resolved.enabled,
        "screenshotGamepadEnabled" => resolved.gamepad_enabled,
        "screenshotCaptureSoundEnabled" => resolved.capture_sound,
        "screenshotToastEnabled" => resolved.toast,
        "hideCommunityScreenshots" => resolved.hide_community,
        _ => return,
    };
    if key != "screenshotsEnabled" && key != "hideCommunityScreenshots" && !resolved.enabled {
        return;
    }
    prefs::update(Map::from_iter([(key.to_string(), json!(!current))]));
    // TODO(screenshots): ScreenshotInputService picks up the new preferences.
    if key == "screenshotsEnabled"
        && current
        && let Some(ui) = ui()
    {
        // disabled: stop recording
        ui.global::<ScreenshotsData>().set_recording(false);
    }
    refresh();
}

fn save_hotkey(hotkey: &Hotkey) {
    prefs::update(Map::from_iter([(
        "screenshotHotkey".to_string(),
        hotkey.to_value(),
    )]));
    refresh();
}

/// updateDraft: keep an invalid or duplicated draft on screen, save a valid one.
fn update_draft(next: Vec<String>) {
    with(|s| s.draft = next.clone());
    if sp::validate_combo(&next).is_none() && !sp::has_duplicates(&next) {
        prefs::update(Map::from_iter([(
            "screenshotGamepadCombo".to_string(),
            json!(next),
        )]));
    }
    refresh();
}

/// A DOM KeyboardEvent.code for a Slint key event (US layout for shifted
/// symbols; Slint reports characters, not physical keys).
pub fn key_code(text: &str) -> Option<String> {
    let mut chars = text.chars();
    let c = chars.next()?;
    if chars.next().is_some() {
        return None;
    }
    let named = |key: Key| -> bool { SharedString::from(key).as_str() == text };
    for n in 1..=24u8 {
        let key = match n {
            1 => Key::F1,
            2 => Key::F2,
            3 => Key::F3,
            4 => Key::F4,
            5 => Key::F5,
            6 => Key::F6,
            7 => Key::F7,
            8 => Key::F8,
            9 => Key::F9,
            10 => Key::F10,
            11 => Key::F11,
            12 => Key::F12,
            13 => Key::F13,
            14 => Key::F14,
            15 => Key::F15,
            16 => Key::F16,
            17 => Key::F17,
            18 => Key::F18,
            19 => Key::F19,
            20 => Key::F20,
            21 => Key::F21,
            22 => Key::F22,
            23 => Key::F23,
            _ => Key::F24,
        };
        if named(key) {
            return Some(format!("F{n}"));
        }
    }
    let table = [
        (Key::Escape, "Escape"),
        (Key::Return, "Enter"),
        (Key::Tab, "Tab"),
        (Key::Backtab, "Tab"),
        (Key::Backspace, "Backspace"),
        (Key::Delete, "Delete"),
        (Key::Insert, "Insert"),
        (Key::Home, "Home"),
        (Key::End, "End"),
        (Key::PageUp, "PageUp"),
        (Key::PageDown, "PageDown"),
        (Key::UpArrow, "ArrowUp"),
        (Key::DownArrow, "ArrowDown"),
        (Key::LeftArrow, "ArrowLeft"),
        (Key::RightArrow, "ArrowRight"),
        (Key::ScrollLock, "ScrollLock"),
        (Key::Pause, "Pause"),
        (Key::SysReq, "PrintScreen"),
        (Key::Space, "Space"),
    ];
    if let Some((_, code)) = table.iter().find(|(key, _)| named(key.clone())) {
        return Some(code.to_string());
    }
    if c.is_ascii_alphabetic() {
        return Some(format!("Key{}", c.to_ascii_uppercase()));
    }
    if c.is_ascii_digit() {
        return Some(format!("Digit{c}"));
    }
    let code = match c {
        '!' => "Digit1",
        '@' => "Digit2",
        '#' => "Digit3",
        '$' => "Digit4",
        '%' => "Digit5",
        '^' => "Digit6",
        '&' => "Digit7",
        '*' => "Digit8",
        '(' => "Digit9",
        ')' => "Digit0",
        '`' | '~' => "Backquote",
        '-' | '_' => "Minus",
        '=' | '+' => "Equal",
        '[' | '{' => "BracketLeft",
        ']' | '}' => "BracketRight",
        '\\' | '|' => "Backslash",
        ';' | ':' => "Semicolon",
        '\'' | '"' => "Quote",
        ',' | '<' => "Comma",
        '.' | '>' => "Period",
        '/' | '?' => "Slash",
        _ => return None,
    };
    Some(code.to_string())
}

fn modifier_index(text: &str) -> Option<usize> {
    let is = |key: Key| SharedString::from(key).as_str() == text;
    if is(Key::Control) || is(Key::ControlR) {
        Some(0)
    } else if is(Key::Alt) || is(Key::AltGr) {
        Some(1)
    } else if is(Key::Shift) || is(Key::ShiftR) {
        Some(2)
    } else if is(Key::Meta) || is(Key::MetaR) {
        Some(3)
    } else {
        None
    }
}

/// recordKey (keydown, and keyup for PrintScreen, which Windows only sends
/// on release): validate the binding, save it or show the error.
fn record_key(text: &str, held: [bool; 4], pressed: bool) {
    let Some(ui) = ui() else { return };
    let data = ui.global::<ScreenshotsData>();
    if !data.get_recording() {
        return;
    }
    if let Some(index) = modifier_index(text) {
        with(|s| s.modifiers[index] = Some(if pressed { None } else { Some(Instant::now()) }));
        return;
    }
    let Some(code) = key_code(text) else {
        if pressed {
            // a key Hydra can't bind: the validation's unsupported message
            data.set_recording(false);
            data.set_hotkey_error(shell::tr("screenshots_input.hotkey_unsupported_key").into());
        }
        return;
    };
    let print_screen = code == "PrintScreen";
    // other keys record on keydown, PrintScreen on keyup
    if pressed == print_screen {
        return;
    }
    if code == "Escape" {
        data.set_recording(false);
        return;
    }
    let was_held = |index: usize| {
        with(|s| match s.modifiers[index] {
            Some(None) => true,
            Some(Some(at)) => at.elapsed() <= PRINT_SCREEN_GRACE,
            None => false,
        })
    };
    let is_held = |index: usize| held[index] || (print_screen && was_held(index));
    let binding = Hotkey {
        key: code,
        ctrl: is_held(0),
        alt: is_held(1),
        shift: is_held(2),
    };
    data.set_recording(false);
    if let Some(error) = sp::validate_hotkey(&binding, is_held(3)) {
        data.set_hotkey_error(shell::tr(&format!("screenshots_input.{error}")).into());
        return;
    }
    save_hotkey(&binding);
}

/// The Screenshots tab opened (or a preference changed).
pub fn refresh() {
    let Some(ui) = ui() else { return };
    let p = prefs::get();
    let resolved = sp::resolve(&p);
    // useEffect([combo]): a new saved combo replaces the draft unless it's
    // the same set (an invalid draft stays until it's fixed)
    let draft = with(|s| {
        if s.saved != resolved.gamepad_combo {
            s.saved = resolved.gamepad_combo.clone();
            if !sp::same_combo(&s.draft, &s.saved) {
                s.draft = s.saved.clone();
            }
        }
        s.draft.clone()
    });
    let button_label = |b: &str| t(&format!("screenshots_gamepad_button_{b}"));
    let options: Vec<SelectOption> = sp::GAMEPAD_BUTTONS
        .iter()
        .map(|b| SelectOption {
            value: (*b).into(),
            label: button_label(b).into(),
        })
        .collect();
    let longest = |labels: &[SelectOption]| -> String {
        labels
            .iter()
            .map(|o| o.label.to_string())
            .max_by(|a, b| {
                crate::text_metrics::width(a, 14.0)
                    .partial_cmp(&crate::text_metrics::width(b, 14.0))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap_or_default()
    };
    let visibility: Vec<SelectOption> = ["PUBLIC", "FRIENDS", "PRIVATE"]
        .iter()
        .map(|v| SelectOption {
            value: (*v).into(),
            label: shell::tr(&format!(
                "screenshots_capture.visibility_{}",
                v.to_lowercase()
            ))
            .into(),
        })
        .collect();
    let visibility_label = visibility
        .iter()
        .find(|o| o.value == resolved.default_visibility.as_str())
        .map(|o| o.label.clone())
        .unwrap_or_default();
    let combo_error = if sp::has_duplicates(&draft) {
        t("screenshots_gamepad_duplicate")
    } else if let Some(error) = sp::validate_combo(&draft) {
        shell::tr(&format!("screenshots_input.{error}"))
    } else {
        String::new()
    };
    let folder = folder(&p);
    let data = ui.global::<ScreenshotsData>();
    data.set_enabled(resolved.enabled);
    if !resolved.enabled {
        data.set_recording(false);
    }
    data.set_hotkey_label(sp::format_hotkey(&resolved.hotkey).into());
    data.set_hotkey_default(resolved.hotkey == Hotkey::default());
    // TODO(screenshots): getScreenshotInputStatus / onScreenshotInputStatusChange
    data.set_input_state("idle".into());
    data.set_input_hint(Default::default());
    data.set_gamepad_enabled(resolved.gamepad_enabled);
    data.set_combo(ModelRc::new(VecModel::from(
        draft
            .iter()
            .map(|b| SharedString::from(b.as_str()))
            .collect::<Vec<_>>(),
    )));
    data.set_combo_labels(ModelRc::new(VecModel::from(
        draft
            .iter()
            .map(|b| SharedString::from(button_label(b)))
            .collect::<Vec<_>>(),
    )));
    data.set_button_longest(longest(&options).into());
    data.set_button_options(ModelRc::new(VecModel::from(options)));
    data.set_combo_default(sp::same_combo(
        &draft,
        &sp::DEFAULT_GAMEPAD_COMBO.map(String::from),
    ));
    data.set_combo_error(combo_error.into());
    data.set_capture_sound(resolved.capture_sound);
    data.set_toast(resolved.toast);
    data.set_visibility_longest(longest(&visibility).into());
    data.set_visibility_options(ModelRc::new(VecModel::from(visibility)));
    data.set_visibility(resolved.default_visibility.clone().into());
    data.set_visibility_label(visibility_label);
    data.set_hide_community(resolved.hide_community);
    data.set_folder(folder.to_string_lossy().into_owned().into());
    data.set_custom_folder(
        p.get("screenshotsFolderPath")
            .and_then(Value::as_str)
            .is_some_and(|s| !s.is_empty()),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_codes_follow_the_dom() {
        assert_eq!(key_code("a").as_deref(), Some("KeyA"));
        assert_eq!(key_code("S").as_deref(), Some("KeyS"));
        assert_eq!(key_code("7").as_deref(), Some("Digit7"));
        assert_eq!(key_code("!").as_deref(), Some("Digit1"));
        assert_eq!(key_code("/").as_deref(), Some("Slash"));
        assert_eq!(key_code(" ").as_deref(), Some("Space"));
        assert_eq!(
            key_code(SharedString::from(Key::F10).as_str()).as_deref(),
            Some("F10")
        );
        assert_eq!(
            key_code(SharedString::from(Key::SysReq).as_str()).as_deref(),
            Some("PrintScreen")
        );
        assert_eq!(key_code("é"), None);
        assert_eq!(
            modifier_index(SharedString::from(Key::Control).as_str()),
            Some(0)
        );
    }
}
