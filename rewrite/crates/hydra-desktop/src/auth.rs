//! Signing in and out: open-auth-window.ts (the auth site in an OS webview),
//! HydraApi.handleExternalAuth (the hydralauncher://auth redirect) and
//! sign-out.ts.

use std::cell::RefCell;

use base64::Engine;
use hydra_db::keys;
use serde_json::{Value, json};
use slint::ComponentHandle;

use slint::winit_030::{WinitWindowAccessor, winit};

use crate::{AppWindow, AuthWindow, Session, shell, toast};

/// AuthPage
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Page {
    SignIn,
    UpdateEmail,
    UpdatePassword,
}

impl Page {
    fn path(self) -> &'static str {
        match self {
            Page::SignIn => "/",
            Page::UpdateEmail => "/update-email",
            Page::UpdatePassword => "/update-password",
        }
    }
}

struct Open {
    window: AuthWindow,
    // Dropped with the window; the webview must outlive nothing else.
    _webview: wry::WebView,
}

thread_local! {
    static OPEN: RefCell<Option<Open>> = const { RefCell::new(None) };
    static MAIN: RefCell<slint::Weak<AppWindow>> = RefCell::new(slint::Weak::default());
}

pub fn init(ui: &AppWindow) {
    MAIN.with(|m| *m.borrow_mut() = ui.as_weak());
    let session = ui.global::<Session>();
    session.on_sign_in(|| open(Page::SignIn));
    session.on_sign_out(confirm_sign_out);
}

/// sidebar-profile: the sign-out ConfirmationModal, then signOut, the toast
/// and navigate("/").
fn confirm_sign_out() {
    let t = shell::tr;
    crate::dialogs::confirm(
        crate::dialogs::Confirm {
            title: &t("user_profile.sign_out_modal_title"),
            description: &t("user_profile.sign_out_modal_text"),
            body: "",
            confirm_label: &t("user_profile.sign_out"),
            cancel_label: &t("user_profile.cancel"),
            danger: true,
        },
        || {
            crate::dialogs::set_busy(true);
            sign_out();
            toast::success(&shell::tr("user_profile.successfully_signed_out"));
            crate::dialogs::close();
            crate::nav::navigate("/");
        },
    );
}

/// openAuthWindow(page): `lng`, plus a fresh token for the account pages.
pub fn open(page: Page) {
    if OPEN.with(|o| o.borrow().is_some()) {
        OPEN.with(|o| {
            if let Some(open) = o.borrow().as_ref() {
                let _ = open.window.show();
            }
        });
        return;
    }
    let language = shell::i18n()
        .map(|i| i.language().to_string())
        .unwrap_or_else(|| "en".into());
    let base = hydra_core::config::auth_url();
    let needs_token = page != Page::SignIn;
    if needs_token {
        // HydraApi.refreshToken() runs off the UI thread, then the window opens.
        let Some(api) = shell::api() else { return };
        std::thread::spawn(move || {
            let token = api.fresh_access_token().unwrap_or_default();
            let _ =
                slint::invoke_from_event_loop(move || show(&base, page, &language, Some(&token)));
        });
    } else {
        show(&base, page, &language, None);
    }
}

fn show(base: &str, page: Page, language: &str, token: Option<&str>) {
    let mut url =
        match reqwest::Url::parse(&format!("{}{}", base.trim_end_matches('/'), page.path())) {
            Ok(url) => url,
            Err(error) => {
                eprintln!("auth url: {error}");
                return;
            }
        };
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("lng", language);
        if let Some(token) = token {
            query.append_pair("token", token);
        }
    }
    let Ok(window) = AuthWindow::new() else {
        return;
    };
    if window.show().is_err() {
        return;
    }
    let weak = window.as_weak();
    window.window().on_close_requested(move || {
        let _ = weak;
        slint::Timer::single_shot(std::time::Duration::ZERO, close);
        slint::CloseRequestResponse::HideWindow
    });
    attach_when_ready(window, url.to_string(), 0);
}

