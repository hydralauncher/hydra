//! The game options modal's remaining actions (game-options-modal.tsx,
//! general-section.tsx, danger-zone-section.tsx): desktop and Start Menu
//! shortcuts, tracking executables, the save folder lookup through Ludusavi,
//! reset achievements (reset-achievements-modal.tsx) and Steam's uninstall as
//! the "Remove files" target (use-steam-uninstall-action.ts).

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use hydra_core::{library_actions, ludusavi, steam_install};
use hydra_db::keys;
use serde_json::{Map, Value, json};
use slint::{ComponentHandle, ModelRc, SharedString, VecModel};

use crate::game_shortcuts::{self, Location};
use crate::{AppWindow, GameData, GameOptions, OptionModals, shell, toast};

const RETRO_ACHIEVEMENTS_SETTINGS_URL: &str =
    "https://retroachievements.org/settings#resettable-game-select";

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    shop: String,
    object_id: String,
    /// Bumped every time the modal opens, so late lookups are dropped.
    generation: u64,
    save_folder: Option<String>,
    /// The Steam member's app id when Steam's uninstall is the remove-files target.
    steam_target: Option<(String, String)>,
    resetting: bool,
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

fn record(shop: &str, object_id: &str) -> Option<Map<String, Value>> {
    shell::db()?.get_in(keys::GAMES, &keys::game(shop, object_id))
}

fn text(game: &Map<String, Value>, key: &str) -> String {
    game.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

pub fn init(ui: &AppWindow) {
    with(|s| s.ui = ui.as_weak());
    let options = ui.global::<GameOptions>();
    options.on_create_shortcut(|location| {
        let Some(location) = Location::parse(&location) else {
            return;
        };
        let (shop, object_id) = with(|s| (s.shop.clone(), s.object_id.clone()));
        if !shop.is_empty() {
            game_shortcuts::create_with_toast(&shop, &object_id, location);
        }
    });
    options.on_steam_shortcut(|| {
        // TODO(steam-integration): createSteamShortcut / deleteSteamShortcut
        // (shortcuts.vdf) and the CreateSteamShortcutModal.
        eprintln!("TODO(steam-integration): Steam shortcut");
    });
    options.on_add_tracking_executable(add_tracking_executable);
    options.on_remove_tracking_executable(|index| remove_tracking_executable(index as usize));
    options.on_open_save_folder(open_save_folder);

    let modals = ui.global::<OptionModals>();
    modals.on_reset_achievements(reset_achievements);
    modals.on_open_retro_settings(|| open_external(RETRO_ACHIEVEMENTS_SETTINGS_URL));
    modals.on_steam_uninstall(steam_uninstall);
}

/// The modal opened (or the game record changed): shortcuts, tracking
/// executables, and the lookups that run while it is open.
pub fn opened(shop: &str, object_id: &str) {
    let generation = with(|s| {
        s.shop = shop.to_string();
        s.object_id = object_id.to_string();
        s.generation += 1;
        s.save_folder = None;
        s.steam_target = None;
        s.generation
    });
    refresh();
    // getGameSaveFolder (win32, not custom games)
    if cfg!(windows) && shop != "custom" {
        with_ui(|ui| ui.global::<GameOptions>().set_save_folder_loading(true));
        let object_id = object_id.to_string();
        std::thread::spawn(move || {
            let folder = hydra_db::paths::native_user_data()
                .and_then(|data| ludusavi::game_save_folder(&data, &object_id));
            let _ = slint::invoke_from_event_loop(move || {
                if with(|s| s.generation) != generation {
                    return;
                }
                with(|s| s.save_folder = folder.clone());
                with_ui(|ui| {
                    let options = ui.global::<GameOptions>();
                    options.set_save_folder_loading(false);
                    options.set_has_save_folder(folder.is_some());
                });
            });
        });
    }
    probe_steam_target(shop, object_id, generation);
}

/// Shortcut and tracking-executable state from the game record.
pub fn refresh() {
    let (shop, object_id) = with(|s| (s.shop.clone(), s.object_id.clone()));
    if shop.is_empty() {
        return;
    }
    let game = record(&shop, &object_id).unwrap_or_default();
    let executable = text(&game, "executablePath");
    let lower = executable.to_lowercase();
    // hasShortcutLaunchTarget
    let has_target = !executable.is_empty()
        || (shop == "launchbox"
            && game
                .get("discs")
                .and_then(Value::as_array)
                .is_some_and(|d| d.iter().any(|disc| disc.get("path").is_some())));
    let tracking: Vec<SharedString> = game
        .get("trackingExecutablePaths")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|p| p.as_str().map(SharedString::from))
                .collect()
        })
        .unwrap_or_default();
    with_ui(|ui| {
        let options = ui.global::<GameOptions>();
        options.set_has_shortcut_target(has_target);
        // TODO(steam-integration): checkSteamShortcut
        options.set_steam_shortcut_exists(false);
        options.set_creating_steam_shortcut(false);
        options.set_show_steam_shortcut(shop != "custom");
        options.set_show_start_menu_shortcut(cfg!(windows));
        options.set_supports_tracking(
            lower.ends_with(".exe") || lower.ends_with(".bat") || lower.ends_with(".cmd"),
        );
        options.set_bat_warning(lower.ends_with(".bat") || lower.ends_with(".cmd"));
        options.set_tracking_paths(ModelRc::new(VecModel::from(tracking)));
        // hasAchievements && userDetails && !isDeletingAchievements
        let g = ui.global::<GameData>();
        options.set_can_reset_achievements(
            shell::signed_in()
                && g.get_achievements_unlocked() > 0
                && !with(|s| s.resetting)
                && !options.get_deleting(),
        );
    });
}

