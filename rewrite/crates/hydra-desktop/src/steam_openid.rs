//! openSteamOpenIdWindow (steam-store-session.ts): the Steam sign-in page in
//! a 600x800 window with its own persistent webview profile (Electron's
//! `persist:steam` partition), ended by the `hydralauncher://steam-connected`
//! redirect (or an `oauth_linked_provider=steam` page, or a JSON error body).

use std::cell::RefCell;

use hydra_core::integrations::{
    OpenIdReturn, parse_steam_openid_error_body, parse_steam_openid_return,
};
use slint::ComponentHandle;
use slint::winit_030::{WinitWindowAccessor, winit};

use crate::WebWindow;

/// STEAM_CHROME_USER_AGENT (applySteamSessionUserAgent)
pub const STEAM_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

struct Open {
    window: WebWindow,
    webview: wry::WebView,
    _context: wry::WebContext,
    finished: bool,
}

thread_local! {
    static OPEN: RefCell<Option<Open>> = const { RefCell::new(None) };
}

/// The `persist:steam` profile folder (cookies survive restarts, so the
/// sync can reuse the Steam session).
pub fn profile_dir() -> Option<std::path::PathBuf> {
    hydra_db::paths::native_user_data().map(|d| d.join("Partitions").join("steam"))
}

/// closeSteamOpenIdWindow
pub fn close() {
    if let Some(open) = OPEN.with(|o| o.borrow_mut().take()) {
        let _ = open.window.hide();
        drop(open);
    }
}

/// The flow ended: close the window once, then tell the card.
fn finish(result: OpenIdReturn, url: &str) {
    let already = OPEN.with(|o| {
        o.borrow_mut().as_mut().is_some_and(|open| {
            let was = open.finished;
            open.finished = true;
            was
        })
    });
    if already {
        return;
    }
    match &result {
        OpenIdReturn::Success => eprintln!("Steam OpenID returned to Hydra {url}"),
        OpenIdReturn::Error(code) => eprintln!("Steam OpenID failed {code} {url}"),
    }
    close();
    crate::settings_integrations::on_steam_openid_return(result);
}

/// Returns true when the URL ended the flow (and the navigation must stop).
fn intercept(url: &str) -> bool {
    let Some(result) = parse_steam_openid_return(url) else {
        return false;
    };
    let url = url.to_string();
    let _ = slint::invoke_from_event_loop(move || finish(result, &url));
    true
}

pub fn open(authorization_url: &str) {
    close();
    let Ok(window) = WebWindow::new() else {
        return;
    };
    if window.show().is_err() {
        return;
    }
    window.window().on_close_requested(|| {
        slint::Timer::single_shot(std::time::Duration::ZERO, close);
        slint::CloseRequestResponse::HideWindow
    });
    attach_when_ready(window, authorization_url.to_string(), 0);
}

fn attach_when_ready(window: WebWindow, url: String, attempt: u32) {
    let ready = window
        .window()
        .with_winit_window(|_: &winit::window::Window| ())
        .is_some();
    if !ready {
        if attempt > 200 {
            eprintln!("steam openid webview: the window never appeared");
            return;
        }
        slint::Timer::single_shot(std::time::Duration::from_millis(10), move || {
            attach_when_ready(window, url, attempt + 1)
        });
        return;
    }
    let mut context = wry::WebContext::new(profile_dir());
    let handle = window.window().window_handle();
    let size = window
        .window()
        .size()
        .to_logical(window.window().scale_factor());
    let weak = window.as_weak();
    let webview = wry::WebViewBuilder::new_with_web_context(&mut context)
        .with_url(url.as_str())
        .with_user_agent(STEAM_USER_AGENT)
        .with_bounds(wry::Rect {
            position: wry::dpi::LogicalPosition::new(0.0, 0.0).into(),
            size: wry::dpi::LogicalSize::new(size.width as f64, size.height as f64).into(),
        })
        // will-navigate / will-redirect / did-navigate
        .with_navigation_handler(|url: String| !intercept(&url))
        // setWindowOpenHandler: the return can come through a popup too
        .with_new_window_req_handler(|url: String, _features| {
            if intercept(&url) {
                wry::NewWindowResponse::Deny
            } else {
                wry::NewWindowResponse::Allow
            }
        })
        // BrowserWindow's default title follows the page
        .with_document_title_changed_handler(move |title: String| {
            let weak = weak.clone();
            let _ = slint::invoke_from_event_loop(move || {
                if let Some(window) = weak.upgrade() {
                    window.set_page_title(title.into());
                }
            });
        })
        // did-finish-load: an API error page instead of a redirect
        .with_on_page_load_handler(|event, url| {
            if !matches!(event, wry::PageLoadEvent::Finished) {
                return;
            }
            let _ = slint::invoke_from_event_loop(move || read_body(url));
        })
        .build_as_child(&handle);
    match webview {
        Ok(webview) => {
            window.on_resized(|width, height| {
                OPEN.with(|o| {
                    if let Some(open) = o.borrow().as_ref() {
                        let _ = open.webview.set_bounds(wry::Rect {
                            position: wry::dpi::LogicalPosition::new(0.0, 0.0).into(),
                            size: wry::dpi::LogicalSize::new(width as f64, height as f64).into(),
                        });
                    }
                });
            });
            OPEN.with(|o| {
                *o.borrow_mut() = Some(Open {
                    window,
                    webview,
                    _context: context,
                    finished: false,
                })
            })
        }
        Err(error) => {
            eprintln!("steam openid webview: {error}");
            let _ = window.hide();
        }
    }
}

fn read_body(url: String) {
    OPEN.with(|o| {
        let open = o.borrow();
        let Some(open) = open.as_ref().filter(|open| !open.finished) else {
            return;
        };
        let _ = open.webview.evaluate_script_with_callback(
            r#"(document.body && document.body.innerText) || """#,
            move |json: String| {
                let text: String = serde_json::from_str(&json).unwrap_or_default();
                if let Some(result) = parse_steam_openid_error_body(&text) {
                    let url = url.clone();
                    let _ = slint::invoke_from_event_loop(move || finish(result, &url));
                }
            },
        );
    });
}
