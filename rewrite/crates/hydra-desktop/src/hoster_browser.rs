//! fuckingfast.ts's hidden BrowserWindow (`show: false`, its own
//! "persist:hydra-fuckingfast" partition, new windows denied): a wry
//! webview (WebView2 on Windows) in an off-screen window that skips the
//! taskbar. hydra-downloads drives it through the `Browser` trait to pass
//! FuckingFast's Cloudflare check and read the download link; the file
//! itself downloads without it.

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use hydra_downloads::hosters::fuckingfast::Browser;
use slint::ComponentHandle;
use slint::winit_030::{WinitWindowAccessor, winit};
use tokio::sync::oneshot;

use crate::HosterBrowserWindow;

struct Open {
    window: HosterBrowserWindow,
    webview: wry::WebView,
    _context: wry::WebContext,
}

type Job = Box<dyn FnOnce(Option<&Open>)>;

thread_local! {
    static OPEN: RefCell<Option<Open>> = const { RefCell::new(None) };
    /// Work waiting for the webview to be created.
    static WAITING: RefCell<Option<Vec<Job>>> = const { RefCell::new(None) };
    /// The navigation whose did-finish-load is awaited.
    static LOADING: RefCell<Option<oneshot::Sender<Result<(), String>>>> = const { RefCell::new(None) };
    static IDLE: RefCell<Option<slint::Timer>> = const { RefCell::new(None) };
    static DATA_DIR: RefCell<PathBuf> = const { RefCell::new(PathBuf::new()) };
}

/// The webview the downloads crate talks to (calls hop to the UI thread).
struct WebviewBrowser;

impl Browser for WebviewBrowser {
    fn load(&self, url: String) -> oneshot::Receiver<Result<(), String>> {
        let (tx, rx) = oneshot::channel();
        let _ = slint::invoke_from_event_loop(move || load(url, tx));
        rx
    }

    fn eval(&self, script: String) -> oneshot::Receiver<Result<String, String>> {
        let (tx, rx) = oneshot::channel();
        let _ = slint::invoke_from_event_loop(move || eval(script, tx));
        rx
    }

    fn close(&self) {
        let _ = slint::invoke_from_event_loop(close);
    }

    fn close_when_idle(&self, after: Duration) {
        let _ = slint::invoke_from_event_loop(move || {
            let timer = slint::Timer::default();
            timer.start(slint::TimerMode::SingleShot, after, close);
            IDLE.with(|i| *i.borrow_mut() = Some(timer));
        });
    }
}

/// Installs the browser (not in headless runs, which have no windows).
pub fn init(user_data: &Path) {
    // Electron keeps "persist:<name>" partitions in <userData>/Partitions/<name>.
    let partition = hydra_downloads::hosters::fuckingfast::PARTITION
        .trim_start_matches("persist:")
        .to_string();
    DATA_DIR.with(|d| *d.borrow_mut() = user_data.join("Partitions").join(partition));
    hydra_downloads::hosters::fuckingfast::set_browser(Arc::new(WebviewBrowser));
}

/// Runs `job` with the webview, creating it first if needed.
fn with_webview(job: impl FnOnce(Option<&Open>) + 'static) {
    IDLE.with(|i| {
        if let Some(timer) = i.borrow_mut().take() {
            timer.stop();
        }
    });
    if OPEN.with(|o| o.borrow().is_some()) {
        OPEN.with(|o| job(o.borrow().as_ref()));
        return;
    }
    let creating = WAITING.with(|w| {
        let mut w = w.borrow_mut();
        match w.as_mut() {
            Some(queue) => {
                queue.push(Box::new(job));
                true
            }
            None => {
                *w = Some(vec![Box::new(job)]);
                false
            }
        }
    });
    if !creating {
        create();
    }
}

fn create() {
    let window = match HosterBrowserWindow::new() {
        Ok(window) => window,
        Err(error) => return finish_creating(Err(error.to_string())),
    };
    // Off screen, so the page renders and runs like a shown window without
    // ever appearing.
    window
        .window()
        .set_position(slint::PhysicalPosition::new(-32000, -32000));
    if let Err(error) = window.show() {
        return finish_creating(Err(error.to_string()));
    }
    attach_when_ready(window, 0);
}

