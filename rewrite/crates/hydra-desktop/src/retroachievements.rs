//! The RetroAchievements connection window
//! (pages/retroachievements-connection-window, window-manager.ts
//! openRetroAchievementsConnectionWindow): a 600x640 window over the main
//! one with the username / password / Web API key form. Submitting POSTs
//! /profile/integrations/retroachievements/connect, saves the key and
//! username in the preferences and tells the settings card.

use std::cell::RefCell;

use hydra_core::api::Options;
use hydra_core::integrations::{
    RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT, RaStatus, ra_error_field, ra_error_key,
};
use serde_json::{Map, Value, json};
use slint::ComponentHandle;
use slint::winit_030::{WinitWindowAccessor, winit};

use crate::{RaWindowStrings, RetroAchievementsWindow, prefs, shell};

thread_local! {
    static OPEN: RefCell<Option<RetroAchievementsWindow>> = const { RefCell::new(None) };
}

fn t(key: &str) -> slint::SharedString {
    shell::tr(&format!("settings.{key}")).into()
}

fn strings() -> RaWindowStrings {
    let hint = shell::tr("settings.retroachievements_web_api_key_hint");
    RaWindowStrings {
        title: t("retroachievements_connect_title"),
        description: t("retroachievements_description"),
        username: t("retroachievements_username"),
        password: t("retroachievements_password"),
        key: t("retroachievements_web_api_key"),
        hint_before: shell::trans_part(&hint, 0).into(),
        hint_link: shell::trans_part(&hint, 1).into(),
        hint_after: shell::trans_part(&hint, 2).into(),
        note: t("retroachievements_emulator_note"),
        create_account: t("retroachievements_create_account"),
        cancel: t("cancel"),
        connect: t("integration_connect"),
    }
}

fn with_window(f: impl FnOnce(&RetroAchievementsWindow)) {
    OPEN.with(|o| {
        if let Some(window) = o.borrow().as_ref() {
            f(window);
        }
    });
}

/// isConnectDisabled's trimmed checks
fn update_filled(window: &RetroAchievementsWindow) {
    window.set_filled(
        !window.get_username().trim().is_empty()
            && !window.get_password().trim().is_empty()
            && !window.get_web_api_key().trim().is_empty(),
    );
}

/// openRetroAchievementsConnectionWindow: focus the open one, else create it.
pub fn open() {
    let existing = OPEN.with(|o| o.borrow().as_ref().map(|w| w.as_weak()));
    if let Some(weak) = existing.and_then(|w| w.upgrade()) {
        let _ = weak.show();
        weak.window()
            .with_winit_window(|w: &winit::window::Window| {
                w.set_minimized(false);
                w.focus_window();
            });
        return;
    }
    let Ok(window) = RetroAchievementsWindow::new() else {
        return;
    };
    window.set_strings(strings());
    window.set_initializing(true);
    window.on_field_edited(|field| {
        with_window(|w| {
            // updateField clears that field's error and the form error
            match field.as_str() {
                "password" => w.set_password_error(Default::default()),
                "webApiKey" => w.set_key_error(Default::default()),
                _ => {}
            }
            w.set_form_error(Default::default());
            update_filled(w);
        });
    });
    window.on_submit(submit);
    window.on_cancel(close);
    window.on_open_url(|url| crate::settings_debrid::open_url(&url));
    window.window().on_close_requested(|| {
        slint::Timer::single_shot(std::time::Duration::ZERO, close);
        slint::CloseRequestResponse::HideWindow
    });
    if window.show().is_err() {
        return;
    }
    fixed_frame(window.as_weak(), 0);
    OPEN.with(|o| *o.borrow_mut() = Some(window));
    load_initial();
}

/// maximizable: false, resizable: false, minimizable only with a custom bar
fn fixed_frame(weak: slint::Weak<RetroAchievementsWindow>, attempt: u32) {
    let Some(window) = weak.upgrade() else { return };
    let done = window
        .window()
        .with_winit_window(|w: &winit::window::Window| {
            w.set_resizable(false);
            w.set_enabled_buttons(winit::window::WindowButtons::CLOSE);
        })
        .is_some();
    if !done && attempt < 200 {
        slint::Timer::single_shot(std::time::Duration::from_millis(10), move || {
            fixed_frame(weak, attempt + 1)
        });
    }
}

