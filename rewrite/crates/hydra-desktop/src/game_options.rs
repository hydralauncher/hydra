//! game-options-modal.tsx: fills `GameOptions` for the open game and handles
//! its actions (title, launch options, Steam playtime, executable, downloads,
//! danger zone).
//!
//! Not yet: Customization (artwork picker, SteamGridDB), Hydra Cloud,
//! Compatibility (Linux), tracking executables, shortcuts, the save folder
//! lookup (Ludusavi), transfer, My Screenshots, reset achievements, the
//! playtime modals and remove files.

use std::cell::RefCell;
use std::path::Path;
use std::time::Duration;

use hydra_core::library_actions;
use hydra_db::keys;
use serde_json::{Map, Value, json};
use slint::{ComponentHandle, ModelRc, VecModel};

use crate::{AppWindow, GameData, GameOptions, OptionsCategory, shell, toast};

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    shop: String,
    object_id: String,
    /// game.title when the modal opened (onBlur compares against it)
    title: String,
    launch_timer: Option<slint::Timer>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn t(key: &str) -> String {
    shell::tr(key)
}

fn game_key() -> Option<(String, String, String)> {
    STATE.with(|s| {
        let s = s.borrow();
        (!s.shop.is_empty()).then(|| {
            (
                s.shop.clone(),
                s.object_id.clone(),
                format!("{}:{}", s.shop, s.object_id),
            )
        })
    })
}

fn record(key: &str) -> Option<Map<String, Value>> {
    shell::db()?.get_in::<Map<String, Value>>(keys::GAMES, key)
}

fn text(game: &Map<String, Value>, key: &str) -> String {
    game.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

pub fn init(ui: &AppWindow) {
    STATE.with(|s| s.borrow_mut().ui = ui.as_weak());
    let options = ui.global::<GameOptions>();
    options.on_select_category(|id| with_ui(|ui| ui.global::<GameOptions>().set_category(id)));
    options.on_title_edited(|value| with_ui(|ui| ui.global::<GameOptions>().set_title_text(value)));
    options.on_title_committed(commit_title);
    options.on_title_cleared(reset_title);
    options.on_hydra_tracking_toggled(toggle_hydra_tracking);
    options.on_launch_options_edited(|value| {
        with_ui(|ui| ui.global::<GameOptions>().set_launch_options(value.clone()));
        // debounce(updateLaunchOptions)
        let timer = slint::Timer::default();
        let value = value.to_string();
        timer.start(
            slint::TimerMode::SingleShot,
            Duration::from_millis(1000),
            move || {
                save_launch_options(&value);
            },
        );
        STATE.with(|s| s.borrow_mut().launch_timer = Some(timer));
    });
    options.on_launch_options_cleared(|| {
        STATE.with(|s| s.borrow_mut().launch_timer = None);
        with_ui(|ui| ui.global::<GameOptions>().set_launch_options("".into()));
        save_launch_options("");
    });
    options.on_select_executable(select_executable);
    options.on_clear_executable(|| set_executable(None));
    options.on_open_executable_folder(|| {
        if let Some((_, _, key)) = game_key()
            && let Some(game) = record(&key)
        {
            let executable = text(&game, "executablePath");
            if !executable.is_empty() {
                crate::game_menu::reveal(Path::new(&executable));
            }
        }
    });
    options.on_open_download_options(|| {
        with_ui(|ui| {
            // Stacked on the options modal: the backdrop snapshot includes it.
            ui.global::<GameData>().invoke_stacked_modal_opening();
            ui.global::<GameData>().set_repacks_open(true);
        });
    });
    options.on_open_download_location(|| {
        if let Some((_, _, key)) = game_key()
            && let Some(download) =
                shell::db().and_then(|db| db.get_in::<Map<String, Value>>(keys::DOWNLOADS, &key))
        {
            let path =
                Path::new(&text(&download, "downloadPath")).join(text(&download, "folderName"));
            crate::game_menu::reveal(&path);
        }
    });
    options.on_remove_from_library(remove_from_library);
    options.on_reset_achievements(crate::game_option_actions::open_reset_achievements);
    options.on_update_playtime(|| {
        if let Some((shop, object_id, _)) = game_key() {
            crate::playtime_modals::open_update(&shop, &object_id);
        }
    });
    options.on_reset_playtime(|| {
        if let Some((shop, object_id, _)) = game_key() {
            crate::playtime_modals::open_reset(&shop, &object_id);
        }
    });
    options.on_remove_files(remove_files);
    options.on_opened(|category| open(&category));
}

fn with_ui(f: impl FnOnce(&AppWindow)) {
    if let Some(ui) = STATE.with(|s| s.borrow().ui.upgrade()) {
        f(&ui);
    }
}

/// The modal is opening on `category` ("general", or "assets" from the edit button).
fn open(category: &str) {
    let Some((shop, object_id)) = crate::game_page::current() else {
        return;
    };
    open_game(shop, object_id, category);
}

/// The library context menu's "Customize" / "Properties": the same modal
/// over the library (GameOptionsModal in game-context-menu.tsx).
pub fn open_for(shop: &str, object_id: &str, category: &str) {
    open_game(shop.to_string(), object_id.to_string(), category);
    // The blurred backdrop is a snapshot: take it after the menu item's
    // handler returns and the context menu closes, so it isn't frozen in.
    slint::Timer::single_shot(Duration::ZERO, || {
        with_ui(|ui| {
            ui.global::<GameData>().invoke_modal_opening();
            ui.global::<GameData>().set_options_open(true);
        });
    });
}

fn open_game(shop: String, object_id: String, category: &str) {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        s.shop = shop.clone();
        s.object_id = object_id.clone();
        s.launch_timer = None;
    });
    refresh();
    crate::game_option_actions::opened(&shop, &object_id);
    crate::game_compat::opened(&shop, &object_id);
    crate::game_assets::opened(&shop, &object_id);
    with_ui(|ui| ui.global::<GameOptions>().set_category(category.into()));
}