fn attach_when_ready(window: HosterBrowserWindow, attempt: u32) {
    let ready = window
        .window()
        .with_winit_window(|_: &winit::window::Window| ())
        .is_some();
    if !ready {
        if attempt > 200 {
            return finish_creating(Err("the hoster window never appeared".into()));
        }
        slint::Timer::single_shot(Duration::from_millis(10), move || {
            attach_when_ready(window, attempt + 1)
        });
        return;
    }
    window
        .window()
        .with_winit_window(|w: &winit::window::Window| {
            #[cfg(windows)]
            {
                use winit::platform::windows::WindowExtWindows;
                w.set_skip_taskbar(true);
            }
            w.set_outer_position(winit::dpi::PhysicalPosition::new(-32000, -32000));
        });
    let data_dir = DATA_DIR.with(|d| d.borrow().clone());
    let mut context = wry::WebContext::new(Some(data_dir));
    let handle = window.window().window_handle();
    let webview = wry::WebViewBuilder::new_with_web_context(&mut context)
        .with_url("about:blank")
        .with_devtools(false)
        .with_bounds(wry::Rect {
            position: wry::dpi::LogicalPosition::new(0.0, 0.0).into(),
            size: wry::dpi::LogicalSize::new(800.0, 600.0).into(),
        })
        // setWindowOpenHandler(() => ({ action: "deny" }))
        .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
        .with_on_page_load_handler(|event, _url| {
            if matches!(event, wry::PageLoadEvent::Finished)
                && let Some(tx) = LOADING.with(|l| l.borrow_mut().take())
            {
                let _ = tx.send(Ok(()));
            }
        })
        .build_as_child(&handle);
    match webview {
        Ok(webview) => {
            OPEN.with(|o| {
                *o.borrow_mut() = Some(Open {
                    window,
                    webview,
                    _context: context,
                })
            });
            finish_creating(Ok(()));
        }
        Err(error) => {
            let _ = window.hide();
            finish_creating(Err(error.to_string()));
        }
    }
}

fn finish_creating(result: Result<(), String>) {
    if let Err(error) = &result {
        eprintln!("[FuckingFast] Could not open the hoster page: {error}");
    }
    let jobs = WAITING.with(|w| w.borrow_mut().take()).unwrap_or_default();
    OPEN.with(|o| {
        let open = o.borrow();
        for job in jobs {
            job(open.as_ref());
        }
    });
}

/// window.loadURL: answers once the page finished loading.
fn load(url: String, tx: oneshot::Sender<Result<(), String>>) {
    with_webview(move |open| {
        let Some(open) = open else {
            let _ = tx.send(Err("The hoster page could not be opened.".into()));
            return;
        };
        LOADING.with(|l| *l.borrow_mut() = Some(tx));
        if let Err(error) = open.webview.load_url(&url)
            && let Some(tx) = LOADING.with(|l| l.borrow_mut().take())
        {
            let _ = tx.send(Err(error.to_string()));
        }
    });
}

/// webContents.executeJavaScript: the result as JSON text.
fn eval(script: String, tx: oneshot::Sender<Result<String, String>>) {
    with_webview(move |open| {
        let Some(open) = open else {
            let _ = tx.send(Err("The hoster page could not be opened.".into()));
            return;
        };
        let reply = Arc::new(Mutex::new(Some(tx)));
        let callback_reply = reply.clone();
        let result = open
            .webview
            .evaluate_script_with_callback(&script, move |json: String| {
                if let Some(tx) = callback_reply.lock().ok().and_then(|mut t| t.take()) {
                    let _ = tx.send(Ok(json));
                }
            });
        if let Err(error) = result
            && let Some(tx) = reply.lock().ok().and_then(|mut t| t.take())
        {
            let _ = tx.send(Err(error.to_string()));
        }
    });
}

/// closeWindow: a failed page may hold a stale challenge; start fresh.
fn close() {
    IDLE.with(|i| {
        if let Some(timer) = i.borrow_mut().take() {
            timer.stop();
        }
    });
    LOADING.with(|l| l.borrow_mut().take());
    if let Some(open) = OPEN.with(|o| o.borrow_mut().take()) {
        let _ = open.window.hide();
        drop(open);
    }
}
