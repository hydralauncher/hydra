//! The library's own modals (ui/pages/library/modals.slint):
//! SidebarAddingCustomGameModal (the sidebar "+" and the library "Add game")
//! and the scan games modal with ScanGamesProvider's state
//! (context/scan-games): a scan and its result outlive the modal and the
//! page, and the scan's notification opens the modal again.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use hydra_core::scan::{self, Ambiguous, FoundGame, ScanResult};
use hydra_media::images::{self, Op};
use slint::{ComponentHandle, Image, Model, ModelRc, SharedString, VecModel};

use crate::{
    AppWindow, LibraryModals, ScanAmbiguousRow, ScanChoice, ScanGameRow, nav, shell, toast,
};

#[derive(Default)]
struct Scan {
    folders: Vec<String>,
    scanning: bool,
    cancel: Option<Arc<AtomicBool>>,
    result: Option<ScanResult>,
    pending: Vec<Ambiguous>,
    /// executable path -> picked objectId
    picks: HashMap<String, String>,
    resolving: bool,
    resolved: Vec<FoundGame>,
    choices_width: f32,
}

#[derive(Default)]
struct State {
    ui: slint::Weak<AppWindow>,
    /// The custom game's executable (title follows it until edited).
    custom_path: String,
    custom_adding: bool,
    scan: Scan,
    /// The onboarding's onClose
    onboarding_closed: Option<Box<dyn FnOnce()>>,
    icons: HashMap<String, Image>,
    pending_icons: std::collections::HashSet<String>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn window() -> Option<AppWindow> {
    STATE.with(|s| s.borrow().ui.upgrade())
}

fn t(key: &str) -> String {
    shell::tr(key)
}

pub fn init(ui: &AppWindow) {
    STATE.with(|s| s.borrow_mut().ui = ui.as_weak());
    let modals = ui.global::<LibraryModals>();
    modals.set_scan_windows(cfg!(windows));
    modals.on_custom_browse(browse_executable);
    modals.on_custom_title_edited(|_| update_custom_valid());
    modals.on_custom_add(add_custom_game);
    modals.on_closing(on_closing);
    modals.on_scan_add_folder(add_folders);
    modals.on_scan_remove_folder(|folder| {
        STATE.with(|s| {
            s.borrow_mut()
                .scan
                .folders
                .retain(|f| *f != folder.as_str())
        });
        apply_scan();
    });
    modals.on_scan_start(start_scan);
    modals.on_scan_cancel(|| {
        if let Some(cancel) = STATE.with(|s| s.borrow().scan.cancel.clone()) {
            eprintln!("[ScanInstalledGames] Cancelling scan");
            cancel.store(true, Ordering::Relaxed);
        }
    });
    modals.on_scan_again(|| {
        // onClearResult
        STATE.with(|s| {
            let scan = &mut s.borrow_mut().scan;
            scan.result = None;
            scan.pending.clear();
            scan.picks.clear();
            scan.resolved.clear();
        });
        apply_scan();
    });
    modals.on_scan_pick(|path, object_id| {
        STATE.with(|s| {
            s.borrow_mut()
                .scan
                .picks
                .insert(path.to_string(), object_id.to_string())
        });
        apply_scan();
    });
    modals.on_scan_skip(|| {
        STATE.with(|s| s.borrow_mut().scan.pending.clear());
        apply_scan();
    });
    modals.on_scan_confirm_picks(confirm_picks);
    modals.on_scan_choices_width(|width| {
        let changed = STATE.with(|s| {
            let scan = &mut s.borrow_mut().scan;
            let changed = (scan.choices_width - width).abs() > 0.5;
            scan.choices_width = width;
            changed
        });
        if changed {
            apply_scan();
        }
    });
}

/// The modal's backdrop-filter: blur(2px), from a snapshot of the window.
fn snapshot_backdrop(ui: &AppWindow) {
    let modals = ui.global::<LibraryModals>();
    modals.set_backdrop(Image::default());
    let Ok(snapshot) = ui.window().take_snapshot() else {
        return;
    };
    let scale = ui.window().scale_factor();
    let (w, h) = (snapshot.width(), snapshot.height());
    let rgba = snapshot.as_bytes().to_vec();
    let weak = ui.as_weak();
    std::thread::spawn(move || {
        let Some(pixels) = images::blur_rgba(w, h, rgba, 2, scale) else {
            return;
        };
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = weak.upgrade() {
                ui.global::<LibraryModals>()
                    .set_backdrop(pixels.into_image());
            }
        });
    });
}