/// winit creates the native window on a later event-loop pass: wait for it,
/// then attach the webview as a child of it.
fn attach_when_ready(window: AuthWindow, url: String, attempt: u32) {
    let ready = window
        .window()
        .with_winit_window(|_: &winit::window::Window| ())
        .is_some();
    if !ready {
        if attempt > 200 {
            eprintln!("auth webview: the window never appeared");
            return;
        }
        slint::Timer::single_shot(std::time::Duration::from_millis(10), move || {
            attach_when_ready(window, url, attempt + 1)
        });
        return;
    }
    // Not resizable, close button only (maximizable/minimizable: false).
    window
        .window()
        .with_winit_window(|w: &winit::window::Window| {
            w.set_resizable(false);
            w.set_enabled_buttons(winit::window::WindowButtons::CLOSE);
        });
    let handle = window.window().window_handle();
    let webview = wry::WebViewBuilder::new()
        .with_url(url.as_str())
        .with_background_color((0x1c, 0x1c, 0x1c, 0xff))
        .with_bounds(wry::Rect {
            position: wry::dpi::LogicalPosition::new(0.0, 0.0).into(),
            size: wry::dpi::LogicalSize::new(600.0, 640.0).into(),
        })
        .with_navigation_handler(|url: String| {
            // bindAuthNavigation
            if url.starts_with("hydralauncher://auth") {
                let _ = slint::invoke_from_event_loop(move || {
                    close();
                    handle_external_auth(&url);
                });
                return false;
            }
            if url.starts_with("hydralauncher://update-account") {
                let _ = slint::invoke_from_event_loop(|| {
                    close();
                    crate::settings_account::on_account_updated();
                });
                return false;
            }
            true
        })
        .build_as_child(&handle);
    match webview {
        Ok(webview) => OPEN.with(|o| {
            *o.borrow_mut() = Some(Open {
                window,
                _webview: webview,
            })
        }),
        Err(error) => {
            eprintln!("auth webview: {error}");
            let _ = window.hide();
        }
    }
}

fn close() {
    let open = OPEN.with(|o| o.borrow_mut().take());
    if let Some(open) = open {
        let _ = open.window.hide();
        drop(open);
    }
    MAIN.with(|m| {
        if let Some(ui) = m.borrow().upgrade() {
            ui.window()
                .with_winit_window(|w: &winit::window::Window| w.focus_window());
        }
    });
}

/// HydraApi.handleExternalAuth: the redirect's base64 JSON payload.
pub fn handle_external_auth(uri: &str) {
    let Ok(url) = reqwest::Url::parse(uri) else {
        return;
    };
    let Some(payload) = url
        .query_pairs()
        .find(|(k, _)| k == "payload")
        .map(|(_, v)| v.into_owned())
    else {
        return;
    };
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(payload.trim()));
    let Some(data) = decoded
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
    else {
        eprintln!("auth: unreadable payload");
        return;
    };
    let text = |k: &str| {
        data.get(k)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let (Some(db), Some(api)) = (shell::db(), shell::api()) else {
        return;
    };
    // A new account: the previous account's remote ids no longer apply
    // (clearGamesRemoteIds).
    for (key, mut game) in db.entries::<Value>(keys::GAMES).unwrap_or_default() {
        if game.get("remoteId").is_some_and(|v| !v.is_null())
            && let Some(map) = game.as_object_mut()
        {
            map.insert("remoteId".into(), Value::Null);
            let _ = db.put_in(keys::GAMES, &key, &game);
        }
    }
    api.sign_in(
        &text("accessToken"),
        &text("refreshToken"),
        data.get("expiresIn").and_then(Value::as_f64).unwrap_or(0.0),
    );
    let jwt = text("workwondersJwt");
    if !jwt.is_empty() {
        let mut stored: Value = db.get(keys::AUTH).unwrap_or_else(|| json!({}));
        if let Some(map) = stored.as_object_mut() {
            map.insert("workwondersJwt".into(), json!(jwt));
        }
        let _ = db.put(keys::AUTH, &stored);
    }
    // on-signin: fetch the user, then the library
    // TODO(auth): uploadGamesBatch, syncDownloadSourcesFromApi, Steam/Epic
    // startup syncs, the souvenir worker.
    crate::realtime::connect();
    crate::achievement_watcher::on_signed_in();
    shell::reload_user(Some(Box::new(|| {
        toast::success(&shell::tr("app.successfully_signed_in"))
    })));
    shell::load_library();
}

/// sign-out.ts: drop the session and the account's local library.
pub fn sign_out() {
    let (Some(db), Some(api)) = (shell::db(), shell::api()) else {
        return;
    };
    // useUserDetails.clearUserDetails
    shell::storage_remove("userDetails");
    // TODO(auth): Epic imports, achievement/souvenir workers, emulator scan
    // data, friends/chat windows.
    crate::realtime::close();
    crate::downloads::stop_active();
    api.clear_session();
    crate::achievement_watcher::on_signed_out();
    for sublevel in [keys::GAMES, keys::DOWNLOADS, keys::DOWNLOAD_LAYOUT_STATE] {
        for (key, _) in db.entries::<Value>(sublevel).unwrap_or_default() {
            let _ = db.delete_in(sublevel, &key);
        }
    }
    shell::reload_user(None);
    shell::load_library();
    crate::downloads_page::refresh();
}
