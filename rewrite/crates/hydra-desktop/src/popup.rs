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

/// Radix menus left modal (the default): a layer over the window takes the
/// outside press and the wheel, so nothing below reacts (ui/app.slint).
const MODAL: [&str; 1] = ["sidebar-filters"];

/// A dialog opened from the open menu is up (create/rename collection, a
/// confirmation): context-menu.tsx ignores presses inside `[data-hydra-dialog]`
/// and the library Filters menu's onInteractOutside keeps it open too.
fn dialog_over_menu(ui: &AppWindow, open: &str) -> bool {
    (open == "context-menu" || open.starts_with("library-"))
        && (!ui.global::<crate::Dialogs>().get_kind().is_empty()
            || !ui.global::<crate::LibraryModals>().get_kind().is_empty())
}

/// The collection context menu stacked on a menu: a press inside it touches
/// nothing else; a press outside closes it and goes on to the menu below.
/// Returns true when the press was inside.
fn secondary_pressed(ui: &AppWindow, x: f32, y: f32) -> bool {
    let menu = ui.global::<crate::SecondaryMenu>();
    if !menu.get_open() {
        return false;
    }
    let inside = x >= menu.get_box_x()
        && x < menu.get_box_x() + menu.get_box_width()
        && y >= menu.get_box_y()
        && y < menu.get_box_y() + menu.get_box_height();
    if !inside {
        crate::context_menu::close_secondary();
    }
    inside
}

/// Call before the window handles a press at `(x, y)` (logical coordinates).
pub fn pointer_pressed(ui: &AppWindow, x: f32, y: f32) {
    if secondary_pressed(ui, x, y) {
        return;
    }
    let popup = ui.global::<Popup>();
    if popup.get_open().is_empty() || MODAL.contains(&popup.get_open().as_str()) {
        return;
    }
    if dialog_over_menu(ui, &popup.get_open()) {
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
    crate::context_menu::close_secondary();
}

/// Scrolling outside the open context menu closes it (context-menu.tsx
/// listens to scroll events in the capture phase).
pub fn wheel_at(ui: &AppWindow, x: f32, y: f32) {
    let secondary = ui.global::<crate::SecondaryMenu>();
    if secondary.get_open()
        && !(x >= secondary.get_box_x()
            && x < secondary.get_box_x() + secondary.get_box_width()
            && y >= secondary.get_box_y()
            && y < secondary.get_box_y() + secondary.get_box_height())
    {
        crate::context_menu::close_secondary();
    }
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

/// Escape closes the open menu (and the collection menu over it). Returns
/// true when the key is used up; with a dialog over the menu, the dialog
/// gets the key too (context-menu.tsx and the modal both listen for it).
pub fn escape(ui: &AppWindow) -> bool {
    let had_secondary = ui.global::<crate::SecondaryMenu>().get_open();
    crate::context_menu::close_secondary();
    let popup = ui.global::<Popup>();
    if popup.get_open().is_empty() {
        return had_secondary;
    }
    let dialog = dialog_over_menu(ui, &popup.get_open());
    close(ui);
    !dialog
}