fn close() {
    if let Some(ui) = window() {
        let modals = ui.global::<LibraryModals>();
        modals.set_close_request(modals.get_close_request() + 1);
    }
}

/// handleClose of whichever modal is up.
fn on_closing() {
    let Some(ui) = window() else { return };
    let modals = ui.global::<LibraryModals>();
    if modals.get_kind() == "custom-game" {
        STATE.with(|s| s.borrow_mut().custom_path.clear());
        modals.set_custom_title(SharedString::default());
        modals.set_custom_path(SharedString::default());
    } else if modals.get_kind() == "classics-onboarding" {
        // handleClose: "Don't show again" (checked by default) sticks.
        if modals.get_onboarding_dont_show() {
            shell::storage_set(CLASSICS_ONBOARDING_KEY, "true");
        }
        if let Some(on_closed) = STATE.with(|s| s.borrow_mut().onboarding_closed.take()) {
            on_closed();
        }
    } else if modals.get_kind() == "scan" {
        // setSelectedFolders([]); setScanMode(default)
        STATE.with(|s| s.borrow_mut().scan.folders.clear());
        modals.set_scan_mode(if cfg!(windows) { "automatic" } else { "manual" }.into());
    }
}

// ---- ClassicsOnboardingModal

const CLASSICS_ONBOARDING_KEY: &str = "hydra-classics-onboarding-dismissed";

/// hasDismissedClassicsOnboarding
pub fn classics_onboarding_dismissed() -> bool {
    shell::storage_get(CLASSICS_ONBOARDING_KEY).as_deref() == Some("true")
}

/// The Classics welcome (library Classics category, catalogue classics mode);
/// `on_closed` runs when it closes.
pub fn open_classics_onboarding(on_closed: impl FnOnce() + 'static) {
    let Some(ui) = window() else { return };
    let modals = ui.global::<LibraryModals>();
    if !modals.get_kind().is_empty() {
        return;
    }
    snapshot_backdrop(&ui);
    STATE.with(|s| s.borrow_mut().onboarding_closed = Some(Box::new(on_closed)));
    modals.set_onboarding_step(0);
    modals.set_onboarding_dont_show(true);
    modals.set_kind("classics-onboarding".into());
}

// ---- SidebarAddingCustomGameModal

/// The sidebar's "+" and the library toolbar's "Add game".
pub fn open_custom_game() {
    let Some(ui) = window() else { return };
    snapshot_backdrop(&ui);
    let modals = ui.global::<LibraryModals>();
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        s.custom_path.clear();
        s.custom_adding = false;
    });
    modals.set_custom_path(SharedString::default());
    modals.set_custom_title(SharedString::default());
    modals.set_custom_adding(false);
    modals.set_custom_valid(false);
    modals.set_kind("custom-game".into());
}

fn update_custom_valid() {
    let Some(ui) = window() else { return };
    let modals = ui.global::<LibraryModals>();
    let path = STATE.with(|s| s.borrow().custom_path.clone());
    modals
        .set_custom_valid(!modals.get_custom_title().trim().is_empty() && !path.trim().is_empty());
}

/// handleSelectExecutable
fn browse_executable() {
    let Some(ui) = window() else { return };
    let label = t("sidebar.custom_game_modal_executable");
    let dialog = if cfg!(target_os = "linux") {
        rfd::FileDialog::new()
            .add_filter(
                &label,
                &[
                    "exe", "lnk", "bat", "cmd", "AppImage", "sh", "x86_64", "x86", "run", "bin",
                ],
            )
            .add_filter(t("game_details.all_files"), &["*"])
    } else {
        rfd::FileDialog::new().add_filter(
            &label,
            &["exe", "msi", "bat", "cmd", "app", "deb", "rpm", "dmg"],
        )
    };
    let Some(picked) = dialog.pick_file() else {
        return;
    };
    let selected = picked.to_string_lossy().into_owned();
    let modals = ui.global::<LibraryModals>();
    let previous = STATE.with(|s| s.borrow().custom_path.clone());
    let previous_title = if previous.is_empty() {
        String::new()
    } else {
        scan::title_from_executable(&previous)
    };
    STATE.with(|s| s.borrow_mut().custom_path = selected.clone());
    modals.set_custom_path(selected.clone().into());
    let name = modals.get_custom_title().to_string();
    if name.trim().is_empty() || name == previous_title {
        modals.set_custom_title(scan::title_from_executable(&selected).into());
    }
    update_custom_valid();
}

