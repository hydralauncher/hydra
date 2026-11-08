//! The auth window on Linux (WindowManager.openLinuxAuthWindow).
//!
//! WebKitGTK can't be a child of a winit window on Wayland (and on X11 it
//! needs GTK anyway), so on Linux the auth site gets its own GTK window, with
//! the frame Electron draws there: frameless, a 1px border, and the 34px
//! WindowTitleBar ("Hydra", minimize, close) above the 600x640 web view. GTK
//! is pumped from a Slint timer only while the window is open.

use std::cell::RefCell;
use std::time::Duration;

use gtk::glib;
use gtk::prelude::*;
use wry::WebViewBuilderExtUnix;

/// AUTH_WINDOW_CONTENT_WIDTH / _HEIGHT, CUSTOM_WINDOW_TITLE_BAR_HEIGHT,
/// CUSTOM_WINDOW_BORDER_WIDTH, WINDOW_TITLE_BAR_CONTROL_WIDTH
const CONTENT_WIDTH: i32 = 600;
const CONTENT_HEIGHT: i32 = 640;
const TITLE_BAR_HEIGHT: i32 = 34;
const BORDER_WIDTH: i32 = 1;
const CONTROL_WIDTH: i32 = 46;

/// window-title-bar.scss and auth-window.scss, in GTK CSS. The header's 34px
/// include its 1px bottom border (border-box), so min-height is 33px.
const CSS: &str = "
.hydra-auth-frame {
  background-color: #0d0d0d;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.hydra-auth-title-bar {
  background-color: #0d0d0d;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  min-height: 33px;
}
.hydra-auth-title-bar label {
  color: #f0f1f7;
  font-family: 'Noto Sans', sans-serif;
  font-size: 12px;
  font-weight: 500;
  padding-left: 16px;
}
.hydra-auth-control {
  background: none;
  border: none;
  border-radius: 0;
  box-shadow: none;
  outline: none;
  padding: 0;
  min-width: 46px;
  min-height: 33px;
  color: #f0f1f7;
  transition: background-color 200ms ease, color 200ms ease;
}
.hydra-auth-control:hover {
  background-color: rgba(255, 255, 255, 0.08);
  color: #dadbe1;
}
.hydra-auth-close:hover {
  background-color: #e11d48;
  color: #ffffff;
}
";

struct Open {
    window: gtk::Window,
    // Dropped before the window.
    webview: Option<wry::WebView>,
    _pump: slint::Timer,
}

thread_local! {
    static OPEN: RefCell<Option<Open>> = const { RefCell::new(None) };
    static READY: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}

/// gtk::init once, on the UI thread (the thread Slint runs on). Its app id
/// (the program name) matches the desktop file, like the main window's.
fn ensure_gtk() -> bool {
    if let Some(ready) = READY.with(std::cell::Cell::get) {
        return ready;
    }
    glib::set_prgname(Some(crate::linux::APP_ID));
    let ready = match gtk::init() {
        Ok(()) => {
            let provider = gtk::CssProvider::new();
            if let Err(error) = provider.load_from_data(CSS.as_bytes()) {
                eprintln!("auth window css: {error}");
            }
            if let Some(screen) = gtk::gdk::Screen::default() {
                gtk::StyleContext::add_provider_for_screen(
                    &screen,
                    &provider,
                    gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
                );
            }
            true
        }
        Err(error) => {
            eprintln!("auth window: GTK failed to start: {error}");
            false
        }
    };
    READY.with(|r| r.set(Some(ready)));
    ready
}

/// Advance GTK (and WebKit's IPC on the default main context) without blocking.
fn pump() {
    while gtk::events_pending() {
        gtk::main_iteration_do(false);
    }
}

/// DashIcon / XIcon (octicons, 16px), stroked with the button's CSS color so
/// the hover colors and their 200ms transition apply.
fn control(kind: &'static str) -> gtk::Button {
    let button = gtk::Button::new();
    button.style_context().add_class("hydra-auth-control");
    if kind == "close" {
        button.style_context().add_class("hydra-auth-close");
    }
    button.set_can_focus(false);
    let area = gtk::DrawingArea::new();
    area.set_size_request(CONTROL_WIDTH, TITLE_BAR_HEIGHT - 1);
    area.connect_draw(move |area, cr| {
        let color = area.style_context().color(area.state_flags());
        cr.set_source_rgba(color.red(), color.green(), color.blue(), color.alpha());
        cr.set_line_width(1.5);
        cr.set_line_cap(gtk::cairo::LineCap::Round);
        let x = f64::from(area.allocated_width() - 16) / 2.0;
        let y = f64::from(area.allocated_height() - 16) / 2.0;
        if kind == "close" {
            cr.move_to(x + 4.25, y + 4.25);
            cr.line_to(x + 11.75, y + 11.75);
            cr.move_to(x + 11.75, y + 4.25);
            cr.line_to(x + 4.25, y + 11.75);
        } else {
            cr.move_to(x + 2.75, y + 7.75);
            cr.line_to(x + 12.75, y + 7.75);
        }
        let _ = cr.stroke();
        glib::Propagation::Proceed
    });
    button.add(&area);
    button
}

