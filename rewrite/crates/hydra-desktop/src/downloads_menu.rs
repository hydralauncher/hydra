//! download-group.tsx `getGameActions` (the "more" menu of a row) and the
//! completed downloads' main action, plus the Dropdown host wiring.

use std::cell::RefCell;

use hydra_core::repacks::Downloader;
use hydra_db::keys;
use hydra_downloads::layout;
use serde_json::Value;
use slint::{ComponentHandle, ModelRc, VecModel};

use crate::{AppWindow, Dropdown, DropdownItem, shell};

thread_local! {
    static UI: RefCell<Option<slint::Weak<AppWindow>>> = const { RefCell::new(None) };
    /// The row the open menu belongs to.
    static TARGET: RefCell<String> = const { RefCell::new(String::new()) };
}

fn ui() -> Option<AppWindow> {
    UI.with(|u| u.borrow().as_ref().and_then(|w| w.upgrade()))
}

pub fn init(ui: &AppWindow) {
    UI.with(|u| *u.borrow_mut() = Some(ui.as_weak()));
    ui.global::<Dropdown>().on_chosen(|action| {
        let id = TARGET.with(|t| t.borrow().clone());
        run(&id, &action);
    });
}

fn item(id: &str, label: String, icon: &str, disabled: bool) -> DropdownItem {
    DropdownItem {
        id: id.into(),
        label: label.into(),
        icon: icon.into(),
        disabled,
    }
}

/// The menu of row `id`, under the button whose bottom-right corner is (x, y).
pub fn show(id: &str, x: f32, y: f32) {
    let Some(ui) = ui() else { return };
    let Some(db) = shell::db() else { return };
    let Some(download) = layout::get(&db, id) else {
        return;
    };
    let game: Value = db.get_in(keys::GAMES, id).unwrap_or(Value::Null);
    let prefs: Option<Value> = db.get(keys::USER_PREFERENCES);
    let token = |key: &str| {
        prefs
            .as_ref()
            .and_then(|p| p.get(key))
            .and_then(Value::as_str)
            .is_some_and(|t| !t.is_empty())
    };
    let t = shell::tr;
    let downloader = download
        .get("downloader")
        .and_then(Value::as_i64)
        .and_then(Downloader::from_i64);
    let progress = download
        .get("progress")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let status = layout::status(&download).to_string();
    let downloading = crate::downloads::last_packet().is_some_and(|p| p.game_id == id);
    let mut items = Vec::new();

    let finished =
        progress == 1.0 && (downloader != Some(Downloader::Epic) || status == "complete");
    if finished {
        let is_epic = downloader == Some(Downloader::Epic);
        let seeding = status == "seeding";
        // TODO(downloads): run_installer / select_executable with installer availability.
        if !is_epic {
            items.push(item(
                "open-folder",
                t("game_details.open_folder"),
                "folder-open",
                false,
            ));
            items.push(item(
                "extract",
                t("downloads.extract"),
                "file-archive",
                download.get("extracting").and_then(Value::as_bool) == Some(true),
            ));
        }
        if downloader == Some(Downloader::Torrent) {
            if seeding {
                items.push(item(
                    "stop-seeding",
                    t("downloads.stop_seeding"),
                    "unlink",
                    false,
                ));
            } else {
                items.push(item(
                    "resume-seeding",
                    t("downloads.resume_seeding"),
                    "link",
                    false,
                ));
            }
        }
        items.push(item("delete", t("downloads.delete"), "trash", false));
    } else if downloading {
        items.push(item("pause", t("downloads.pause"), "columns", false));
        items.push(item("cancel", t("downloads.cancel"), "x-circle", false));
    } else {
        let resume_disabled = match downloader {
            Some(Downloader::RealDebrid) => !token("realDebridApiToken"),
            Some(Downloader::Premiumize) => !token("premiumizeApiToken"),
            Some(Downloader::AllDebrid) => !token("allDebridApiToken"),
            Some(Downloader::TorBox) => !token("torBoxApiToken"),
            _ => false,
        };
        let queued_ids = crate::downloads_page::queued_ids();
        let index = queued_ids.iter().position(|q| q == id);
        let in_queue =
            index.is_some() && download.get("queued").and_then(Value::as_bool) == Some(true);
        if download.get("awaitingDebrid").and_then(Value::as_bool) == Some(true)
            && download.get("debridAutoResume").and_then(Value::as_bool) == Some(true)
        {
            items.push(item("pause", t("downloads.pause"), "columns", false));
        }
        if downloader == Some(Downloader::Epic) && status == "error" {
            items.push(item(
                "integrations",
                t("settings.integrations"),
                "gear",
                false,
            ));
        }
        items.push(item(
            "resume",
            t("downloads.resume"),
            "play",
            resume_disabled,
        ));
        if in_queue && index != Some(0) {
            items.push(item("move-up", t("downloads.move_up"), "arrow-up", false));
        }
        if in_queue && index != Some(queued_ids.len() - 1) {
            items.push(item(
                "move-down",
                t("downloads.move_down"),
                "arrow-down",
                false,
            ));
        }
        items.push(item("cancel", t("downloads.cancel"), "x-circle", false));
    }
    let _ = game;
    TARGET.with(|t| *t.borrow_mut() = id.to_string());
    let d = ui.global::<Dropdown>();
    d.set_items(ModelRc::new(VecModel::from(items)));
    d.set_anchor_x(x - 34.0);
    d.set_anchor_y(y - 34.0);
    d.set_anchor_width(34.0);
    d.set_anchor_height(34.0);
    d.set_align("end".into());
    d.set_open(true);
}

fn run(id: &str, action: &str) {
    let (shop, object_id) = id.split_once(':').unwrap_or((id, ""));
    match action {
        "pause" => crate::downloads::pause(shop, object_id),
        "resume" => crate::downloads::resume(shop, object_id, "interruptActive"),
        "cancel" => {
            if let Some(ui) = ui() {
                ui.global::<crate::DownloadsData>().invoke_cancel(id.into());
            }
        }
        "integrations" => crate::nav::navigate("/settings?tab=integrations"),
        other => completed_action(id, other),
    }
}

/// The completed rows' buttons and the remaining menu entries.
pub fn completed_action(id: &str, step: &str) {
    let (shop, object_id) = id.split_once(':').unwrap_or((id, ""));
    match step {
        "open-folder" => open_installer_path(id),
        "play" => crate::games::play(shop, object_id),
        "close" => crate::games::close(shop, object_id),
        other => eprintln!("TODO(downloads): {other} for {id}"),
    }
}

/// openGameInstallerPath: the download folder, with the file selected.
fn open_installer_path(id: &str) {
    let Some(db) = shell::db() else { return };
    let Some(download) = layout::get(&db, id) else {
        return;
    };
    let base = download
        .get("downloadPath")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let folder = download
        .get("folderName")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let path = std::path::Path::new(base).join(folder);
    crate::game_menu::reveal(&path);
}