/// handleAddGame
fn add_custom_game() {
    let Some(ui) = window() else { return };
    let modals = ui.global::<LibraryModals>();
    let title = modals.get_custom_title().trim().to_string();
    let path = STATE.with(|s| s.borrow().custom_path.clone());
    if title.is_empty() || path.trim().is_empty() {
        toast::error(&t("sidebar.custom_game_modal_fill_required"));
        return;
    }
    let Some(db) = shell::db() else { return };
    STATE.with(|s| s.borrow_mut().custom_adding = true);
    modals.set_custom_adding(true);
    std::thread::spawn(move || {
        let result = scan::add_custom_game(&db, &title, &path);
        let _ = slint::invoke_from_event_loop(move || {
            STATE.with(|s| s.borrow_mut().custom_adding = false);
            if let Some(ui) = window() {
                ui.global::<LibraryModals>().set_custom_adding(false);
            }
            match result {
                Ok((object_id, title)) => {
                    toast::success(&t("sidebar.custom_game_modal_success"));
                    shell::load_library();
                    nav::navigate(&format!(
                        "/game/custom/{object_id}?title={}",
                        nav::encode(&title)
                    ));
                    on_closing();
                    close();
                }
                Err(error) => {
                    eprintln!("Failed to add custom game: {error}");
                    toast::error(&error.to_string());
                }
            }
        });
    });
}

// ---- Scan games

/// openScanModal (the library toolbar, or `?openScanModal=true`).
pub fn open_scan() {
    let Some(ui) = window() else { return };
    if ui.global::<LibraryModals>().get_kind() == "scan" {
        return;
    }
    snapshot_backdrop(&ui);
    apply_scan();
    ui.global::<LibraryModals>().set_kind("scan".into());
}

pub fn is_scanning() -> bool {
    STATE.with(|s| s.borrow().scan.scanning)
}

fn add_folders() {
    // showOpenDialog({ properties: ["openDirectory", "multiSelections"] })
    let Some(picked) = rfd::FileDialog::new().pick_folders() else {
        return;
    };
    STATE.with(|s| {
        let folders = &mut s.borrow_mut().scan.folders;
        for folder in picked {
            let folder = folder.to_string_lossy().into_owned();
            if !folders.contains(&folder) {
                folders.push(folder);
            }
        }
    });
    apply_scan();
}

/// handleStartScan + the provider's scanInstalledGames call.
fn start_scan() {
    let Some(ui) = window() else { return };
    if is_scanning() {
        return;
    }
    let modals = ui.global::<LibraryModals>();
    let manual = !cfg!(windows) || modals.get_scan_mode() == "manual";
    let add_to_library = modals.get_scan_add_to_library();
    let folders: Vec<PathBuf> = if manual {
        STATE.with(|s| s.borrow().scan.folders.iter().map(PathBuf::from).collect())
    } else {
        Vec::new()
    };
    let (Some(db), Some(api)) = (shell::db(), shell::api()) else {
        return;
    };
    let cancel = Arc::new(AtomicBool::new(false));
    STATE.with(|s| {
        let scan = &mut s.borrow_mut().scan;
        scan.scanning = true;
        scan.cancel = Some(cancel.clone());
        scan.result = None;
        scan.pending.clear();
        scan.picks.clear();
        scan.resolved.clear();
    });
    crate::library_page::set_scanning(true);
    apply_scan();
    // getDownloadsPath: the preference, else the system Downloads folder.
    let downloads = (!manual)
        .then(|| {
            crate::prefs::get()
                .get("downloadsPath")
                .and_then(serde_json::Value::as_str)
                .filter(|p| !p.is_empty())
                .map(str::to_string)
                .unwrap_or_else(crate::prefs::default_downloads_path)
        })
        .filter(|p| !p.is_empty())
        .map(PathBuf::from);
    std::thread::spawn(move || {
        let result = scan::run(
            &db,
            &api,
            &folders,
            !manual,
            add_to_library,
            downloads,
            &cancel,
        );
        let cancelled = cancel.load(Ordering::Relaxed);
        let _ = slint::invoke_from_event_loop(move || finish_scan(result, cancelled));
    });
}

