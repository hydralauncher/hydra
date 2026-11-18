//! loadHiddenSteamPage (steam-store-session.ts): a hidden window in the
//! `persist:steam` profile (the one the OpenID sign-in used) that loads one
//! Steam page, runs one script, reads the cookies it needs and closes.
//! getSteamWebApiToken reads the store page's `application_config`;
//! readSteamCommunitySession loads the Community page, which renews
//! steamLoginSecure, before the cookies are copied.
//!
//! [`read_page`] is called from the sync's worker thread and blocks it; the
//! webview itself lives on the UI thread.

use std::cell::RefCell;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::Value;
use slint::ComponentHandle;
use slint::winit_030::{WinitWindowAccessor, winit};

use crate::HosterBrowserWindow;

/// How long one page may take to load and answer.
const PAGE_TIMEOUT: Duration = Duration::from_secs(60);

/// What one hidden page gave back.
#[derive(Debug, Default)]
pub struct PageRead {
    /// The page loaded (did-finish-load); false when it failed or timed out.
    pub loaded: bool,
    /// `webContents.getURL()` after the load
    pub url: String,
    /// The script's result (`executeJavaScript`)
    pub value: Value,
    /// (url asked for, name, value) of the cookies the profile has
    pub cookies: Vec<(String, String, String)>,
}

struct Open {
    id: u64,
    window: HosterBrowserWindow,
    webview: Option<wry::WebView>,
    _context: Option<wry::WebContext>,
    script: String,
    cookie_urls: Vec<String>,
    reply: Option<mpsc::Sender<PageRead>>,
    started: bool,
}

thread_local! {
    static OPEN: RefCell<Vec<Open>> = const { RefCell::new(Vec::new()) };
    static NEXT_ID: RefCell<u64> = const { RefCell::new(0) };
}

/// Loads `url` in a hidden window, runs `script`, reads `cookie_urls`.
/// Blocks the calling (worker) thread; `aborted` closes the page early.
pub fn read_page(
    url: &str,
    script: &str,
    cookie_urls: &[&str],
    aborted: &dyn Fn() -> bool,
) -> Result<PageRead, String> {
    if crate::shell::headless() {
        return Err("the Steam browser profile isn't available in headless runs".into());
    }
    let (tx, rx) = mpsc::channel();
    let (url, script) = (url.to_string(), script.to_string());
    let cookie_urls: Vec<String> = cookie_urls.iter().map(|u| u.to_string()).collect();
    let id = std::sync::Arc::new(std::sync::Mutex::new(None::<u64>));
    let opened = id.clone();
    slint::invoke_from_event_loop(move || {
        let page = open(url, script, cookie_urls, tx);
        *opened.lock().unwrap_or_else(|e| e.into_inner()) = page;
    })
    .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + PAGE_TIMEOUT;
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(read) => return Ok(read),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("the Steam page window closed".into());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        let timed_out = Instant::now() >= deadline;
        if aborted() || timed_out {
            if let Some(page) = *id.lock().unwrap_or_else(|e| e.into_inner()) {
                let _ = slint::invoke_from_event_loop(move || close(page));
            }
            return Err(if timed_out {
                "the Steam page took too long to load".into()
            } else {
                "steam-sync-aborted".into()
            });
        }
    }
}

fn open(
    url: String,
    script: String,
    cookie_urls: Vec<String>,
    reply: mpsc::Sender<PageRead>,
) -> Option<u64> {
    let window = match HosterBrowserWindow::new() {
        Ok(window) => window,
        Err(error) => {
            eprintln!("[steam-sync] hidden Steam window: {error}");
            let _ = reply.send(PageRead::default());
            return None;
        }
    };
    // Off screen and out of the taskbar: `show: false` in Electron.
    window
        .window()
        .set_position(slint::PhysicalPosition::new(-32000, -32000));
    if let Err(error) = window.show() {
        eprintln!("[steam-sync] hidden Steam window: {error}");
        let _ = reply.send(PageRead::default());
        return None;
    }
    let id = NEXT_ID.with(|n| {
        let mut n = n.borrow_mut();
        *n += 1;
        *n
    });
    OPEN.with(|o| {
        o.borrow_mut().push(Open {
            id,
            window,
            webview: None,
            _context: None,
            script,
            cookie_urls,
            reply: Some(reply),
            started: false,
        })
    });
    attach_when_ready(id, url, 0);
    Some(id)
}

fn with_open<R>(id: u64, f: impl FnOnce(&mut Open) -> R) -> Option<R> {
    OPEN.with(|o| o.borrow_mut().iter_mut().find(|p| p.id == id).map(f))
}

