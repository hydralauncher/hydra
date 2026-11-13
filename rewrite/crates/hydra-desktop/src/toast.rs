//! useToast(): one toast at a time, bottom right (components/toast).

use std::cell::RefCell;

use slint::ComponentHandle;

use crate::{AppWindow, Toast};

thread_local! {
    static WINDOW: RefCell<Option<slint::Weak<AppWindow>>> = const { RefCell::new(None) };
}

pub fn init(ui: &AppWindow) {
    WINDOW.with(|w| *w.borrow_mut() = Some(ui.as_weak()));
}

#[derive(Clone, Copy)]
pub enum Kind {
    Success,
    Error,
    Warning,
}

/// `showToast({ title, message, type })`. A toast that is already up keeps
/// its timer (the renderer's effect only restarts when `visible` flips).
pub fn show(kind: Kind, title: &str, message: Option<&str>) {
    show_for(kind, title, message, 2500);
}

/// showToast with a custom duration (milliseconds).
pub fn show_for(kind: Kind, title: &str, message: Option<&str>, duration: i64) {
    let Some(ui) = WINDOW.with(|w| w.borrow().as_ref().and_then(|w| w.upgrade())) else {
        return;
    };
    let toast = ui.global::<Toast>();
    toast.set_title(title.into());
    toast.set_message(message.unwrap_or_default().into());
    toast.set_kind(
        match kind {
            Kind::Success => "success",
            Kind::Error => "error",
            Kind::Warning => "warning",
        }
        .into(),
    );
    // Slint durations are i64 milliseconds.
    toast.set_duration(duration);
    toast.set_visible(true);
}

pub fn success(title: &str) {
    show(Kind::Success, title, None);
}

pub fn error(title: &str) {
    show(Kind::Error, title, None);
}

/// showErrorToast(title, message, duration)
pub fn error_with(title: &str, message: &str, duration: i64) {
    show_for(Kind::Error, title, Some(message), duration);
}
