//! The game options' Compatibility tab on Linux (compatibility-section.tsx
//! and its handlers in game-options-modal.tsx): the game's Wine prefix,
//! Winetricks, GameMode / MangoHud and the Proton version. The settings are
//! stored on the game record like Electron does; launching through them is
//! part of the Wine/umu work that isn't ported yet.
//!
//! `HYDRA_DEV_SHOW_COMPATIBILITY=1` shows the tab on other systems so its
//! layout can be checked.

use std::cell::RefCell;
use std::path::PathBuf;

use hydra_core::{library_actions, linux_compat};
use hydra_db::keys;
use serde_json::{Map, Value, json};
use slint::{ComponentHandle, ModelRc, VecModel};

use crate::{AppWindow, GameOptions, ProtonOption, shell, toast};

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    shop: String,
    object_id: String,
    generation: u64,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn with_ui(f: impl FnOnce(&AppWindow)) {
    if let Some(ui) = with(|s| s.ui.upgrade()) {
        f(&ui);
    }
}

fn t(key: &str) -> String {
    shell::tr(key)
}

/// shouldShowWinePrefixConfiguration: Linux only.
pub fn available() -> bool {
    cfg!(target_os = "linux") || std::env::var_os("HYDRA_DEV_SHOW_COMPATIBILITY").is_some()
}

fn record() -> Option<(String, String, Map<String, Value>)> {
    let (shop, object_id) = with(|s| (s.shop.clone(), s.object_id.clone()));
    let game = shell::db()?.get_in(keys::GAMES, &keys::game(&shop, &object_id))?;
    Some((shop, object_id, game))
}

fn update(f: impl FnOnce(&mut Map<String, Value>)) {
    let (shop, object_id) = with(|s| (s.shop.clone(), s.object_id.clone()));
    if let Some(db) = shell::db() {
        let _ = library_actions::update_game_record(&db, &keys::game(&shop, &object_id), f);
    }
    refresh();
    shell::load_library();
}

pub fn init(ui: &AppWindow) {
    with(|s| s.ui = ui.as_weak());
    let options = ui.global::<GameOptions>();
    options.on_select_wine_prefix(select_wine_prefix);
    options.on_clear_wine_prefix(|| {
        update(|g| {
            g.insert("winePrefixPath".into(), Value::Null);
        })
    });
    options.on_open_winetricks(open_winetricks);
    options.on_toggle_gamemode(|| toggle("autoRunGamemode"));
    options.on_toggle_mangohud(|| toggle("autoRunMangohud"));
    options.on_select_proton(|path| select_proton(path.to_string()));
    options.on_open_link(|url| open_external(&url));
}

/// The modal opened on a game.
pub fn opened(shop: &str, object_id: &str) {
    let generation = with(|s| {
        s.shop = shop.to_string();
        s.object_id = object_id.to_string();
        s.generation += 1;
        s.generation
    });
    if !available() {
        return;
    }
    refresh();
    // isGamemodeAvailable / isMangohudAvailable / isWinetricksAvailable and
    // getInstalledProtonVersions, off the UI thread.
    std::thread::spawn(move || {
        let linux = cfg!(target_os = "linux");
        let gamemode = linux && linux_compat::which("gamemoderun").is_some();
        let mangohud = linux && linux_compat::which("mangohud").is_some();
        let winetricks = linux && linux_compat::which("winetricks").is_some();
        let versions = dirs::home_dir()
            .map(|home| {
                let libraries: Vec<PathBuf> = linux_compat::steam_roots(&home)
                    .into_iter()
                    .filter(|r| r.exists())
                    .flat_map(|root| hydra_core::steam_install::library_folders(&root))
                    .collect();
                linux_compat::installed_proton_versions(&home, &libraries)
            })
            .unwrap_or_default();
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) != generation {
                return;
            }
            AVAILABILITY.with(|a| *a.borrow_mut() = (gamemode, mangohud));
            let mut options = vec![ProtonOption {
                name: t("game_details.proton_version_auto").into(),
                path: "".into(),
                description: t("game_details.proton_source_umu_default").into(),
            }];
            options.extend(versions.into_iter().map(|v| {
                ProtonOption {
                    description: if v.source == "compatibility_tools"
                        || v.path.contains("compatibilitytools.d")
                    {
                        t("game_details.proton_source_compatibility_tools")
                    } else {
                        t("game_details.proton_source_steam")
                    }
                    .into(),
                    name: v.name.into(),
                    path: v.path.into(),
                }
            }));
            with_ui(|ui| {
                let o = ui.global::<GameOptions>();
                o.set_winetricks_available(winetricks);
                o.set_proton_versions(ModelRc::new(VecModel::from(options)));
            });
            refresh();
        });
    });
}

thread_local! {
    /// (GameMode, MangoHud) available on PATH.
    static AVAILABILITY: RefCell<(bool, bool)> = const { RefCell::new((false, false)) };
}

/// Wine.getDefaultPrefixPath (userPreferences.defaultWinePrefixPath, else
/// `<userData>/wine-prefixes`).
fn default_prefix_root() -> Option<PathBuf> {
    let configured = shell::db()
        .and_then(|db| db.get::<Value>(keys::USER_PREFERENCES))
        .and_then(|p| {
            p.get("defaultWinePrefixPath")
                .and_then(Value::as_str)
                .map(PathBuf::from)
        });
    configured.or_else(|| hydra_db::paths::native_user_data().map(|d| d.join("wine-prefixes")))
}