/// The game record changed while the modal is open (playtime modals).
pub fn refresh_open() {
    let open = STATE
        .with(|s| s.borrow().ui.upgrade())
        .is_some_and(|ui| ui.global::<GameData>().get_options_open());
    if open {
        refresh();
        crate::game_option_actions::refresh();
    }
}

/// Copies the game record into `GameOptions`.
fn refresh() {
    let Some((shop, _, key)) = game_key() else {
        return;
    };
    let game = record(&key).unwrap_or_default();
    let download =
        shell::db().and_then(|db| db.get_in::<Map<String, Value>>(keys::DOWNLOADS, &key));
    let title = text(&game, "title");
    STATE.with(|s| s.borrow_mut().title = title.clone());
    let launchbox = shop == "launchbox";
    let custom = shop == "custom";
    let flag = |k: &str| game.get(k).and_then(Value::as_bool) == Some(true);
    let steam_import = (shop == "steam" && flag("hasActiveSteamImport"))
        || (shop == "epic" && flag("hasActiveEpicImport"));
    let source = if shop == "epic" { "epic" } else { "steam" };
    with_ui(|ui| {
        let options = ui.global::<GameOptions>();
        // categories: general, locations (not classics), customization, cloud
        // (TODO), compatibility (Linux, TODO), downloads, danger zone
        let mut categories = vec![OptionsCategory {
            id: "general".into(),
            label: t("game_details.settings_category_general").into(),
        }];
        if !launchbox {
            categories.push(OptionsCategory {
                id: "locations".into(),
                label: t("game_details.settings_category_locations").into(),
            });
        }
        categories.push(OptionsCategory {
            id: "assets".into(),
            label: t("game_details.settings_category_customization").into(),
        });
        // shouldShowWinePrefixConfiguration (Linux)
        if crate::game_compat::available() {
            categories.push(OptionsCategory {
                id: "compatibility".into(),
                label: t("game_details.settings_category_compatibility").into(),
            });
        }
        if !custom {
            categories.push(OptionsCategory {
                id: "downloads".into(),
                label: t("game_details.settings_category_downloads").into(),
            });
        }
        categories.push(OptionsCategory {
            id: "danger_zone".into(),
            label: t("game_details.settings_category_danger_zone").into(),
        });
        options.set_categories(ModelRc::new(VecModel::from(categories)));
        options.set_modal_title(title.clone().into());
        options.set_title_text(title.into());
        options.set_title_busy(false);
        options.set_steam_import(steam_import);
        options.set_steam_playtime_title(
            t(&format!("game_details.{source}_playtime_tracking_title")).into(),
        );
        options.set_steam_playtime_description(
            t(&format!(
                "game_details.{source}_playtime_tracking_description"
            ))
            .into(),
        );
        options.set_hydra_tracking(flag("enableHydraPlaytimeTracking"));
        options.set_launch_options(text(&game, "launchOptions").into());
        options.set_has_launch_options(!text(&game, "launchOptions").is_empty());
        options.set_show_launch_options(true);
        options.set_executable(text(&game, "executablePath").into());
        options.set_show_save_folder(cfg!(windows) && !custom);
        options.set_save_folder_loading(false);
        options.set_has_save_folder(false);
        options.set_custom(custom);
        // isLibraryGameDownloading
        let downloading = download
            .as_ref()
            .is_some_and(|d| d.get("status").and_then(Value::as_str) == Some("active"));
        options.set_downloading(downloading);
        options.set_has_official_source(steam_import);
        options.set_has_download_path(
            download
                .as_ref()
                .is_some_and(|d| !text(d, "downloadPath").is_empty()),
        );
        options.set_deleting(false);
        // getRemoveFilesTarget (Hydra downloads; the Steam uninstall target is a TODO)
        let has_files = download
            .as_ref()
            .is_some_and(|d| !text(d, "downloadPath").is_empty());
        options.set_can_remove_files(has_files && !downloading && !custom);
    });
}