/// handleAddTrackingExecutable: at most two, no duplicates.
fn add_tracking_executable() {
    let (shop, object_id) = with(|s| (s.shop.clone(), s.object_id.clone()));
    let Some(game) = record(&shop, &object_id) else {
        return;
    };
    let mut current: Vec<String> = game
        .get("trackingExecutablePaths")
        .and_then(Value::as_array)
        .map(|l| {
            l.iter()
                .filter_map(|p| p.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    if current.len() >= 2 {
        return;
    }
    let label = t("game_details.game_executable");
    let mut dialog = rfd::FileDialog::new();
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
    let executable = text(&game, "executablePath");
    if let Some(dir) = Path::new(&executable).parent().filter(|d| d.is_dir()) {
        dialog = dialog.set_directory(dir);
    }
    let Some(picked) = dialog.pick_file() else {
        return;
    };
    let path = parse_executable_path(&picked);
    if current.contains(&path) {
        return;
    }
    current.push(path);
    save_tracking(&shop, &object_id, current);
}

fn remove_tracking_executable(index: usize) {
    let (shop, object_id) = with(|s| (s.shop.clone(), s.object_id.clone()));
    let Some(game) = record(&shop, &object_id) else {
        return;
    };
    let current: Vec<String> = game
        .get("trackingExecutablePaths")
        .and_then(Value::as_array)
        .map(|l| {
            l.iter()
                .filter_map(|p| p.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let next: Vec<String> = current
        .into_iter()
        .enumerate()
        .filter(|(i, _)| *i != index)
        .map(|(_, p)| p)
        .collect();
    save_tracking(&shop, &object_id, next);
}

/// updateTrackingExecutablePaths
fn save_tracking(shop: &str, object_id: &str, paths: Vec<String>) {
    let Some(db) = shell::db() else { return };
    let _ = library_actions::update_game_record(&db, &keys::game(shop, object_id), |game| {
        game.insert(
            "trackingExecutablePathsUpdatedAt".into(),
            if paths.is_empty() {
                Value::Null
            } else {
                json!(library_actions::now_iso())
            },
        );
        game.insert("trackingExecutablePaths".into(), json!(paths));
    });
    refresh();
    shell::load_library();
}

/// parseExecutablePath: a `.lnk` stands for its target on Windows.
fn parse_executable_path(path: &Path) -> String {
    let text = path.to_string_lossy().to_string();
    #[cfg(windows)]
    if text.to_lowercase().ends_with(".lnk")
        && let Some(target) = read_shortcut_target(path)
    {
        return target;
    }
    text
}

/// shell.readShortcutLink(path).target, through WScript.Shell.
#[cfg(windows)]
fn read_shortcut_target(path: &Path) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(New-Object -ComObject WScript.Shell).CreateShortcut($env:HYDRA_LNK).TargetPath",
        ])
        .env("HYDRA_LNK", path)
        .creation_flags(0x0800_0000)
        .output()
        .ok()?;
    let target = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!target.is_empty()).then_some(target)
}

/// openGameSaveFolder: only an existing folder, opened with the shell.
fn open_save_folder() {
    let Some(folder) = with(|s| s.save_folder.clone()) else {
        return;
    };
    if !Path::new(&folder).exists() {
        return;
    }
    open_path(&ludusavi::shell_path(&folder));
}

fn open_path(path: &str) {
    #[cfg(windows)]
    let _ = std::process::Command::new("explorer").arg(path).spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(path).spawn();
}

/// shell.openExternal
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

/// The danger zone's "Reset achievements": ResetAchievementsModal.
pub fn open_reset_achievements() {
    let (shop, object_id) = with(|s| (s.shop.clone(), s.object_id.clone()));
    let Some(game) = record(&shop, &object_id) else {
        return;
    };
    let title = text(&game, "title");
    let description = shell::tr_with(
        if shop == "steam" {
            "game_details.reset_achievements_hydra_souvenirs_description"
        } else {
            "game_details.reset_achievements_souvenirs_description"
        },
        &[("game", title.into())],
    );
    with_ui(|ui| {
        let m = ui.global::<OptionModals>();
        m.set_reset_description(description.into());
        m.set_reset_steam_note(shop == "steam");
        m.set_reset_launchbox(shop == "launchbox");
        m.set_retro_confirmed(false);
        ui.global::<GameData>().invoke_stacked_modal_opening();
        m.set_reset_achievements_open(true);
    });
}

/// handleResetAchievements (reset-game-achievements.ts): the local
/// achievement files in the shared folders, then the account's unlocks.
fn reset_achievements() {
    let (shop, object_id) = with(|s| (s.shop.clone(), s.object_id.clone()));
    let (Some(db), Some(api)) = (shell::db(), shell::api()) else {
        return;
    };
    if !api.is_logged_in() {
        return;
    }
    with(|s| s.resetting = true);
    refresh();
    std::thread::spawn(move || {
        let key = keys::game(&shop, &object_id);
        let result = (|| -> Result<(), String> {
            let Some(game) = db.get_in::<Map<String, Value>>(keys::GAMES, &key) else {
                return Ok(());
            };
            // collectGameAchievementFiles: Steam games' files in the shared
            // folders. TODO(achievements): nested Wine-prefix and
            // game-directory files, the watcher and souvenir stores.
            if shop == "steam"
                && let Some(folders) = hydra_core::achievement_files::Folders::windows()
            {
                for file in hydra_core::achievement_files::find_for_game(&object_id, &folders) {
                    let _ = if file.path.is_dir() {
                        std::fs::remove_dir_all(&file.path)
                    } else {
                        std::fs::remove_file(&file.path)
                    };
                }
            }
            if game.contains_key("reportedUnlockedAchievementCount") {
                let _ = library_actions::update_game_record(&db, &key, |g| {
                    g.remove("reportedUnlockedAchievementCount");
                });
            }
            let remote_id = text(&game, "remoteId");
            api.delete(
                &format!("/profile/games/achievements/{remote_id}"),
                hydra_core::api::Options::default(),
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })();
        let _ = slint::invoke_from_event_loop(move || {
            with(|s| s.resetting = false);
            match result {
                Ok(()) => {
                    toast::success(&t("game_details.reset_achievements_success"));
                    crate::game_page::refresh_achievements();
                }
                Err(error) => {
                    eprintln!("Failed to reset achievements: {error}");
                    toast::error(&t("game_details.reset_achievements_error"));
                }
            }
            refresh();
        });
    });
}

/// getRemoveFilesTarget's Steam branch: no Hydra download on any member,
/// and the Steam member's executable inside its Steam install.
fn probe_steam_target(shop: &str, object_id: &str, generation: u64) {
    let Some(group) = shell::find_library_game(shop, object_id) else {
        return;
    };
    if group.members.iter().any(|m| m.download().is_some()) {
        return;
    }
    // getOfficialStoreMembers(...).steam: an active Steam import
    let Some(steam) = group
        .members
        .iter()
        .find(|m| m.shop() == "steam" && m.flag("hasActiveSteamImport"))
    else {
        return;
    };
    let (app_id, title) = (steam.object_id().to_string(), steam.title().to_string());
    let Some(executable) = steam.executable_path().map(PathBuf::from) else {
        return;
    };
    if !steam_install::is_valid_app_id(&app_id) {
        return;
    }
    std::thread::spawn(move || {
        let found = steam_location()
            .map(|steam| steam_install::library_folders(&steam))
            .is_some_and(|libraries| {
                steam_install::is_steam_app_executable(&app_id, &executable, &libraries)
            });
        let _ = slint::invoke_from_event_loop(move || {
            if with(|s| s.generation) != generation || !found {
                return;
            }
            with(|s| s.steam_target = Some((app_id, title)));
            with_ui(|ui| ui.global::<GameOptions>().set_can_remove_files(true));
        });
    });
}

/// getSteamLocation: HKCU\Software\Valve\Steam\SteamPath on Windows.
fn steam_location() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let key = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
            .open_subkey("Software\\Valve\\Steam")
            .ok()?;
        let path: String = key.get_value("SteamPath").ok()?;
        Some(PathBuf::from(path.replace('/', "\\")))
    }
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir().map(|h| h.join("Library/Application Support/Steam"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let home = dirs::home_dir()?;
        let candidates = [
            home.join(".steam/steam"),
            home.join(".local/share/Steam"),
            home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
            home.join("snap/steam/common/.local/share/Steam"),
        ];
        candidates
            .iter()
            .find(|p| p.exists())
            .cloned()
            .or_else(|| Some(candidates[0].clone()))
    }
}

/// "Remove files" with Steam as the target: the SteamUninstallModal.
pub fn steam_target_remove_files() -> bool {
    let Some((_, title)) = with(|s| s.steam_target.clone()) else {
        return false;
    };
    with_ui(|ui| {
        let m = ui.global::<OptionModals>();
        m.set_steam_uninstall_description(
            shell::tr_with(
                "game_details.steam_uninstall_description",
                &[("game", title.into())],
            )
            .into(),
        );
        m.set_steam_uninstalling(false);
        ui.global::<GameData>().invoke_stacked_modal_opening();
        m.set_steam_uninstall_open(true);
    });
    true
}

/// handleSteamUninstall: steam://uninstall/<appid> after re-checking the target.
fn steam_uninstall() {
    let Some((app_id, _)) = with(|s| s.steam_target.clone()) else {
        toast::error(&t("game_details.remove_files_target_changed"));
        with_ui(|ui| ui.global::<OptionModals>().set_steam_uninstall_open(false));
        return;
    };
    with_ui(|ui| ui.global::<OptionModals>().set_steam_uninstalling(true));
    open_external(&format!("steam://uninstall/{app_id}"));
    // TODO(steam-integration): watchSteamAppInstall refreshes the library
    // once Steam finishes.
    toast::show(
        toast::Kind::Success,
        &t("game_details.steam_uninstall_requested"),
        Some(&t("game_details.steam_uninstall_requested_description")),
    );
    with(|s| s.steam_target = None);
    with_ui(|ui| {
        let m = ui.global::<OptionModals>();
        m.set_steam_uninstalling(false);
        m.set_steam_uninstall_open(false);
    });
}