fn finish_scan(result: Result<ScanResult, scan::ScanError>, cancelled: bool) {
    // on-library-batch-complete
    shell::load_library();
    crate::library_page::set_scanning(false);
    match result {
        Ok(result) => {
            if !cancelled {
                let (title, description) = scan::notification_keys(
                    result.added.len(),
                    result.linked.len(),
                    result.ambiguous.len(),
                );
                crate::notify::create_local(
                    "SCAN_GAMES_COMPLETE",
                    &t(&format!("notifications.{title}")),
                    &shell::tr_with(
                        &format!("notifications.{description}"),
                        &[
                            ("added", (result.added.len() as i64).into()),
                            ("linked", (result.linked.len() as i64).into()),
                            ("pending", (result.ambiguous.len() as i64).into()),
                        ],
                    ),
                    None,
                    Some("/library?openScanModal=true"),
                );
            }
            STATE.with(|s| {
                let scan = &mut s.borrow_mut().scan;
                scan.pending = result.ambiguous.clone();
                scan.result = Some(result);
            });
        }
        Err(error) => {
            // The renderer's await rejects: the modal goes back to its options.
            eprintln!("[ScanInstalledGames] {error}");
        }
    }
    STATE.with(|s| {
        let scan = &mut s.borrow_mut().scan;
        scan.scanning = false;
        scan.cancel = None;
    });
    apply_scan();
}

/// handleConfirmPicks: addScannedGames
fn confirm_picks() {
    let picks: Vec<(String, String)> = STATE.with(|s| {
        s.borrow()
            .scan
            .picks
            .iter()
            .map(|(path, id)| (id.clone(), path.clone()))
            .collect()
    });
    let (Some(db), Some(api)) = (shell::db(), shell::api()) else {
        return;
    };
    STATE.with(|s| s.borrow_mut().scan.resolving = true);
    apply_scan();
    std::thread::spawn(move || {
        let added = scan::add_picks(&db, &api, &picks);
        let _ = slint::invoke_from_event_loop(move || {
            if !added.is_empty() {
                shell::load_library();
            }
            STATE.with(|s| {
                let scan = &mut s.borrow_mut().scan;
                scan.resolved = added;
                scan.resolving = false;
                scan.pending.clear();
            });
            apply_scan();
        });
    });
}

/// resolveResultSummary
fn summary(added: usize, linked: usize) -> String {
    let count = |key: &str, n: usize| {
        shell::i18n()
            .map(|i| i.t_count(key, n as f64, &[]))
            .unwrap_or_default()
    };
    let added_text = count("header.scan_games_result_added", added);
    let linked_text = count("header.scan_games_result_linked", linked);
    if added == 0 {
        return linked_text;
    }
    if linked == 0 {
        return added_text;
    }
    shell::tr_with(
        "header.scan_games_result_summary",
        &[("added", added_text.into()), ("linked", linked_text.into())],
    )
}

fn icon(url: Option<&str>) -> (Image, bool) {
    let Some(url) = url.filter(|u| !u.is_empty()) else {
        return (Image::default(), false);
    };
    let cached = STATE.with(|s| s.borrow().icons.get(url).cloned());
    if let Some(image) = cached {
        return (image, true);
    }
    let start = STATE.with(|s| s.borrow_mut().pending_icons.insert(url.to_string()));
    if start && let Some((loader, scale)) = shell::loader() {
        let key = url.to_string();
        loader.load(
            url.to_string(),
            Op::MaxWidth((32.0 * scale).ceil() as u32),
            move |image| {
                STATE.with(|s| {
                    let mut s = s.borrow_mut();
                    s.pending_icons.remove(&key);
                    s.icons.insert(key, image);
                });
                apply_scan();
            },
        );
    }
    // <img> shows nothing until it loads, on the 32px placeholder square.
    (Image::default(), true)
}

/// The choices of one match wrapped like `flex-wrap: wrap; gap: 8px`.
fn wrap_choices(choices: Vec<ScanChoice>, width: f32) -> (Vec<ScanChoice>, f32) {
    const HEIGHT: f32 = 34.0;
    const GAP: f32 = 8.0;
    let (mut x, mut y) = (0.0f32, 0.0f32);
    let mut out = Vec::with_capacity(choices.len());
    for mut choice in choices {
        // padding 8px 16px + 1px border, the 16px icon and its 8px gap
        let w = crate::text_metrics::width(&choice.title, 12.0).ceil()
            + 34.0
            + if choice.has_icon { 24.0 } else { 0.0 };
        if x > 0.0 && x + w > width {
            x = 0.0;
            y += HEIGHT + GAP;
        }
        choice.x = x;
        choice.y = y;
        choice.width = w.min(width);
        x += w + GAP;
        out.push(choice);
    }
    let height = if out.is_empty() { 0.0 } else { y + HEIGHT };
    (out, height)
}