/// handleBlurGameTitle
fn commit_title() {
    let Some((shop, object_id, key)) = game_key() else {
        return;
    };
    let mut value = String::new();
    with_ui(|ui| value = ui.global::<GameOptions>().get_title_text().to_string());
    let trimmed = value.trim().to_string();
    let original = STATE.with(|s| s.borrow().title.clone());
    if trimmed.is_empty() {
        with_ui(|ui| {
            ui.global::<GameOptions>()
                .set_title_text(original.clone().into())
        });
        toast::error(&t("game_details.edit_game_modal_fill_required"));
        return;
    }
    if trimmed == original.trim() {
        with_ui(|ui| ui.global::<GameOptions>().set_title_text(original.into()));
        return;
    }
    if shop == "custom" {
        // TODO(game options): updateCustomGame (custom games keep their assets).
    }
    set_title(&key, &trimmed);
    let _ = object_id;
}

/// updateGameCustomAssets({ title }): the record and its shop assets.
fn set_title(key: &str, title: &str) {
    let Some(db) = shell::db() else { return };
    let updated = library_actions::update_game_record(&db, key, |game| {
        game.insert("title".into(), json!(title));
    });
    if let Some(mut assets) = db.get_in::<Map<String, Value>>(keys::GAME_SHOP_ASSETS, key) {
        assets.insert("title".into(), json!(title));
        let _ = db.put_in(keys::GAME_SHOP_ASSETS, key, &assets);
    }
    match updated {
        Ok(Some(_)) => {
            STATE.with(|s| s.borrow_mut().title = title.to_string());
            with_ui(|ui| {
                ui.global::<GameOptions>().set_modal_title(title.into());
                ui.global::<GameOptions>().set_title_text(title.into());
                ui.global::<GameData>().set_game_title(title.into());
            });
            shell::load_library();
        }
        _ => toast::error(&t("game_details.edit_game_modal_failed")),
    }
}

/// handleResetGameTitle: back to the catalogue title (getGameAssets).
fn reset_title() {
    let Some((shop, object_id, key)) = game_key() else {
        return;
    };
    if shop == "custom" {
        // TODO(game options): getGameTitleFromExecutablePath for custom games.
        return;
    }
    let Some(api) = shell::api() else { return };
    with_ui(|ui| ui.global::<GameOptions>().set_title_busy(true));
    std::thread::spawn(move || {
        let title = api
            .get(
                &format!("/games/{shop}/{object_id}/assets"),
                &[],
                hydra_core::api::Options::public(),
            )
            .ok()
            .and_then(|v| v.get("title").and_then(Value::as_str).map(str::to_string));
        let _ = slint::invoke_from_event_loop(move || {
            with_ui(|ui| ui.global::<GameOptions>().set_title_busy(false));
            match title {
                Some(title) => set_title(&key, &title),
                None => toast::error(&t("game_details.edit_game_modal_failed")),
            }
        });
    });
}