fn title_bar(window: &gtk::Window) -> gtk::EventBox {
    let row = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    row.style_context().add_class("hydra-auth-title-bar");
    let title = gtk::Label::new(Some("Hydra"));
    title.set_halign(gtk::Align::Start);
    row.pack_start(&title, true, true, 0);
    let minimize = control("minimize");
    minimize.set_tooltip_text(Some(&crate::shell::tr("header.minimize")));
    let weak = window.downgrade();
    minimize.connect_clicked(move |_| {
        // minimizeAuthWindow
        if let Some(window) = weak.upgrade() {
            window.iconify();
        }
    });
    let close = control("close");
    close.set_tooltip_text(Some(&crate::shell::tr("header.close")));
    // closeAuthWindow, after this GTK callback returns
    close.connect_clicked(|_| defer_close());
    row.pack_start(&minimize, false, false, 0);
    row.pack_start(&close, false, false, 0);
    // -webkit-app-region: drag
    let drag = gtk::EventBox::new();
    drag.add(&row);
    let weak = window.downgrade();
    drag.connect_button_press_event(move |_, event| {
        if event.button() == 1
            && let Some(window) = weak.upgrade()
        {
            let (x, y) = event.root();
            window.begin_move_drag(1, x as i32, y as i32, event.time());
        }
        glib::Propagation::Proceed
    });
    drag
}

fn defer_close() {
    slint::Timer::single_shot(Duration::ZERO, crate::auth::close);
}

pub fn is_open() -> bool {
    OPEN.with(|o| o.borrow().is_some())
}

/// Bring the open window forward.
pub fn present() {
    OPEN.with(|o| {
        if let Some(open) = o.borrow().as_ref() {
            open.window.present();
        }
    });
}

/// openLinuxAuthWindow: the frame, then the auth site in it.
pub fn open(url: &str, on_navigation: fn(String) -> bool) {
    if is_open() {
        present();
        return;
    }
    if !ensure_gtk() {
        return;
    }
    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_title("Hydra");
    window.set_decorated(false);
    window.set_resizable(false);
    window.set_position(gtk::WindowPosition::Center);
    window.set_default_size(
        CONTENT_WIDTH + BORDER_WIDTH * 2,
        CONTENT_HEIGHT + TITLE_BAR_HEIGHT + BORDER_WIDTH * 2,
    );
    if let Some(icon) = window_icon() {
        window.set_icon(Some(&icon));
    }
    let frame = gtk::Box::new(gtk::Orientation::Vertical, 0);
    frame.style_context().add_class("hydra-auth-frame");
    frame.pack_start(&title_bar(&window), false, false, 0);
    let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
    content.set_size_request(CONTENT_WIDTH, CONTENT_HEIGHT);
    frame.pack_start(&content, true, true, 0);
    window.add(&frame);
    // the window manager's close (Alt+F4 and the like)
    window.connect_delete_event(|_, _| {
        defer_close();
        glib::Propagation::Stop
    });
    window.show_all();

    let webview = wry::WebViewBuilder::new()
        .with_url(url)
        .with_background_color((0x1c, 0x1c, 0x1c, 0xff))
        .with_navigation_handler(on_navigation)
        .build_gtk(&content);
    let webview = match webview {
        Ok(webview) => webview,
        Err(error) => {
            eprintln!("auth webview: {error}");
            // SAFETY: the window is ours and nothing else holds it.
            unsafe { window.destroy() };
            pump();
            return;
        }
    };
    content.show_all();
    let pump_timer = slint::Timer::default();
    pump_timer.start(slint::TimerMode::Repeated, Duration::from_millis(8), pump);
    OPEN.with(|o| {
        *o.borrow_mut() = Some(Open {
            window,
            webview: Some(webview),
            _pump: pump_timer,
        })
    });
}

/// BrowserWindow({ icon }) for the auth window too.
fn window_icon() -> Option<gtk::gdk_pixbuf::Pixbuf> {
    static ICON: &[u8] = include_bytes!("../../../../resources/icon.png");
    let image = image::load_from_memory(ICON)
        .ok()?
        .resize_exact(64, 64, image::imageops::FilterType::Lanczos3)
        .into_rgba8();
    let (width, height) = image.dimensions();
    let bytes = glib::Bytes::from_owned(image.into_raw());
    Some(gtk::gdk_pixbuf::Pixbuf::from_bytes(
        &bytes,
        gtk::gdk_pixbuf::Colorspace::Rgb,
        true,
        8,
        width as i32,
        height as i32,
        width as i32 * 4,
    ))
}

/// Close and forget the window (the webview first).
pub fn close() {
    let open = OPEN.with(|o| o.borrow_mut().take());
    if let Some(mut open) = open {
        drop(open.webview.take());
        // SAFETY: the window is ours and nothing else holds it.
        unsafe { open.window.destroy() };
        // let GTK process the destruction before the pump stops
        pump();
    }
}
