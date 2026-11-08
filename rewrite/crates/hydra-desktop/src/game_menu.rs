//! components/game-context-menu (game-context-menu.tsx + use-game-actions.ts):
//! the right-click menu of library cards and sidebar rows.
//!
//! Library writes (favorites, pin, visibility, collections) run on a worker
//! through hydra_core::library_actions, then the library reloads
//! (`updateLibrary()`) and a toast reports the result.

use std::cell::RefCell;
use std::rc::Rc;

use hydra_core::library::Presentation;
use hydra_core::library_actions::{self, Visibility};
use serde_json::Value;

use crate::context_menu::{self, Item};
use crate::{collections, nav, shell, toast};

const FAVORITES_COLLECTION_ID: &str = "__favorites__";

/// What the open menu shows and the state its toggles keep locally.
struct Open {
    group: Rc<Presentation>,
    favorite: bool,
    collection_ids: Vec<String>,
    hidden_from_others: bool,
    concealed: bool,
    favorite_pending: bool,
    collection_pending: Option<String>,
    visibility_pending: bool,
    /// The library's selected collection (closing rules when a game leaves it).
    selected_collection: Option<String>,
}

thread_local! {
    static OPEN: RefCell<Option<Open>> = const { RefCell::new(None) };
}

fn t(key: &str) -> String {
    shell::tr(key)
}

/// `game.executablePath`, or a classics game with discs (`canPlay`).
fn can_play(group: &Presentation) -> bool {
    let game = &group.game;
    game.executable_path().is_some_and(|p| !p.is_empty())
        || (game.shop() == "launchbox"
            && game
                .get("discs")
                .and_then(Value::as_array)
                .is_some_and(|d| !d.is_empty()))
}