fn game_row(game: &FoundGame) -> ScanGameRow {
    let (image, has_icon) = icon(game.icon_url.as_deref());
    ScanGameRow {
        title: game.title.clone().into(),
        path: game.executable_path.clone().into(),
        icon: image,
        has_icon,
    }
}

/// Copies the scan state into `LibraryModals`.
fn apply_scan() {
    let Some(ui) = window() else { return };
    let modals = ui.global::<LibraryModals>();
    let (folders, scanning, has_result, pending, picks, resolving, added, linked, width) = STATE
        .with(|s| {
            let s = s.borrow();
            let scan = &s.scan;
            let mut added: Vec<FoundGame> = scan
                .result
                .as_ref()
                .map(|r| r.added.clone())
                .unwrap_or_default();
            added.extend(scan.resolved.iter().cloned());
            (
                scan.folders.clone(),
                scan.scanning,
                scan.result.is_some(),
                scan.pending.clone(),
                scan.picks.clone(),
                scan.resolving,
                added,
                scan.result
                    .as_ref()
                    .map(|r| r.linked.clone())
                    .unwrap_or_default(),
                scan.choices_width,
            )
        });
    modals.set_scan_folders(ModelRc::new(VecModel::from(
        folders
            .into_iter()
            .map(SharedString::from)
            .collect::<Vec<_>>(),
    )));
    modals.set_scanning(scanning);
    modals.set_has_result(has_result);
    modals.set_scan_resolving(resolving);
    modals.set_scan_has_picks(!picks.is_empty());
    let rows: Vec<ScanAmbiguousRow> = pending
        .iter()
        .map(|m| {
            let choices: Vec<ScanChoice> = m
                .choices
                .iter()
                .map(|c| {
                    let (image, has_icon) = icon(c.icon_url.as_deref());
                    ScanChoice {
                        object_id: c.object_id.clone().into(),
                        title: c.title.clone().into(),
                        icon: image,
                        has_icon,
                        picked: picks.get(&m.executable_path) == Some(&c.object_id),
                        x: 0.0,
                        y: 0.0,
                        width: 0.0,
                    }
                })
                .collect();
            let (choices, height) = wrap_choices(choices, width.max(1.0));
            ScanAmbiguousRow {
                path: m.executable_path.clone().into(),
                choices: ModelRc::new(VecModel::from(choices)),
                choices_height: height,
            }
        })
        .collect();
    let same_shape = {
        let current = modals.get_scan_pending();
        current.row_count() == rows.len()
    };
    let model = modals.get_scan_pending();
    if same_shape && rows.len() > 0 {
        if let Some(vec) = model.as_any().downcast_ref::<VecModel<ScanAmbiguousRow>>() {
            for (i, row) in rows.into_iter().enumerate() {
                vec.set_row_data(i, row);
            }
        } else {
            modals.set_scan_pending(ModelRc::new(VecModel::from(rows)));
        }
    } else {
        modals.set_scan_pending(ModelRc::new(VecModel::from(rows)));
    }
    modals.set_scan_summary(summary(added.len(), linked.len()).into());
    let games: Vec<ScanGameRow> = added.iter().chain(linked.iter()).map(game_row).collect();
    modals.set_scan_games(ModelRc::new(VecModel::from(games)));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn choice(title: &str) -> ScanChoice {
        ScanChoice {
            object_id: title.into(),
            title: title.into(),
            icon: Image::default(),
            has_icon: false,
            picked: false,
            x: 0.0,
            y: 0.0,
            width: 0.0,
        }
    }

    #[test]
    fn choices_wrap_onto_new_rows() {
        let (laid, height) = wrap_choices(
            vec![choice("Alpha"), choice("Beta"), choice("Gamma")],
            150.0,
        );
        assert_eq!(laid[0].x, 0.0);
        assert!(laid[1].y > 0.0 || laid[1].x > 0.0);
        assert!(height >= 34.0);
        let (one_row, h) = wrap_choices(vec![choice("A"), choice("B")], 1000.0);
        assert_eq!(one_row[1].y, 0.0);
        assert_eq!(h, 34.0);
    }
}
