//! services/epic/auth-window.ts (openEpicAuthWindow): Epic's sign-in page in
//! an 800x860 "Epic Games" window with a private, throwaway webview profile
//! (Electron's `epic-auth-<uuid>` partition, cleared afterwards: an
//! incognito WebView2/WebKitGTK session here).
//!
//! Only https navigations are allowed. When the main frame lands on Epic's
//! redirect for Legendary's client (`/id/api/redirect?clientId=…&responseType=code`)
//! the window hides and the page body (`{"authorizationCode": …}`) is read
//! once; the code goes to the integration and never reaches the UI.

use std::cell::RefCell;

use hydra_epic::protocol::{
    EPIC_AUTH_RESPONSE_MAX_LENGTH, is_authorization_return, is_https_navigation, login_url,
    parse_authorization_response,
};
use slint::ComponentHandle;
use slint::winit_030::{WinitWindowAccessor, winit};

use crate::WebWindow;

const WINDOW_WIDTH: f32 = 800.0;
const WINDOW_HEIGHT: f32 = 860.0;

/// EpicAuthWindowCallbacks
pub enum Outcome {
    Code(String),
    Cancelled,
    /// "auth-failed" | "invalid-response"
    Failed(&'static str),
}

/// The flow of one operation (closing / completed / reading).
struct Flow {
    operation: String,
    done: bool,
    reading: bool,
}

struct Open {
    window: WebWindow,
    webview: Option<wry::WebView>,
}

thread_local! {
    static FLOW: RefCell<Option<Flow>> = const { RefCell::new(None) };
    static OPEN: RefCell<Option<Open>> = const { RefCell::new(None) };
    static CALLBACK: RefCell<Option<Box<dyn Fn(String, Outcome)>>> = const { RefCell::new(None) };
}

fn active(operation: &str) -> bool {
    FLOW.with(|f| {
        f.borrow()
            .as_ref()
            .is_some_and(|flow| flow.operation == operation && !flow.done)
    })
}

/// Ends the flow once and reports it.
fn finish(operation: &str, outcome: Outcome) {
    let fire = FLOW.with(|f| match f.borrow_mut().as_mut() {
        Some(flow) if flow.operation == operation && !flow.done => {
            flow.done = true;
            true
        }
        _ => false,
    });
    if fire {
        CALLBACK.with(|c| {
            if let Some(callback) = c.borrow().as_ref() {
                callback(operation.to_string(), outcome);
            }
        });
    }
}

fn with_webview<R>(f: impl FnOnce(&wry::WebView) -> R) -> Option<R> {
    OPEN.with(|o| {
        o.borrow()
            .as_ref()
            .and_then(|open| open.webview.as_ref().map(f))
    })
}

/// hideReturn: the return page is read hidden.
fn hide() {
    OPEN.with(|o| {
        if let Some(open) = o.borrow().as_ref() {
            let _ = open.window.hide();
        }
    });
}

/// close(): no more callbacks, and the window (with its incognito profile:
/// cookies, storage, auth cache) goes away.
pub fn close() {
    FLOW.with(|f| {
        if let Some(flow) = f.borrow_mut().as_mut() {
            flow.done = true;
        }
    });
    let open = OPEN.with(|o| o.borrow_mut().take());
    if let Some(open) = open {
        let _ = open.window.hide();
        drop(open);
    }
}

/// openEpicAuthWindow: `on_outcome(operation, outcome)` fires once.
pub fn open(operation: &str, on_outcome: impl Fn(String, Outcome) + 'static) -> bool {
    close();
    CALLBACK.with(|c| *c.borrow_mut() = Some(Box::new(on_outcome)));
    FLOW.with(|f| {
        *f.borrow_mut() = Some(Flow {
            operation: operation.to_string(),
            done: false,
            reading: false,
        })
    });
    let Ok(window) = WebWindow::new() else {
        return false;
    };
    window.set_page_title("Epic Games".into());
    window
        .window()
        .set_size(slint::LogicalSize::new(WINDOW_WIDTH, WINDOW_HEIGHT));
    if window.show().is_err() {
        return false;
    }
    let operation_id = operation.to_string();
    window.window().on_close_requested(move || {
        // "closed" on the root window: the user cancelled.
        let operation = operation_id.clone();
        slint::Timer::single_shot(std::time::Duration::ZERO, move || {
            finish(&operation, Outcome::Cancelled);
            close();
        });
        slint::CloseRequestResponse::HideWindow
    });
    OPEN.with(|o| {
        *o.borrow_mut() = Some(Open {
            window: window.clone_strong(),
            webview: None,
        })
    });
    attach_when_ready(window, operation.to_string(), 0);
    true
}

/// did-finish-load on the return page: read `document.body.innerText`.
fn read_body(operation: String, url: String) {
    let start = FLOW.with(|f| match f.borrow_mut().as_mut() {
        Some(flow) if flow.operation == operation && !flow.done && !flow.reading => {
            flow.reading = true;
            true
        }
        _ => false,
    });
    if !start {
        return;
    }
    let script = format!(
        "(document.body && document.body.innerText || \"\").slice(0, {})",
        EPIC_AUTH_RESPONSE_MAX_LENGTH + 1
    );
    let op = operation.clone();
    let expected = url.clone();
    let started = with_webview(|webview| {
        webview
            .evaluate_script_with_callback(&script, move |json: String| {
                let body: Option<String> = serde_json::from_str(&json).ok();
                let op = op.clone();
                let expected = expected.clone();
                let _ = slint::invoke_from_event_loop(move || {
                    if !active(&op) {
                        return;
                    }
                    // Only the validated main frame counts.
                    let still = with_webview(|w| w.url().ok())
                        .flatten()
                        .is_some_and(|u| u == expected);
                    let Some(body) = body.filter(|_| still) else {
                        finish(&op, Outcome::Failed("auth-failed"));
                        return;
                    };
                    match parse_authorization_response(&body) {
                        Ok(code) => finish(&op, Outcome::Code(code)),
                        Err(_) => finish(&op, Outcome::Failed("invalid-response")),
                    }
                });
            })
            .is_ok()
    })
    .unwrap_or(false);
    if !started {
        finish(&operation, Outcome::Failed("auth-failed"));
    }
}

fn attach_when_ready(window: WebWindow, operation: String, attempt: u32) {
    if !active(&operation) {
        return;
    }
    let ready = window
        .window()
        .with_winit_window(|_: &winit::window::Window| ())
        .is_some();
    if !ready {
        if attempt > 200 {
            eprintln!("epic auth webview: the window never appeared");
            finish(&operation, Outcome::Failed("auth-failed"));
            return;
        }
        slint::Timer::single_shot(std::time::Duration::from_millis(10), move || {
            attach_when_ready(window, operation, attempt + 1)
        });
        return;
    }
    let handle = window.window().window_handle();
    let size = window
        .window()
        .size()
        .to_logical(window.window().scale_factor());
    let weak = window.as_weak();
    let nav_operation = operation.clone();
    let popup_operation = operation.clone();
    let load_operation = operation.clone();
    let webview = wry::WebViewBuilder::new()
        .with_url(login_url())
        .with_incognito(true)
        .with_bounds(wry::Rect {
            position: wry::dpi::LogicalPosition::new(0.0, 0.0).into(),
            size: wry::dpi::LogicalSize::new(size.width as f64, size.height as f64).into(),
        })
        // will-navigate / will-redirect / did-start-navigation
        .with_navigation_handler(move |url: String| {
            if !is_https_navigation(&url) {
                return false;
            }
            if is_authorization_return(&url) {
                let operation = nav_operation.clone();
                let _ = slint::invoke_from_event_loop(move || {
                    if active(&operation) {
                        hide();
                    }
                });
            }
            true
        })
        // setWindowOpenHandler: https popups only; a popup that is the
        // return itself is loaded (hidden) in the main view instead.
        .with_new_window_req_handler(move |url: String, _features| {
            if !active(&popup_operation) || !is_https_navigation(&url) {
                return wry::NewWindowResponse::Deny;
            }
            if is_authorization_return(&url) {
                let _ = slint::invoke_from_event_loop(move || {
                    hide();
                    with_webview(|w| w.load_url(&url));
                });
                return wry::NewWindowResponse::Deny;
            }
            wry::NewWindowResponse::Allow
        })
        // will-download: prevented
        .with_download_started_handler(|_, _| false)
        // BrowserWindow's title follows the page
        .with_document_title_changed_handler(move |title: String| {
            let weak = weak.clone();
            let _ = slint::invoke_from_event_loop(move || {
                if let Some(window) = weak.upgrade()
                    && !title.is_empty()
                {
                    window.set_page_title(title.into());
                }
            });
        })
        .with_on_page_load_handler(move |event, url| {
            if !matches!(event, wry::PageLoadEvent::Finished) || !is_authorization_return(&url) {
                return;
            }
            let operation = load_operation.clone();
            let _ = slint::invoke_from_event_loop(move || {
                if active(&operation) {
                    hide();
                    read_body(operation, url);
                }
            });
        })
        .build_as_child(&handle);
    match webview {
        Ok(webview) => {
            window.on_resized(|width, height| {
                with_webview(|webview| {
                    let _ = webview.set_bounds(wry::Rect {
                        position: wry::dpi::LogicalPosition::new(0.0, 0.0).into(),
                        size: wry::dpi::LogicalSize::new(width as f64, height as f64).into(),
                    });
                });
            });
            let _ = webview.focus();
            OPEN.with(|o| {
                if let Some(open) = o.borrow_mut().as_mut() {
                    open.webview = Some(webview);
                }
            });
        }
        Err(error) => {
            // did-fail-load on the main frame
            eprintln!("epic auth webview: {error}");
            let _ = window.hide();
            finish(&operation, Outcome::Failed("auth-failed"));
        }
    }
}

/// Dev hook: the page the window shows (host and path, never the query).
pub fn current_page() -> Option<String> {
    with_webview(|w| w.url().ok())
        .flatten()
        .and_then(|u| reqwest::Url::parse(&u).ok())
        .and_then(|u| u.host_str().map(|h| format!("{h}{}", u.path())))
}

/// Dev hook: load Epic's redirect for Legendary's client in the open window
/// (signed out, Epic answers without a code: exercises the return handling).
pub fn dev_load_redirect() {
    let mut redirect =
        reqwest::Url::parse("https://www.epicgames.com/id/api/redirect").expect("static");
    redirect
        .query_pairs_mut()
        .append_pair("clientId", hydra_epic::protocol::EPIC_OAUTH_CLIENT_ID)
        .append_pair("responseType", "code");
    with_webview(|w| w.load_url(redirect.as_str()));
}

/// Dev hook: the window is up.
pub fn is_open() -> bool {
    OPEN.with(|o| o.borrow().is_some())
}