fn attach_when_ready(id: u64, url: String, attempt: u32) {
    let ready = with_open(id, |p| {
        p.window
            .window()
            .with_winit_window(|_: &winit::window::Window| ())
            .is_some()
    });
    match ready {
        None => return,
        Some(false) if attempt > 200 => {
            eprintln!("[steam-sync] the hidden Steam window never appeared");
            finish(id, false);
            return;
        }
        Some(false) => {
            slint::Timer::single_shot(Duration::from_millis(10), move || {
                attach_when_ready(id, url, attempt + 1)
            });
            return;
        }
        Some(true) => {}
    }
    let built = with_open(id, |p| {
        p.window
            .window()
            .with_winit_window(|w: &winit::window::Window| {
                #[cfg(windows)]
                {
                    use winit::platform::windows::WindowExtWindows;
                    w.set_skip_taskbar(true);
                }
                w.set_outer_position(winit::dpi::PhysicalPosition::new(-32000, -32000));
            });
        let mut context = wry::WebContext::new(crate::steam_openid::profile_dir());
        let handle = p.window.window().window_handle();
        let webview = wry::WebViewBuilder::new_with_web_context(&mut context)
            .with_url(url.as_str())
            .with_user_agent(crate::steam_openid::STEAM_USER_AGENT)
            .with_devtools(false)
            .with_bounds(wry::Rect {
                position: wry::dpi::LogicalPosition::new(0.0, 0.0).into(),
                size: wry::dpi::LogicalSize::new(800.0, 600.0).into(),
            })
            .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
            .with_on_page_load_handler(move |event, _url| {
                if matches!(event, wry::PageLoadEvent::Finished) {
                    let _ = slint::invoke_from_event_loop(move || on_loaded(id));
                }
            })
            .build_as_child(&handle);
        match webview {
            Ok(webview) => {
                p.webview = Some(webview);
                p._context = Some(context);
                true
            }
            Err(error) => {
                eprintln!("[steam-sync] Steam webview: {error}");
                false
            }
        }
    });
    if built != Some(true) {
        finish(id, false);
    }
}

/// window.loadURL resolved: run the script, then read the URL and cookies.
fn on_loaded(id: u64) {
    let script = with_open(id, |p| {
        if p.started {
            return None;
        }
        p.started = true;
        Some(p.script.clone())
    })
    .flatten();
    let Some(script) = script else { return };
    let evaluated = with_open(id, |p| {
        p.webview.as_ref().map(|webview| {
            webview.evaluate_script_with_callback(&script, move |json: String| {
                let _ = slint::invoke_from_event_loop(move || read_and_close(id, &json));
            })
        })
    })
    .flatten();
    if !matches!(evaluated, Some(Ok(()))) {
        finish(id, false);
    }
}

fn read_and_close(id: u64, json: &str) {
    let read = with_open(id, |p| {
        let webview = p.webview.as_ref()?;
        let mut cookies = Vec::new();
        for url in &p.cookie_urls {
            match webview.cookies_for_url(url) {
                Ok(list) => cookies.extend(
                    list.iter()
                        .map(|c| (url.clone(), c.name().to_string(), c.value().to_string())),
                ),
                Err(error) => eprintln!("[steam-sync] cookies for {url}: {error}"),
            }
        }
        Some(PageRead {
            loaded: true,
            url: webview.url().unwrap_or_default(),
            value: serde_json::from_str(json).unwrap_or(Value::Null),
            cookies,
        })
    })
    .flatten();
    match read {
        Some(read) => {
            if let Some(reply) = with_open(id, |p| p.reply.take()).flatten() {
                let _ = reply.send(read);
            }
            close(id);
        }
        None => finish(id, false),
    }
}

/// A failed page: still hand over the profile's cookies, like the session
/// read after a failed load.
fn finish(id: u64, loaded: bool) {
    let read = with_open(id, |p| {
        let mut read = PageRead {
            loaded,
            ..Default::default()
        };
        if let Some(webview) = p.webview.as_ref() {
            read.url = webview.url().unwrap_or_default();
            for url in &p.cookie_urls {
                if let Ok(list) = webview.cookies_for_url(url) {
                    read.cookies.extend(
                        list.iter()
                            .map(|c| (url.clone(), c.name().to_string(), c.value().to_string())),
                    );
                }
            }
        }
        (p.reply.take(), read)
    });
    if let Some((Some(reply), read)) = read {
        let _ = reply.send(read);
    }
    close(id);
}

/// window.destroy()
fn close(id: u64) {
    let open = OPEN.with(|o| {
        let mut o = o.borrow_mut();
        o.iter().position(|p| p.id == id).map(|i| o.remove(i))
    });
    if let Some(mut open) = open {
        open.webview.take();
        let _ = open.window.hide();
    }
}