/// setGameHydraPlaytimeEnabled
fn toggle_hydra_tracking() {
    let Some((_, _, key)) = game_key() else {
        return;
    };
    let Some(db) = shell::db() else { return };
    let enabled = !record(&key).is_some_and(|g| {
        g.get("enableHydraPlaytimeTracking")
            .and_then(Value::as_bool)
            == Some(true)
    });
    match library_actions::update_game_record(&db, &key, |game| {
        game.insert("enableHydraPlaytimeTracking".into(), json!(enabled));
    }) {
        Ok(Some(_)) => with_ui(|ui| ui.global::<GameOptions>().set_hydra_tracking(enabled)),
        _ => toast::error(&t("game_details.steam_playtime_tracking_error")),
    }
    // TODO(launch): enableHydraPlaytimeForRunningSession
}

/// debounceUpdateLaunchOptions / handleClearLaunchOptions
fn save_launch_options(value: &str) {
    let Some((_, _, key)) = game_key() else {
        return;
    };
    let Some(db) = shell::db() else { return };
    let trimmed = value.trim().to_string();
    let _ = library_actions::update_game_record(&db, &key, |game| {
        game.insert(
            "launchOptions".into(),
            if trimmed.is_empty() {
                Value::Null
            } else {
                json!(trimmed)
            },
        );
    });
    with_ui(|ui| {
        ui.global::<GameOptions>()
            .set_has_launch_options(!trimmed.is_empty())
    });
}

/// selectGameExecutable + verifyExecutablePathInUse + updateExecutablePath
fn select_executable() {
    let Some((_, _, key)) = game_key() else {
        return;
    };
    let mut dialog = rfd::FileDialog::new();
    let label = t("game_details.game_executable");
    dialog = if cfg!(windows) {
        dialog.add_filter(&label, &["exe", "lnk", "bat", "cmd"])
    } else if cfg!(target_os = "linux") {
        dialog
            .add_filter(
                &label,
                &[
                    "exe", "lnk", "bat", "cmd", "AppImage", "sh", "x86_64", "x86", "run",
                ],
            )
            .add_filter(t("game_details.all_files"), &["*"])
    } else {
        dialog.add_filter(&label, &["app"])
    };
    if let Some(download) =
        shell::db().and_then(|db| db.get_in::<Map<String, Value>>(keys::DOWNLOADS, &key))
    {
        let folder =
            Path::new(&text(&download, "downloadPath")).join(text(&download, "folderName"));
        if folder.is_dir() {
            dialog = dialog.set_directory(folder);
        }
    }
    let Some(picked) = dialog.pick_file() else {
        return;
    };
    let path = picked.to_string_lossy().into_owned();
    // verifyExecutablePathInUse
    if let Some(db) = shell::db() {
        let in_use = db
            .entries::<Value>(keys::GAMES)
            .unwrap_or_default()
            .into_iter()
            .find(|(other, game)| {
                other != &key
                    && game.get("executablePath").and_then(Value::as_str) == Some(path.as_str())
            });
        if let Some((_, game)) = in_use {
            let title = game
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            toast::error(&shell::tr_with(
                "game_details.executable_path_in_use",
                &[("game", title.into())],
            ));
            return;
        }
    }
    set_executable(Some(path));
}

/// updateExecutablePath (TODO: .lnk targets, cloud save sync, achievement
/// files, installed size from the game root).
fn set_executable(path: Option<String>) {
    let Some((_, _, key)) = game_key() else {
        return;
    };
    let Some(db) = shell::db() else { return };
    let _ = library_actions::update_game_record(&db, &key, |game| {
        let changed = game.get("executablePath").and_then(Value::as_str) != path.as_deref();
        if changed {
            game.insert(
                "executablePath".into(),
                path.as_ref().map_or(Value::Null, |p| json!(p)),
            );
            game.insert(
                "executablePathUpdatedAt".into(),
                if path.is_some() {
                    json!(library_actions::now_iso())
                } else {
                    Value::Null
                },
            );
        }
        if path.is_none() {
            game.insert("installedSizeInBytes".into(), Value::Null);
            game.insert("automaticCloudSync".into(), json!(false));
        }
    });
    with_ui(|ui| {
        ui.global::<GameOptions>()
            .set_executable(path.clone().unwrap_or_default().into())
    });
    crate::game_option_actions::refresh();
    shell::load_library();
}