fn items(open: &Open) -> Vec<Item> {
    let group = &open.group;
    let game = &group.game;
    let signed_in = shell::signed_in();
    let has_executable = game.executable_path().is_some_and(|p| !p.is_empty());
    let collections_state = collections::get();
    // TODO(launcher): isGameRunning from onGamesRunning; TODO(downloads): isDeleting / isGameDownloading.
    let running = false;
    let playable = can_play(group);

    let mut collection_items = vec![
        Item::new(
            "favorite",
            t("sidebar.favorites"),
            if open.favorite { "heart-fill" } else { "heart" },
        )
        .keep_open(),
    ];
    for (id, name) in &collections_state.items {
        collection_items.push(
            Item::new(
                format!("collection-{id}"),
                name.clone(),
                if open.collection_ids.contains(id) {
                    "folder-fill"
                } else {
                    "folder"
                },
            )
            .keep_open(),
        );
    }
    collection_items.push(
        Item::new(
            "collection-create",
            t("game_details.create_collection"),
            "plus",
        )
        .separator(!collections_state.items.is_empty())
        .keep_open()
        .disabled(open.collection_pending.is_some()),
    );
    let collection_submenu = if collections_state.loading {
        vec![Item::new("collection-loading", t("game_details.loading"), "").disabled(true)]
    } else {
        collection_items
    };

    let mut list = vec![
        Item::new(
            "play",
            if running {
                t("game_details.close")
            } else if playable {
                t("game_details.play")
            } else {
                t("game_details.download")
            },
            if running {
                "x"
            } else if playable {
                "play"
            } else {
                "download"
            },
        ),
        Item::new("collection", t("game_details.collection"), "folder")
            .disabled(open.favorite_pending || open.collection_pending.is_some())
            .submenu(collection_submenu),
    ];
    if has_executable {
        list.push(
            Item::new(
                "shortcuts",
                t("game_details.create_shortcut_simple"),
                "link",
            )
            .submenu(vec![
                Item::new(
                    "desktop-shortcut",
                    t("game_details.create_shortcut_simple"),
                    "link",
                ),
                Item::new(
                    "steam-shortcut",
                    t("game_details.create_steam_shortcut"),
                    "steam",
                ),
            ]),
        );
    }
    let pinned = game.flag("isPinned");
    let mut manage = vec![
        Item::new(
            "pin-game",
            if pinned {
                t("game_details.unpin_game")
            } else {
                t("game_details.pin_game")
            },
            if pinned { "pin-slash" } else { "pin" },
        ),
        Item::new("customize", t("game_details.customize_game"), "image"),
    ];
    if game.shop() != "custom" {
        manage.push(
            Item::new(
                "hide-game",
                if open.hidden_from_others {
                    t("game_details.unhide_game")
                } else {
                    t("game_details.hide_game")
                },
                "eye-closed",
            )
            .keep_open()
            .disabled(open.visibility_pending || !signed_in),
        );
    }
    manage.push(
        Item::new(
            "conceal-game",
            if open.concealed {
                t("game_details.reveal_game")
            } else {
                t("game_details.conceal_game")
            },
            "lock",
        )
        .keep_open()
        .disabled(open.visibility_pending || !signed_in),
    );
    if has_executable {
        manage.push(Item::new(
            "open-folder",
            t("game_details.open_folder"),
            "folder",
        ));
        manage.push(Item::new(
            "download-options",
            t("game_details.open_download_options"),
            "download",
        ));
    }
    let download_path = group.members.iter().find_map(|m| {
        m.download()
            .and_then(|d| d.get("downloadPath"))
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    if download_path.is_some() {
        manage.push(Item::new(
            "download-location",
            t("game_details.open_download_location"),
            "folder",
        ));
    }
    manage.push(
        Item::new("remove-library", t("game_details.remove_from_library"), "x")
            .danger()
            .keep_open(),
    );
    // TODO(downloads): "remove-files" (getRemoveFilesTarget / Steam uninstall probe).
    list.push(Item::new("manage", t("game_details.options"), "gear").submenu(manage));
    list.push(Item::new("properties", t("game_details.properties"), "pencil").separator(true));
    list
}

fn refresh() {
    if let Some(items) = OPEN.with(|o| o.borrow().as_ref().map(items)) {
        context_menu::update(items);
    }
}

/// Right-click on a library game.
pub fn show(group: Rc<Presentation>, x: f32, y: f32, selected_collection: Option<String>) {
    let game = &group.game;
    let open = Open {
        favorite: game.flag("favorite"),
        collection_ids: game.collection_ids(),
        hidden_from_others: game.flag("isHiddenFromOthers"),
        concealed: game.flag("isConcealed"),
        favorite_pending: false,
        collection_pending: None,
        visibility_pending: false,
        selected_collection,
        group: group.clone(),
    };
    let list = items(&open);
    let plain_danger = !game.executable_path().is_some_and(|p| !p.is_empty());
    OPEN.with(|o| *o.borrow_mut() = Some(open));
    context_menu::show(x, y, list, plain_danger, activated, None);
    // useEffect([visible]): collections load whenever the menu opens.
    if shell::signed_in() {
        collections::load();
    }
}

/// Collections finished loading: rebuild the submenu if the menu is up.
pub fn on_collections_changed() {
    if context_menu::is_open() {
        refresh();
    }
}

fn members(group: &Presentation) -> Vec<(String, String)> {
    group
        .members
        .iter()
        .map(|m| (m.shop().to_string(), m.object_id().to_string()))
        .collect()
}

/// `applyLibraryGroupAction`: run `action` for every member on a worker.
fn run_for_members(
    group: &Presentation,
    action: impl Fn(
        &hydra_db::Db,
        &hydra_core::api::HydraApi,
        &str,
        &str,
    ) -> Result<(), library_actions::ActionError>
    + Send
    + 'static,
    done: impl FnOnce(Result<(), String>) + Send + 'static,
) {
    let (Some(db), Some(api)) = (shell::db(), shell::api()) else {
        return;
    };
    let members = members(group);
    std::thread::spawn(move || {
        let mut result = Ok(());
        for (shop, object_id) in &members {
            if let Err(error) = action(&db, &api, shop, object_id) {
                result = Err(error.to_string());
                break;
            }
        }
        let _ = slint::invoke_from_event_loop(move || done(result));
    });
}

fn with_open<R>(f: impl FnOnce(&mut Open) -> R) -> Option<R> {
    OPEN.with(|o| o.borrow_mut().as_mut().map(f))
}

fn activated(id: &str) {
    let Some(group) = with_open(|o| o.group.clone()) else {
        return;
    };
    let game = &group.game;
    let path = format!(
        "/game/{}/{}?title={}",
        group.catalogue_shop,
        group.catalogue_object_id,
        nav::encode(game.title())
    );
    match id {
        "play" => {
            if can_play(&group) {
                eprintln!("TODO(launcher): open-game.ts for {}", game.title());
            } else {
                // handleOpenDownloadOptions: the game page with the repacks modal.
                nav::navigate(&path);
                eprintln!("TODO(downloads): open the repacks modal on the game page");
            }
        }
        "favorite" => toggle_favorite(),
        "collection-create" => {
            if !shell::signed_in() {
                crate::auth::open(crate::auth::Page::SignIn);
                return;
            }
            // onCreated: assign the game to the new collection right away.
            context_menu::force_submenu("collection");
            crate::dialogs::create_collection_modal(Some(Rc::new(|id: String| {
                context_menu::force_submenu("");
                toggle_collection(id);
            })));
        }
        id if id.starts_with("collection-") => {
            toggle_collection(id.trim_start_matches("collection-").to_string())
        }
        "pin-game" => {
            let pin = !game.flag("isPinned");
            run_for_members(
                &group,
                move |db, api, shop, object_id| {
                    library_actions::set_pinned(db, api, shop, object_id, pin)
                },
                move |result| {
                    match result {
                        Ok(()) => toast::success(&t(if pin {
                            "game_details.game_added_to_pinned"
                        } else {
                            "game_details.game_removed_from_pinned"
                        })),
                        Err(error) => {
                            eprintln!("Failed to toggle pin: {error}");
                            toast::error(&t("game_details.failed_update_pinned"));
                        }
                    }
                    shell::load_library();
                },
            );
        }
        "hide-game" => {
            let value = !with_open(|o| o.hidden_from_others).unwrap_or(false);
            set_visibility(Visibility::HiddenFromOthers, value);
        }
        "conceal-game" => {
            let value = !with_open(|o| o.concealed).unwrap_or(false);
            set_visibility(Visibility::Concealed, value);
        }
        "open-folder" => {
            if let Some(exe) = game.executable_path() {
                open_folder_of(exe);
            }
        }
        "download-options" => {
            nav::navigate(&path);
            eprintln!("TODO(downloads): open the repacks modal on the game page");
        }
        "download-location" => eprintln!("TODO(downloads): openGameInstallerPath"),
        "remove-library" => {
            context_menu::force_submenu("manage");
            let description = shell::tr_with(
                "game_details.remove_from_library_description",
                &[("game", game.title().into())],
            );
            crate::dialogs::confirm(
                crate::dialogs::Confirm {
                    title: &t("game_details.remove_from_library_title"),
                    description: &description,
                    body: "",
                    confirm_label: &t("game_details.remove"),
                    cancel_label: &t("game_details.cancel"),
                    danger: true,
                },
                remove_from_library,
            );
        }
        "customize" | "properties" => eprintln!("TODO(game options): GameOptionsModal"),
        // use-game-actions.ts handleCreateShortcut: desktop (+ Start Menu on Windows)
        "desktop-shortcut" => {
            crate::game_shortcuts::create_all_with_toast(game.shop(), game.object_id())
        }
        "steam-shortcut" => eprintln!("TODO(steam-integration): {id}"),
        other => eprintln!("game menu: unhandled {other}"),
    }
}

/// handleRemoveFromLibrary (after the confirmation)
fn remove_from_library() {
    crate::dialogs::close();
    context_menu::force_submenu("");
    context_menu::close();
    let Some(group) = with_open(|o| o.group.clone()) else {
        return;
    };
    run_for_members(
        &group,
        |db, api, shop, object_id| {
            // TODO(downloads): cancelGameDownload when member.download.status === "active"
            library_actions::remove_from_library(db, api, shop, object_id)
        },
        |result| {
            match result {
                Ok(()) => toast::success(&t("game_details.game_removed_from_library")),
                Err(error) => {
                    eprintln!("Failed to remove from library: {error}");
                    toast::error(&t("game_details.failed_remove_from_library"));
                }
            }
            shell::load_library();
            collections::load();
        },
    );
}

/// handleToggleFavoriteStatus
fn toggle_favorite() {
    let Some((group, favorite, busy)) = with_open(|o| {
        (
            o.group.clone(),
            o.favorite,
            o.favorite_pending || o.collection_pending.is_some(),
        )
    }) else {
        return;
    };
    if busy {
        return;
    }
    with_open(|o| o.favorite_pending = true);
    refresh();
    let adding = !favorite;
    run_for_members(
        &group,
        move |db, api, shop, object_id| {
            library_actions::set_favorite(db, api, shop, object_id, adding)
        },
        move |result| {
            match result {
                Ok(()) => {
                    toast::success(&t(if adding {
                        "game_details.game_added_to_favorites"
                    } else {
                        "game_details.game_removed_from_favorites"
                    }));
                    let close = with_open(|o| {
                        o.favorite = adding;
                        !adding && o.selected_collection.as_deref() == Some(FAVORITES_COLLECTION_ID)
                    })
                    .unwrap_or(false);
                    if close {
                        context_menu::close();
                    }
                }
                Err(error) => {
                    eprintln!("Failed to toggle favorite: {error}");
                    toast::error(&t("game_details.failed_update_favorites"));
                }
            }
            with_open(|o| o.favorite_pending = false);
            refresh();
            shell::load_library();
        },
    );
}

/// handleAssignGameCollection
fn toggle_collection(collection_id: String) {
    let Some((group, ids, busy)) = with_open(|o| {
        (
            o.group.clone(),
            o.collection_ids.clone(),
            o.collection_pending.is_some() || o.favorite_pending,
        )
    }) else {
        return;
    };
    if busy {
        return;
    }
    let assigned = ids.contains(&collection_id);
    let next: Vec<String> = if assigned {
        ids.iter()
            .filter(|id| **id != collection_id)
            .cloned()
            .collect()
    } else {
        ids.iter()
            .cloned()
            .chain(std::iter::once(collection_id.clone()))
            .collect()
    };
    with_open(|o| o.collection_pending = Some(collection_id.clone()));
    refresh();
    // assignGameToCollection: every member gets the group's next set.
    let ids_for_worker = next.clone();
    run_for_members(
        &group,
        move |db, api, shop, object_id| {
            library_actions::assign_collections(db, api, shop, object_id, &ids_for_worker)
        },
        move |result| {
            match result {
                Ok(()) => {
                    toast::success(&t("game_details.game_collection_updated"));
                    let close = with_open(|o| {
                        o.collection_ids = next;
                        assigned && o.selected_collection.as_deref() == Some(collection_id.as_str())
                    })
                    .unwrap_or(false);
                    if close {
                        context_menu::close();
                    }
                }
                Err(error) => {
                    eprintln!("Failed to assign game to collection: {error}");
                    toast::error(&t("game_details.failed_update_game_collection"));
                }
            }
            with_open(|o| o.collection_pending = None);
            refresh();
            shell::load_library();
        },
    );
}

/// handleVisibilityChange
fn set_visibility(field: Visibility, value: bool) {
    let Some((group, busy)) = with_open(|o| (o.group.clone(), o.visibility_pending)) else {
        return;
    };
    if busy {
        return;
    }
    with_open(|o| o.visibility_pending = true);
    refresh();
    run_for_members(
        &group,
        move |db, api, shop, object_id| {
            library_actions::set_visibility(db, api, shop, object_id, field, value).map(|_| ())
        },
        move |result| {
            match result {
                Ok(()) => {
                    with_open(|o| match field {
                        Visibility::HiddenFromOthers => o.hidden_from_others = value,
                        Visibility::Concealed => o.concealed = value,
                    });
                    toast::success(&t("game_details.game_visibility_updated"));
                    context_menu::close();
                    // hydra:game-visibility-updated: the library reloads its hidden games too.
                    crate::library_page::on_visibility_changed();
                }
                Err(error) => {
                    eprintln!("Failed to update game visibility: {error}");
                    toast::error(&t("game_details.failed_update_game_visibility"));
                }
            }
            with_open(|o| o.visibility_pending = false);
            refresh();
            shell::load_library();
        },
    );
}

/// openGameExecutablePath: the folder with the executable selected.
fn open_folder_of(executable: &str) {
    reveal(std::path::Path::new(executable));
}

/// shell.showItemInFolder
pub fn reveal(path: &std::path::Path) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn();
    }
    #[cfg(not(windows))]
    {
        if let Some(dir) = path.parent() {
            let _ = std::process::Command::new("xdg-open").arg(dir).spawn();
        }
    }
}
