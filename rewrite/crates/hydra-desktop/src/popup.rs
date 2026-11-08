//! Dropdowns and context menus (the `Popup` global): Radix's non-modal
//! dismissal. A press outside the open menu (and outside its trigger, which
//! toggles it itself) closes it, and the press still reaches what is below.

use std::cell::RefCell;

use slint::ComponentHandle;

use crate::{AppWindow, Popup};

thread_local! {
    static WINDOW: RefCell<Option<slint::Weak<AppWindow>>> = const { RefCell::new(None) };
}

pub fn init(ui: &AppWindow) {
    WINDOW.with(|w| *w.borrow_mut() = Some(ui.as_weak()));
}

/// `pointer_pressed` for code without the window handle (the dev script).
pub fn pointer_pressed_at(x: f32, y: f32) {
    if let Some(ui) = WINDOW.with(|w| w.borrow().as_ref().and_then(|w| w.upgrade())) {
        pointer_pressed(&ui, x, y);
    }
}

/// Call before the window handles a press at `(x, y)` (logical coordinates).
pub fn pointer_pressed(ui: &AppWindow, x: f32, y: f32) {
    let popup = ui.global::<Popup>();
    if popup.get_open().is_empty() {
        return;
    }
    let inside =
        |bx: f32, by: f32, bw: f32, bh: f32| x >= bx && x < bx + bw && y >= by && y < by + bh;
    let in_menu = inside(
        popup.get_box_x(),
        popup.get_box_y(),
        popup.get_box_width(),
        popup.get_box_height(),
    ) || inside(
        popup.get_box2_x(),
        popup.get_box2_y(),
        popup.get_box2_width(),
        popup.get_box2_height(),
    );
    let in_trigger = inside(
        popup.get_anchor_x(),
        popup.get_anchor_y(),
        popup.get_anchor_width(),
        popup.get_anchor_height(),
    );
    if std::env::var_os("HYDRA_DEBUG_POPUP").is_some() {
        eprintln!(
            "popup: press {x},{y} open={} box=({},{},{},{}) box2=({},{},{},{}) in_menu={in_menu} in_trigger={in_trigger}",
            popup.get_open(),
            popup.get_box_x(),
            popup.get_box_y(),
            popup.get_box_width(),
            popup.get_box_height(),
            popup.get_box2_x(),
            popup.get_box2_y(),
            popup.get_box2_width(),
            popup.get_box2_height()
        );
    }
    if !in_menu && !in_trigger {
        close(ui);
    }
}

pub fn close(ui: &AppWindow) {
    let popup = ui.global::<Popup>();
    popup.set_open(Default::default());
    popup.set_box2_width(0.0);
}

/// Scrolling outside the open context menu closes it (context-menu.tsx
/// listens to scroll events in the capture phase).
pub fn wheel_at(ui: &AppWindow, x: f32, y: f32) {
    let popup = ui.global::<Popup>();
    if popup.get_open() != "context-menu" {
        return;
    }
    let inside =
        |bx: f32, by: f32, bw: f32, bh: f32| x >= bx && x < bx + bw && y >= by && y < by + bh;
    if !inside(
        popup.get_box_x(),
        popup.get_box_y(),
        popup.get_box_width(),
        popup.get_box_height(),
    ) && !inside(
        popup.get_box2_x(),
        popup.get_box2_y(),
        popup.get_box2_width(),
        popup.get_box2_height(),
    ) {
        close(ui);
    }
}

/// Escape closes the open menu.
pub fn escape(ui: &AppWindow) -> bool {
    let popup = ui.global::<Popup>();
    if popup.get_open().is_empty() {
        return false;
    }
    close(ui);
    true
}
