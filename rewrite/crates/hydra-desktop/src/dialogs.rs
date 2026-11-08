//! App-level dialogs (ui/components/dialogs.slint): confirmation modals and
//! the create-collection modal, opened from menus anywhere.

use std::cell::RefCell;
use std::rc::Rc;

use hydra_core::api::{ApiError, Options};
use hydra_media::images;
use serde_json::{Value, json};
use slint::{ComponentHandle, Image};

use crate::{AppWindow, Dialogs, collections, shell, toast};

type Action = Rc<dyn Fn()>;

struct State {
    ui: slint::Weak<AppWindow>,
    on_confirm: Option<Action>,
    on_created: Option<Rc<dyn Fn(String)>>,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

pub fn init(ui: &AppWindow) {
    STATE.with(|s| {
        *s.borrow_mut() = Some(State {
            ui: ui.as_weak(),
            on_confirm: None,
            on_created: None,
        })
    });
    let dialogs = ui.global::<Dialogs>();
    dialogs.on_confirmed(|| {
        let kind = window()
            .map(|ui| ui.global::<Dialogs>().get_kind().to_string())
            .unwrap_or_default();
        if kind == "create-collection" {
            create_collection();
        } else if let Some(action) =
            STATE.with(|s| s.borrow().as_ref().and_then(|s| s.on_confirm.clone()))
        {
            action();
        }
    });
    dialogs.on_cancelled(|| {});
    dialogs.on_field_edited(|text| {
        if let Some(ui) = window() {
            let dialogs = ui.global::<Dialogs>();
            // maxLength={60} (create-collection-modal)
            if dialogs.get_kind() == "create-collection" && text.chars().count() > 60 {
                dialogs.set_field_text(text.chars().take(60).collect::<String>().into());
            }
            dialogs.set_field_error(Default::default());
        }
    });
}

fn window() -> Option<AppWindow> {
    STATE.with(|s| s.borrow().as_ref().and_then(|s| s.ui.upgrade()))
}

/// The modal's backdrop-filter: blur(2px), from a snapshot of the window.
fn snapshot_backdrop(ui: &AppWindow) {
    let dialogs = ui.global::<Dialogs>();
    dialogs.set_backdrop(Image::default());
    let Ok(snapshot) = ui.window().take_snapshot() else {
        return;
    };
    let scale = ui.window().scale_factor();
    let (w, h) = (snapshot.width(), snapshot.height());
    let rgba = snapshot.as_bytes().to_vec();
    let weak = ui.as_weak();
    let sigma = 2.0 * scale / 2.0;
    std::thread::spawn(move || {
        let Some(pixels) = images::blur_rgba(w, h, rgba, 2, sigma) else {
            return;
        };
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = weak.upgrade() {
                ui.global::<Dialogs>().set_backdrop(pixels.into_image());
            }
        });
    });
}

pub struct Confirm<'a> {
    pub title: &'a str,
    pub description: &'a str,
    pub body: &'a str,
    pub confirm_label: &'a str,
    pub cancel_label: &'a str,
    pub danger: bool,
}

/// ConfirmationModal / RemoveGameFromLibraryModal. `on_confirm` runs on the
/// confirm button; call `close()` when done.
pub fn confirm(spec: Confirm, on_confirm: impl Fn() + 'static) {
    let Some(ui) = window() else { return };
    snapshot_backdrop(&ui);
    let dialogs = ui.global::<Dialogs>();
    dialogs.set_title(spec.title.into());
    dialogs.set_description(spec.description.into());
    dialogs.set_body(spec.body.into());
    dialogs.set_confirm_label(spec.confirm_label.into());
    dialogs.set_cancel_label(spec.cancel_label.into());
    dialogs.set_confirm_kind(if spec.danger { "danger" } else { "primary" }.into());
    dialogs.set_busy(false);
    dialogs.set_checkbox_label("".into());
    dialogs.set_checkbox_checked(false);
    STATE.with(|s| {
        if let Some(s) = s.borrow_mut().as_mut() {
            s.on_confirm = Some(Rc::new(on_confirm));
        }
    });
    dialogs.set_kind("confirm".into());
}

/// A checkbox above the confirm buttons (call right after `confirm`).
pub fn set_checkbox(label: &str) {
    if let Some(ui) = window() {
        ui.global::<Dialogs>().set_checkbox_label(label.into());
    }
}

/// The checkbox state when the dialog is confirmed.
pub fn checkbox_checked() -> bool {
    window().is_some_and(|ui| ui.global::<Dialogs>().get_checkbox_checked())
}

/// A one-field form (AddDownloadSourceModal): `on_submit` gets the text;
/// use `set_field_busy` / `set_field_error` and `close()` from it.
pub struct Field<'a> {
    pub title: &'a str,
    pub description: &'a str,
    pub label: &'a str,
    pub placeholder: &'a str,
    pub text: &'a str,
    pub confirm_label: &'a str,
    pub cancel_label: &'a str,
}