/// The saved username (the linked one first) and Web API key.
fn load_initial() {
    let preferences = prefs::get();
    let saved_username = preferences
        .get("retroAchievementsUsername")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let saved_key = preferences
        .get("retroAchievementsWebApiKey")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let Some(api) = shell::api() else {
        with_window(|w| {
            w.set_username(saved_username.into());
            w.set_web_api_key(saved_key.into());
            w.set_initializing(false);
            update_filled(w);
        });
        return;
    };
    std::thread::spawn(move || {
        let status = api
            .get(
                RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT,
                &[],
                Options::default(),
            )
            .ok()
            .map(|v| RaStatus::parse(&v));
        let _ = slint::invoke_from_event_loop(move || {
            with_window(|w| {
                let username = status
                    .filter(|s| s.connected && !s.username.is_empty())
                    .map_or(saved_username, |s| s.username);
                w.set_username(username.into());
                w.set_web_api_key(saved_key.into());
                w.set_initializing(false);
                update_filled(w);
            });
        });
    });
}

/// The API's `message` (hydraApiCall's getErrorMessage).
pub fn api_message(error: &hydra_core::api::ApiError) -> Option<String> {
    match error {
        hydra_core::api::ApiError::Status {
            body: Some(body), ..
        } => body
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string),
        hydra_core::api::ApiError::Network(message) => Some(message.clone()),
        _ => None,
    }
}

/// handleSubmit
fn submit() {
    let mut form = None;
    with_window(|w| {
        if w.get_initializing() || w.get_submitting() {
            return;
        }
        w.set_submitting(true);
        w.set_password_error(Default::default());
        w.set_key_error(Default::default());
        w.set_form_error(Default::default());
        form = Some((
            w.get_username().trim().to_string(),
            w.get_password().to_string(),
            w.get_web_api_key().trim().to_string(),
        ));
    });
    let Some((username, password, web_api_key)) = form else {
        return;
    };
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let result = api.post(
            &format!("{RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT}/connect"),
            &json!({
                "username": username,
                "password": password,
                "webApiKey": web_api_key,
                "deleteAchievements": false,
            }),
            Options::default(),
        );
        let _ = slint::invoke_from_event_loop(move || match result {
            Ok(integration) => {
                let status = RaStatus::parse(&integration);
                let linked_name = if status.connected {
                    status.username
                } else {
                    username.clone()
                };
                prefs::update(Map::from_iter([
                    ("retroAchievementsWebApiKey".to_string(), json!(web_api_key)),
                    ("retroAchievementsUsername".to_string(), json!(linked_name)),
                ]));
                // TODO(emulators): linkRetroAchievementsEmulatorAccount (writes the
                // RA login into the emulators' configs).
                // completeRetroAchievementsConnectionWindow
                crate::settings_integrations::on_retroachievements_connected();
                close();
            }
            Err(error) => {
                let message = api_message(&error);
                let text = shell::tr(&format!("settings.{}", ra_error_key(message.as_deref())));
                with_window(|w| {
                    match ra_error_field(message.as_deref()) {
                        "password" => w.set_password_error(text.into()),
                        "webApiKey" => w.set_key_error(text.into()),
                        _ => w.set_form_error(text.into()),
                    }
                    w.set_submitting(false);
                });
            }
        });
    });
}

/// Dev hook: fill a field ("username" | "password" | "webApiKey"), or show
/// an error under one ("error-password" | "error-form" ...).
pub fn dev_fill(field: &str, value: &str) {
    with_window(|w| {
        match field {
            "username" => w.set_username(value.into()),
            "password" => w.set_password(value.into()),
            "webApiKey" => w.set_web_api_key(value.into()),
            "error-password" => w.set_password_error(value.replace('_', " ").into()),
            "error-key" => w.set_key_error(value.replace('_', " ").into()),
            "error-form" => w.set_form_error(value.replace('_', " ").into()),
            _ => {}
        }
        update_filled(w);
    });
}

/// Dev hook: save the window as `<dir>/<name>.png` (headless checks).
pub fn dev_snapshot(dir: &std::path::Path, name: &str) {
    with_window(|w| {
        if let Ok(buffer) = w.window().take_snapshot()
            && let Some(img) = image::RgbaImage::from_raw(
                buffer.width(),
                buffer.height(),
                buffer.as_bytes().to_vec(),
            )
        {
            let _ = img.save(dir.join(format!("{name}.png")));
        }
    });
}

/// closeRetroAchievementsConnectionWindow (the main window gets focus back)
pub fn close() {
    if let Some(window) = OPEN.with(|o| o.borrow_mut().take()) {
        let _ = window.hide();
    }
    crate::settings_integrations::focus_main_window();
}