/// The record's values into `GameOptions`.
pub fn refresh() {
    if !available() {
        return;
    }
    let Some((shop, object_id, game)) = record() else {
        return;
    };
    let text = |k: &str| {
        game.get(k)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let custom_prefix = text("winePrefixPath");
    // displayedWinePrefixPath: the game's prefix, else Hydra's default for it
    // (Epic picks its own automatically).
    let displayed = custom_prefix.clone().or_else(|| {
        (shop != "epic")
            .then(|| {
                default_prefix_root()
                    .map(|root| root.join(&object_id).to_string_lossy().to_string())
            })
            .flatten()
    });
    let flag = |k: &str| game.get(k).and_then(Value::as_bool) == Some(true);
    let (gamemode_available, mangohud_available) = AVAILABILITY.with(|a| *a.borrow());
    let global_gamemode = shell::preference("autoRunGamemode");
    let global_mangohud = shell::preference("autoRunMangohud");
    let tooltip = |available: bool, global: bool, unavailable: &str, globally: &str| {
        if !available {
            t(unavailable)
        } else if global {
            t(globally)
        } else {
            String::new()
        }
    };
    with_ui(|ui| {
        let o = ui.global::<GameOptions>();
        o.set_wine_prefix(displayed.unwrap_or_default().into());
        o.set_wine_prefix_placeholder(
            if shop == "epic" {
                t("game_details.epic_compatibility_automatic")
            } else {
                String::new()
            }
            .into(),
        );
        o.set_has_custom_prefix(custom_prefix.is_some());
        o.set_gamemode_checked(flag("autoRunGamemode") || global_gamemode);
        o.set_gamemode_disabled(!gamemode_available || global_gamemode);
        o.set_gamemode_tooltip(
            tooltip(
                gamemode_available,
                global_gamemode,
                "game_details.gamemode_not_available_tooltip",
                "game_details.gamemode_disabled_due_to_global_setting_tooltip",
            )
            .into(),
        );
        o.set_mangohud_checked(flag("autoRunMangohud") || global_mangohud);
        o.set_mangohud_disabled(!mangohud_available || global_mangohud);
        o.set_mangohud_tooltip(
            tooltip(
                mangohud_available,
                global_mangohud,
                "game_details.mangohud_not_available_tooltip",
                "game_details.mangohud_disabled_due_to_global_setting_tooltip",
            )
            .into(),
        );
        o.set_proton_path(text("protonPath").unwrap_or_default().into());
    });
}

/// handleChangeWinePrefixPath + selectGameWinePrefix (the real path, which
/// must be a valid prefix).
fn select_wine_prefix() {
    let current = with_ui_value(|o| o.get_wine_prefix().to_string());
    let mut dialog = rfd::FileDialog::new();
    let start = PathBuf::from(&current);
    if start.is_dir() {
        dialog = dialog.set_directory(start);
    } else if let Some(root) = default_prefix_root().filter(|r| r.is_dir()) {
        dialog = dialog.set_directory(root);
    }
    let Some(picked) = dialog.pick_folder() else {
        return;
    };
    let real = std::fs::canonicalize(&picked).unwrap_or(picked);
    if !linux_compat::validate_prefix(&real) {
        toast::show(
            toast::Kind::Error,
            &t("game_details.invalid_wine_prefix_path"),
            Some(&t("game_details.invalid_wine_prefix_path_description")),
        );
        return;
    }
    let path = real.to_string_lossy().to_string();
    update(|g| {
        g.insert("winePrefixPath".into(), json!(path));
    });
}

fn with_ui_value<R: Default>(f: impl FnOnce(&GameOptions) -> R) -> R {
    let mut out = R::default();
    with_ui(|ui| out = f(&ui.global::<GameOptions>()));
    out
}

/// toggleGameGamemode / toggleGameMangohud
fn toggle(key: &'static str) {
    let Some((_, _, game)) = record() else { return };
    let next = game.get(key).and_then(Value::as_bool) != Some(true);
    update(|g| {
        g.insert(key.into(), json!(next));
    });
}

/// applyProtonPathChange: "" is Auto (null), else a valid Proton folder.
fn select_proton(path: String) {
    if path.is_empty() {
        update(|g| {
            g.insert("protonPath".into(), Value::Null);
        });
        return;
    }
    let real = std::fs::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(&path));
    if !linux_compat::is_valid_proton_dir(&real) {
        toast::error(&t("game_details.proton_version_update_error"));
        refresh();
        return;
    }
    let real = real.to_string_lossy().to_string();
    update(|g| {
        g.insert("protonPath".into(), json!(real));
    });
}

/// openGameWinetricks: winetricks on the game's prefix.
fn open_winetricks() {
    let prefix = with_ui_value(|o| o.get_wine_prefix().to_string());
    let opened = linux_compat::which("winetricks").is_some_and(|winetricks| {
        std::process::Command::new(winetricks)
            .env("WINEPREFIX", &prefix)
            .spawn()
            .is_ok()
    });
    if opened {
        toast::success(&t("game_details.winetricks_opened"));
    } else {
        toast::error(&t("game_details.winetricks_open_error"));
    }
}

fn open_external(url: &str) {
    #[cfg(windows)]
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}