pub fn field(spec: Field, on_submit: impl Fn(String) + 'static) {
    let Some(ui) = window() else { return };
    snapshot_backdrop(&ui);
    let dialogs = ui.global::<Dialogs>();
    dialogs.set_title(spec.title.into());
    dialogs.set_description(spec.description.into());
    dialogs.set_field_label(spec.label.into());
    dialogs.set_field_placeholder(spec.placeholder.into());
    dialogs.set_field_text(spec.text.into());
    dialogs.set_field_error(Default::default());
    dialogs.set_confirm_label(spec.confirm_label.into());
    dialogs.set_cancel_label(spec.cancel_label.into());
    dialogs.set_busy(false);
    let on_submit = Rc::new(on_submit);
    STATE.with(|s| {
        if let Some(s) = s.borrow_mut().as_mut() {
            let on_submit = on_submit.clone();
            s.on_confirm = Some(Rc::new(move || {
                let text = window()
                    .map(|ui| ui.global::<Dialogs>().get_field_text().to_string())
                    .unwrap_or_default();
                on_submit(text);
            }));
        }
    });
    dialogs.set_kind("field".into());
}

/// The field dialog is working: buttons disabled, confirm label swapped.
pub fn set_field_busy(busy: bool, confirm_label: &str) {
    if let Some(ui) = window() {
        let dialogs = ui.global::<Dialogs>();
        dialogs.set_busy(busy);
        dialogs.set_confirm_label(confirm_label.into());
    }
}

pub fn set_field_error(message: &str) {
    if let Some(ui) = window() {
        ui.global::<Dialogs>().set_field_error(message.into());
    }
}

/// Close the open dialog with its exit animation.
/// Disables the dialog buttons (buttonsIsDisabled).
pub fn set_busy(busy: bool) {
    if let Some(ui) = window() {
        ui.global::<Dialogs>().set_busy(busy);
    }
}

pub fn close() {
    if let Some(ui) = window() {
        let dialogs = ui.global::<Dialogs>();
        dialogs.set_busy(false);
        dialogs.set_close_request(dialogs.get_close_request() + 1);
    }
}

/// CreateCollectionModal; `on_created` gets the new collection's id.
pub fn create_collection_modal(on_created: Option<Rc<dyn Fn(String)>>) {
    let Some(ui) = window() else { return };
    if !shell::signed_in() {
        crate::auth::open(crate::auth::Page::SignIn);
        return;
    }
    snapshot_backdrop(&ui);
    let dialogs = ui.global::<Dialogs>();
    dialogs.set_title(shell::tr("sidebar.create_collection").into());
    dialogs.set_description(shell::tr("sidebar.create_collection_description").into());
    dialogs.set_field_label(shell::tr("sidebar.collection_name").into());
    dialogs.set_field_placeholder(shell::tr("sidebar.collection_name_placeholder").into());
    dialogs.set_field_text(Default::default());
    dialogs.set_field_error(Default::default());
    dialogs.set_confirm_label(shell::tr("sidebar.create").into());
    dialogs.set_cancel_label(shell::tr("sidebar.cancel").into());
    dialogs.set_busy(false);
    STATE.with(|s| {
        if let Some(s) = s.borrow_mut().as_mut() {
            s.on_created = on_created;
        }
    });
    dialogs.set_kind("create-collection".into());
}

/// handleCreate: validate, POST /profile/games/collections, toast.
fn create_collection() {
    let Some(ui) = window() else { return };
    let dialogs = ui.global::<Dialogs>();
    if dialogs.get_busy() {
        return;
    }
    let name = dialogs.get_field_text().trim().to_string();
    if name.is_empty() {
        dialogs.set_field_error(shell::tr("sidebar.collection_name_required").into());
        return;
    }
    let normalized = name.to_lowercase();
    if collections::get()
        .items
        .iter()
        .any(|(_, n)| n.trim().to_lowercase() == normalized)
    {
        dialogs.set_field_error(shell::tr("sidebar.collection_name_already_in_use").into());
        return;
    }
    let Some(api) = shell::api() else { return };
    dialogs.set_busy(true);
    std::thread::spawn(move || {
        let result = api.post(
            "/profile/games/collections",
            &json!({ "name": name }),
            Options {
                needs_auth: true,
                ..Default::default()
            },
        );
        let _ = slint::invoke_from_event_loop(move || {
            let Some(ui) = window() else { return };
            let dialogs = ui.global::<Dialogs>();
            dialogs.set_busy(false);
            match result {
                Ok(collection) => {
                    toast::success(&shell::tr("sidebar.collection_created"));
                    let id = collection
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    collections::load();
                    let created =
                        STATE.with(|s| s.borrow().as_ref().and_then(|s| s.on_created.clone()));
                    if let Some(created) = created {
                        created(id);
                    }
                    close();
                }
                Err(error) => {
                    let code = match &error {
                        ApiError::Status {
                            body: Some(body), ..
                        } => body
                            .get("message")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        _ => None,
                    };
                    match code.as_deref() {
                        Some("game/collection-name-already-in-use") => dialogs.set_field_error(
                            shell::tr("sidebar.collection_name_already_in_use").into(),
                        ),
                        Some("game/collection-name-required") => dialogs
                            .set_field_error(shell::tr("sidebar.collection_name_required").into()),
                        Some("game/collection-limit-reached") => {
                            toast::error(&shell::tr("sidebar.collection_limit_reached"))
                        }
                        _ => toast::error(&shell::tr("sidebar.failed_create_collection")),
                    }
                }
            }
        });
    });
}
