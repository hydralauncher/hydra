//! useGameCollections(): the user's collections (`/profile/games/collections`),
//! shared by the library page and the game context menu; and the collection
//! context menu with its rename and delete modals
//! (context/collection-context-menu).

use std::cell::RefCell;
use std::rc::Rc;

use hydra_core::api::{ApiError, Options};
use hydra_core::library_actions;
use serde_json::{Value, json};

use crate::context_menu::{self, Item};
use crate::{dialogs, shell, toast};

#[derive(Clone, Default)]
pub struct State {
    /// (id, name)
    pub items: Vec<(String, String)>,
    pub loaded: bool,
    pub failed: bool,
    pub loading: bool,
}

type Listener = Box<dyn Fn()>;

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
    static LISTENERS: RefCell<Vec<Listener>> = const { RefCell::new(Vec::new()) };
}

pub fn get() -> State {
    STATE.with(|s| s.borrow().clone())
}

/// Called after every load (success or failure).
pub fn subscribe(listener: impl Fn() + 'static) {
    LISTENERS.with(|l| l.borrow_mut().push(Box::new(listener)));
}

fn notify() {
    LISTENERS.with(|l| {
        for listener in l.borrow().iter() {
            listener();
        }
    });
}

thread_local! {
    /// isRenamingCollection || isDeletingCollection
    static BUSY: RefCell<bool> = const { RefCell::new(false) };
    /// isCollectionContextMenuOrModalOpen
    static MENU_OR_MODAL: RefCell<bool> = const { RefCell::new(false) };
}

/// The collection context menu or one of its modals is up (the game context
/// menu keeps its Collection submenu open meanwhile).
pub fn menu_or_modal_open() -> bool {
    MENU_OR_MODAL.with(|m| *m.borrow())
}

fn set_menu_or_modal(open: bool, on_change: &Option<Rc<dyn Fn(bool)>>) {
    MENU_OR_MODAL.with(|m| *m.borrow_mut() = open);
    if let Some(on_change) = on_change {
        on_change(open);
    }
}

fn menu_items() -> Vec<Item> {
    let busy = BUSY.with(|b| *b.borrow());
    vec![
        Item::new(
            "rename-collection",
            shell::tr("library.rename_collection"),
            "pencil",
        )
        .disabled(busy),
        Item::new(
            "delete-collection",
            shell::tr("library.delete_collection"),
            "trash",
        )
        .danger()
        .disabled(busy),
    ]
}

/// handleOpenCollectionContextMenu: a right-click on a collection at `(x, y)`.
/// `on_change` hears when the menu or its modals open and close.
pub fn open_context_menu(
    id: &str,
    name: &str,
    x: f32,
    y: f32,
    on_change: Option<Rc<dyn Fn(bool)>>,
) {
    let (id, name) = (id.to_string(), name.to_string());
    let on_close = {
        let on_change = on_change.clone();
        Rc::new(move || {
            // Unless the item opened a modal (it sets the flag again).
            set_menu_or_modal(false, &on_change);
        }) as Rc<dyn Fn()>
    };
    let handler = {
        let on_change = on_change.clone();
        move |item: &str| match item {
            "rename-collection" => open_rename(&id, &name, on_change.clone()),
            "delete-collection" => open_delete(&id, &name, on_change.clone()),
            _ => {}
        }
    };
    set_menu_or_modal(true, &on_change);
    context_menu::show_secondary(x, y, menu_items(), handler, Some(on_close));
}

/// resolveCollectionErrorMessage
fn error_message(error: &ApiError, fallback: &str) -> String {
    let text = error.to_string();
    if text.contains("game/collection-name-already-in-use") {
        return shell::tr("sidebar.collection_name_already_in_use");
    }
    if text.contains("game/collection-name-required") {
        return shell::tr("sidebar.collection_name_required");
    }
    shell::tr(fallback)
}

fn set_busy(busy: bool) {
    BUSY.with(|b| *b.borrow_mut() = busy);
    if context_menu::secondary_open() {
        context_menu::update_secondary(menu_items());
    }
}

/// The rename modal (a Modal with the name field, Cancel / Rename).
fn open_rename(id: &str, name: &str, on_change: Option<Rc<dyn Fn(bool)>>) {
    let (id, original) = (id.to_string(), name.to_string());
    dialogs::field(
        dialogs::Field {
            title: &shell::tr("library.rename_collection"),
            description: &shell::tr("library.rename_collection_description"),
            label: &shell::tr("sidebar.collection_name"),
            placeholder: &shell::tr("sidebar.collection_name_placeholder"),
            text: name,
            confirm_label: &shell::tr("library.rename_collection"),
            cancel_label: &shell::tr("sidebar.cancel"),
        },
        move |text| rename(&id, &original, &text),
    );
    dialogs::set_field_extras("", slint::Image::default(), Some(60));
    dialogs::set_field_needs_text();
    set_menu_or_modal(true, &on_change);
    dialogs::set_on_closed(move || set_menu_or_modal(false, &on_change));
}