/// RemoveGameFromLibraryModal from the danger zone.
fn remove_from_library() {
    let Some((shop, object_id, _)) = game_key() else {
        return;
    };
    let title = STATE.with(|s| s.borrow().title.clone());
    let description = shell::tr_with(
        "game_details.remove_from_library_description",
        &[("game", title.into())],
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
        move || {
            crate::dialogs::close();
            let (Some(db), Some(api)) = (shell::db(), shell::api()) else {
                return;
            };
            // applyLibraryGroupAction(presentation.members): every member
            // (a Steam game and its Epic copy), cancelling active downloads.
            let members: Vec<(String, String)> = shell::find_library_game(&shop, &object_id)
                .map(|group| {
                    group
                        .members
                        .iter()
                        .map(|m| {
                            if m.download()
                                .and_then(|d| d.get("status"))
                                .and_then(Value::as_str)
                                == Some("active")
                            {
                                crate::downloads::cancel(m.shop(), m.object_id());
                            }
                            (m.shop().to_string(), m.object_id().to_string())
                        })
                        .collect()
                })
                .unwrap_or_else(|| vec![(shop.clone(), object_id.clone())]);
            std::thread::spawn(move || {
                let result = members.iter().try_for_each(|(shop, object_id)| {
                    library_actions::remove_from_library(&db, &api, shop, object_id)
                });
                let _ = slint::invoke_from_event_loop(move || {
                    match result {
                        Ok(()) => {
                            toast::success(&t("game_details.game_removed_from_library"));
                            with_ui(|ui| ui.global::<GameData>().set_options_open(false));
                        }
                        Err(error) => {
                            eprintln!("Failed to remove from library: {error}");
                            toast::error(&t("game_details.failed_remove_from_library"));
                        }
                    }
                    shell::load_library();
                });
            });
        },
    );
}

/// DeleteGameModal + deleteGameFolder from the danger zone, or Steam's
/// uninstall when the files belong to a Steam install.
fn remove_files() {
    let Some((_, _, key)) = game_key() else {
        return;
    };
    let Some(db) = shell::db() else { return };
    let has_download = db
        .get_in::<Map<String, Value>>(keys::DOWNLOADS, &key)
        .is_some_and(|d| !text(&d, "downloadPath").is_empty());
    if !has_download && crate::game_option_actions::steam_target_remove_files() {
        return;
    }
    let has_archive = hydra_downloads::removal::has_source_archive(&db, &key);
    crate::dialogs::confirm(
        crate::dialogs::Confirm {
            title: &t("downloads.delete_modal_title"),
            description: &t("downloads.delete_modal_description"),
            body: "",
            confirm_label: &t("downloads.delete"),
            cancel_label: &t("downloads.cancel"),
            danger: true,
        },
        move || {
            let delete_archive = has_archive && crate::dialogs::checkbox_checked();
            crate::dialogs::close();
            let Some(db) = shell::db() else { return };
            // removeGameInstaller: still downloading or already deleting?
            let downloading = db
                .get_in::<Map<String, Value>>(keys::DOWNLOADS, &key)
                .is_some_and(|d| d.get("status").and_then(Value::as_str) == Some("active"));
            if downloading {
                toast::error(&t("game_details.remove_files_downloading"));
                return;
            }
            with_ui(|ui| ui.global::<GameOptions>().set_deleting(true));
            let key = key.clone();
            std::thread::spawn(move || {
                let result =
                    hydra_downloads::removal::delete_game_folder(&db, &key, delete_archive);
                let _ = slint::invoke_from_event_loop(move || {
                    with_ui(|ui| ui.global::<GameOptions>().set_deleting(false));
                    if let Err(error) = result {
                        eprintln!("Failed to remove files: {error}");
                        toast::error(&t("game_details.remove_files_failed"));
                    }
                    refresh_open();
                    crate::downloads_page::refresh();
                    shell::load_library();
                });
            });
        },
    );
    if has_archive {
        crate::dialogs::set_checkbox(&t("downloads.delete_source_archive"));
    }
}
