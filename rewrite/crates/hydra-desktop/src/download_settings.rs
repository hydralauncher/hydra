//! modals/download-settings-modal.tsx: pick a downloader and a folder for a
//! download option, then start it.

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use hydra_core::repacks::{self, DownloadOption, Downloader, OptionsContext};
use hydra_db::keys;
use serde_json::Value;
use slint::{ComponentHandle, ModelRc, SharedString, VecModel};

use crate::{AppWindow, DownloadSettings, DownloaderRow, Session, shell};

struct State {
    ui: slint::Weak<AppWindow>,
    repack: Option<Value>,
    options: Vec<DownloadOption>,
    selected: Option<Downloader>,
    path: String,
    free_space: Option<u64>,
    writable: Option<bool>,
    /// Bumped per opened option, so a late disk check is dropped.
    generation: u64,
    game: Option<GameRef>,
}

/// The game the download is for (title as shown on the page).
#[derive(Clone)]
pub struct GameRef {
    pub shop: String,
    pub object_id: String,
    pub title: String,
}

thread_local! {
    static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> Option<R> {
    STATE.with(|s| s.borrow_mut().as_mut().map(f))
}

pub fn init(ui: &AppWindow) {
    STATE.with(|s| {
        *s.borrow_mut() = Some(State {
            ui: ui.as_weak(),
            repack: None,
            options: Vec::new(),
            selected: None,
            path: String::new(),
            free_space: None,
            writable: None,
            generation: 0,
            game: None,
        })
    });
    let d = ui.global::<DownloadSettings>();
    d.on_select(|kind| {
        let Some(option) = with(|s| {
            s.options
                .iter()
                .copied()
                .find(|o| o.downloader as i32 == kind)
        })
        .flatten() else {
            return;
        };
        if option.not_configured {
            // TODO(downloads): RealDebridInfoModal / Hydra Cloud modal for VikingFile.
            eprintln!(
                "TODO(downloads): {} is not configured",
                option.downloader.name()
            );
            return;
        }
        with(|s| s.selected = Some(option.downloader));
        apply();
    });
    d.on_change_path(|| {
        let current = with(|s| s.path.clone()).unwrap_or_default();
        // showOpenDialog({ properties: ["openDirectory"] }) without blocking the UI.
        std::thread::spawn(move || {
            let picked = rfd::FileDialog::new().set_directory(&current).pick_folder();
            if let Some(folder) = picked {
                let path = folder.to_string_lossy().into_owned();
                let _ = slint::invoke_from_event_loop(move || set_path(path));
            }
        });
    });
    d.on_open_settings(|| {
        if let Some(ui) = with(|s| s.ui.upgrade()).flatten() {
            ui.global::<DownloadSettings>().set_open(false);
            ui.global::<crate::GameData>().set_repacks_open(false);
            crate::nav::navigate("/settings");
        }
    });
    d.on_open_path_error(|| {
        // data-open-article="cannot-write-directory"
        eprintln!("TODO(help): open the cannot-write-directory article");
    });
    d.on_start(start);
}

/// handleStartClick: startGameDownload with the chosen downloader and folder.
fn start() {
    let Some((ui, repack, downloader, path, game)) = with(|s| {
        Some((
            s.ui.upgrade()?,
            s.repack.clone()?,
            s.selected?,
            s.path.clone(),
            s.game.clone()?,
        ))
    })
    .flatten() else {
        return;
    };
    let d = ui.global::<DownloadSettings>();
    if !d.get_can_start() {
        return;
    }
    let Some(map) = repack.as_object() else {
        return;
    };
    // The game's icon for the flight (shop assets, else the library record).
    let icon_url = shell::db().and_then(|db| {
        let key = format!("{}:{}", game.shop, game.object_id);
        let from = |sub: &str| {
            db.get_in::<Value>(sub, &key).and_then(|v| {
                v.get("iconUrl")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            })
        };
        from(hydra_db::keys::GAME_SHOP_ASSETS).or_else(|| from(hydra_db::keys::GAMES))
    });
    // selectRepackUri / getRepackUriParts
    let uri = repacks::uri_for(map, downloader).unwrap_or_default();
    let parts = map
        .get("uriGroups")
        .and_then(Value::as_array)
        .and_then(|groups| {
            groups
                .iter()
                .filter_map(Value::as_array)
                .find(|g| g.first().and_then(Value::as_str) == Some(uri.as_str()))
                .map(|g| {
                    g.iter()
                        .filter_map(|p| p.as_str().map(str::to_string))
                        .collect::<Vec<_>>()
                })
        });
    let payload = hydra_downloads::manager::StartPayload {
        object_id: game.object_id,
        title: game.title,
        shop: game.shop,
        download_path: path,
        downloader,
        uri,
        parts,
        automatically_extract: d.get_extract(),
        automatically_delete_archive_files: d.get_delete_archives(),
        file_size: map
            .get("fileSize")
            .and_then(Value::as_str)
            .map(str::to_string),
        file_indices: None,
        selected_files_size: None,
    };
    d.set_starting(true);
    apply();
    crate::download_indicator::begin_flight();
    let icon = icon_url;
    crate::downloads::start(payload, move |result| {
        let Some(ui) = with(|s| s.ui.upgrade()).flatten() else {
            return;
        };
        let d = ui.global::<DownloadSettings>();
        d.set_starting(false);
        match result {
            Ok(()) => {
                // flight.launch(shopDetails?.assets?.iconUrl || game?.iconUrl)
                crate::download_indicator::launch_flight(icon);
                d.set_open(false);
                ui.global::<crate::GameData>().set_repacks_open(false);
                ui.global::<crate::GameData>().set_options_open(false);
            }
            Err(error) => {
                crate::download_indicator::cancel_flight();
                // showErrorToast(t("download_error"), t(response.error), 4_000)
                let message = if error.starts_with("download_error_") {
                    shell::tr(&format!("game_details.{error}"))
                } else {
                    error
                };
                crate::toast::error_with(
                    &shell::tr("game_details.download_error"),
                    &message,
                    4_000,
                );
                apply();
            }
        }
    });
}

/// `downloadsPath` from the preferences, else the system Downloads folder.
fn default_downloads_path(prefs: Option<&Value>) -> String {
    prefs
        .and_then(|p| p.get("downloadsPath"))
        .and_then(Value::as_str)
        .filter(|p| !p.is_empty())
        .map(str::to_string)
        .unwrap_or_else(crate::prefs::default_downloads_path)
}

/// The first ROM folder of the emulator (or RetroArch) a classics platform uses.
fn rom_folder(db: &hydra_db::Db, platform: Option<&str>) -> Option<String> {
    let first = |config: Option<Value>| {
        config?
            .get("romFolders")?
            .as_array()?
            .first()?
            .get("path")?
            .as_str()
            .map(str::to_string)
    };
    if let Some(system) = hydra_core::emulation::platform_to_system(platform) {
        return first(db.get_in(keys::EMULATORS, system));
    }
    hydra_core::emulation::platform_to_retroarch(platform)?;
    first(db.get_in(keys::RETROARCH, "config"))
}

/// The modal opened for `repack` (a download option of the open game).
pub fn open(repack: Value, game: GameRef, platform: Option<String>) {
    let shop = game.shop.clone();
    let shop = shop.as_str();
    let Some(ui) = with(|s| s.ui.upgrade()).flatten() else {
        return;
    };
    let db = shell::db();
    let prefs: Option<Value> = db.as_ref().and_then(|db| db.get(keys::USER_PREFERENCES));
    let token = |key: &str| {
        prefs
            .as_ref()
            .and_then(|p| p.get(key))
            .and_then(Value::as_str)
            .is_some_and(|t| !t.is_empty())
    };
    let ctx = OptionsContext {
        real_debrid_token: token("realDebridApiToken"),
        premiumize_token: token("premiumizeApiToken"),
        all_debrid_token: token("allDebridApiToken"),
        torbox_token: token("torBoxApiToken"),
        subscription: ui.global::<Session>().get_has_subscription(),
        premiumize_feature: crate::features::enabled("PREMIUMIZE"),
        all_debrid_feature: crate::features::enabled("ALL_DEBRID"),
    };
    let options = repack
        .as_object()
        .map(|r| repacks::download_options(r, &ctx))
        .unwrap_or_default();
    let available: Vec<Downloader> = options
        .iter()
        .filter(|o| o.available)
        .map(|o| o.downloader)
        .collect();
    let pref_flag = |key: &str| {
        prefs
            .as_ref()
            .and_then(|p| p.get(key))
            .and_then(Value::as_bool)
            .unwrap_or(true)
    };
    let rom = if shop == "launchbox" {
        db.as_ref()
            .and_then(|db| rom_folder(db, platform.as_deref()))
    } else {
        None
    };
    let path = rom.unwrap_or_else(|| default_downloads_path(prefs.as_ref()));

    with(|s| {
        s.repack = Some(repack);
        s.game = Some(game);
        s.options = options;
        s.selected = repacks::default_downloader(&available);
        s.free_space = None;
        s.writable = None;
    });
    let d = ui.global::<DownloadSettings>();
    d.set_extract(pref_flag("extractFilesByDefault"));
    d.set_delete_archives(pref_flag("deleteArchiveFilesAfterExtractionByDefault"));
    d.set_starting(false);
    // TODO(downloads): hasActiveDownload from the download manager's last packet.
    d.set_has_active_download(false);
    set_path(path);
    d.set_open(true);
}

/// The last existing folder of `path` (resolveExistingPath in disk-usage.ts).
fn existing_ancestor(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .find(|p| !p.as_os_str().is_empty() && p.exists())
        .map(Path::to_path_buf)
}

/// getDiskFreeSpace + checkFolderWritePermission for the chosen folder.
fn set_path(path: String) {
    let Some(generation) = with(|s| {
        s.generation += 1;
        s.path = path.clone();
        s.free_space = None;
        s.writable = None;
        s.generation
    }) else {
        return;
    };
    apply();
    let check_write = crate::features::enabled("CHECK_DOWNLOAD_WRITE_PERMISSION");
    std::thread::spawn(move || {
        let folder = PathBuf::from(&path);
        let free = existing_ancestor(&folder).and_then(|p| fs2::available_space(p).ok());
        let writable = !check_write || {
            let test = folder.join(".hydra-write-test");
            std::fs::write(&test, b"").is_ok() && std::fs::remove_file(&test).is_ok()
        };
        let _ = slint::invoke_from_event_loop(move || {
            let current = with(|s| {
                if s.generation != generation {
                    return false;
                }
                s.free_space = free;
                s.writable = Some(writable);
                true
            })
            .unwrap_or(false);
            if current {
                apply();
            }
        });
    });
}

fn apply() {
    let Some((ui, rows, selected, path, free, writable, required, option_ok)) = with(|s| {
        let ui = s.ui.upgrade()?;
        let rows: Vec<DownloaderRow> = s
            .options
            .iter()
            .map(|o| {
                let (state, tooltip) = if o.available {
                    (0, "game_details.downloader_online")
                } else if o.not_configured {
                    (
                        2,
                        if o.downloader == Downloader::VikingFile {
                            "game_details.downloader_requires_hydra_cloud"
                        } else {
                            "game_details.downloader_not_configured"
                        },
                    )
                } else {
                    (1, "game_details.downloader_offline")
                };
                let badge = if o.downloader == Downloader::RealDebrid {
                    "recommended"
                } else if o.downloader == Downloader::VikingFile && o.not_configured {
                    "hydra-cloud"
                } else {
                    ""
                };
                DownloaderRow {
                    kind: o.downloader as i32,
                    name: o.downloader.name().into(),
                    state,
                    badge: badge.into(),
                    tooltip: shell::tr(tooltip).into(),
                }
            })
            .collect();
        let required = s
            .repack
            .as_ref()
            .and_then(|r| r.get("fileSize"))
            .and_then(Value::as_str)
            .and_then(repacks::parse_bytes);
        let option_ok = s
            .options
            .iter()
            .find(|o| Some(o.downloader) == s.selected)
            .is_some_and(|o| o.available && !o.not_configured);
        Some((
            ui,
            rows,
            s.selected,
            s.path.clone(),
            s.free_space,
            s.writable,
            required,
            option_ok,
        ))
    })
    .flatten() else {
        return;
    };
    let enough_space = match (free, required) {
        (Some(free), Some(required)) => free >= required + repacks::MINIMUM_FREE_DISK_SPACE_BYTES,
        _ => true,
    };
    let d = ui.global::<DownloadSettings>();
    d.set_downloaders(ModelRc::new(VecModel::from(rows)));
    d.set_selected(selected.map_or(-1, |d| d as i32));
    d.set_path(path.into());
    d.set_free_space(match free {
        Some(free) => shell::tr_with(
            "game_details.space_left_on_disk",
            &[(
                "space",
                crate::library_page::format_bytes(free as f64).into(),
            )],
        )
        .into(),
        None => SharedString::default(),
    });
    let (error, link) = if writable == Some(false) {
        (shell::tr("game_details.no_write_permission"), true)
    } else if !enough_space {
        (
            shell::tr_with(
                "game_details.not_enough_space_on_disk",
                &[
                    (
                        "required",
                        crate::library_page::format_bytes(required.unwrap_or(0) as f64).into(),
                    ),
                    (
                        "available",
                        crate::library_page::format_bytes(free.unwrap_or(0) as f64).into(),
                    ),
                ],
            ),
            false,
        )
    } else {
        (String::new(), false)
    };
    d.set_path_error(error.into());
    d.set_path_error_link(link);
    d.set_can_start(
        !d.get_starting()
            && selected.is_some()
            && writable == Some(true)
            && enough_space
            && option_ok,
    );
}