/// handleRenameCollection: PUT /profile/games/collections/:id { name }.
fn rename(id: &str, original: &str, text: &str) {
    if BUSY.with(|b| *b.borrow()) {
        return;
    }
    let next = text.trim().to_string();
    if next.is_empty() {
        toast::error(&shell::tr("sidebar.collection_name_required"));
        return;
    }
    if next == original.trim() {
        dialogs::close();
        return;
    }
    let Some(api) = shell::api() else { return };
    set_busy(true);
    dialogs::set_field_busy(true, &shell::tr("library.renaming_collection"));
    let id = id.to_string();
    std::thread::spawn(move || {
        let result = api.put(
            &format!("/profile/games/collections/{id}"),
            &json!({ "name": next }),
            Options {
                needs_auth: true,
                ..Default::default()
            },
        );
        let _ = slint::invoke_from_event_loop(move || {
            set_busy(false);
            dialogs::set_field_busy(false, &shell::tr("library.rename_collection"));
            match result {
                Ok(_) => {
                    // await loadCollections(), then the toast and close.
                    load();
                    toast::success(&shell::tr("library.collection_renamed"));
                    dialogs::close();
                }
                Err(error) => {
                    toast::error(&error_message(&error, "library.failed_rename_collection"))
                }
            }
        });
    });
}

/// The delete confirmation (ConfirmationModal, primary confirm button).
fn open_delete(id: &str, name: &str, on_change: Option<Rc<dyn Fn(bool)>>) {
    let id = id.to_string();
    let body = shell::tr_with(
        "library.delete_collection_description",
        &[("collectionName", name.to_string().into())],
    );
    dialogs::confirm(
        dialogs::Confirm {
            title: &shell::tr("library.delete_collection_title"),
            description: "",
            body: &body,
            confirm_label: &shell::tr("library.delete_collection"),
            cancel_label: &shell::tr("sidebar.cancel"),
            danger: false,
        },
        move || delete(&id),
    );
    set_menu_or_modal(true, &on_change);
    dialogs::set_on_closed(move || set_menu_or_modal(false, &on_change));
}

/// handleDeleteCollection: DELETE the collection, take custom games out of
/// it locally, leave it if it was selected, reload.
fn delete(id: &str) {
    if BUSY.with(|b| *b.borrow()) {
        return;
    }
    let (Some(api), Some(db)) = (shell::api(), shell::db()) else {
        return;
    };
    set_busy(true);
    dialogs::set_busy(true);
    // library.filter(game => game.shop === "custom" && ids.includes(id))
    let custom: Vec<(String, Vec<String>)> = shell::library_snapshot()
        .map(|(groups, _, _)| {
            groups
                .iter()
                .flat_map(|g| g.members.iter())
                .filter(|m| m.shop() == "custom" && m.collection_ids().iter().any(|c| c == id))
                .map(|m| {
                    (
                        m.object_id().to_string(),
                        m.collection_ids().into_iter().filter(|c| c != id).collect(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let id = id.to_string();
    std::thread::spawn(move || {
        let result = api
            .delete(
                &format!("/profile/games/collections/{id}"),
                Options {
                    needs_auth: true,
                    ..Default::default()
                },
            )
            .and_then(|_| {
                for (object_id, ids) in &custom {
                    if let Err(error) =
                        library_actions::assign_collections(&db, &api, "custom", object_id, ids)
                    {
                        return Err(ApiError::Network(error.to_string()));
                    }
                }
                Ok(())
            });
        let _ = slint::invoke_from_event_loop(move || {
            set_busy(false);
            dialogs::set_busy(false);
            match result {
                Ok(()) => {
                    crate::library_page::on_collection_deleted(&id);
                    load();
                    shell::load_library();
                    toast::success(&shell::tr("library.collection_deleted"));
                    dialogs::close();
                }
                Err(error) => {
                    toast::error(&error_message(&error, "library.failed_delete_collection"))
                }
            }
        });
    });
}

/// `loadCollections()`: one request at a time.
pub fn load() {
    if !shell::signed_in() || STATE.with(|s| s.borrow().loading) {
        return;
    }
    let Some(api) = shell::api() else { return };
    STATE.with(|s| s.borrow_mut().loading = true);
    notify();
    std::thread::spawn(move || {
        let result = api.get(
            "/profile/games/collections",
            &[],
            Options {
                needs_auth: true,
                ..Default::default()
            },
        );
        let _ = slint::invoke_from_event_loop(move || {
            STATE.with(|s| {
                let mut s = s.borrow_mut();
                s.loading = false;
                match result {
                    Ok(Value::Array(items)) => {
                        s.items = items
                            .iter()
                            .filter_map(|c| {
                                Some((
                                    c.get("id")?.as_str()?.to_string(),
                                    c.get("name")?.as_str()?.to_string(),
                                ))
                            })
                            .collect();
                        s.loaded = true;
                        s.failed = false;
                    }
                    Ok(other) => {
                        eprintln!(
                            "Expected an array from /profile/games/collections, received {other}"
                        );
                        s.items.clear();
                        s.loaded = true;
                    }
                    Err(error) => {
                        eprintln!("collections: {error}");
                        s.failed = true;
                    }
                }
            });
            notify();
        });
    });
}
