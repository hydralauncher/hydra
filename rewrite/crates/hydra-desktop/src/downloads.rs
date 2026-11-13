//! The download manager (hydra-downloads) wired to the UI: its progress
//! packets and list changes reach the Downloads page, the sidebar and the
//! game page; the UI's actions run on worker threads.

use std::cell::RefCell;
use std::path::Path;
use std::sync::{Arc, OnceLock};

use hydra_core::api::HydraApi;
use hydra_db::Db;
use hydra_downloads::manager::{Event, Manager, Progress, StartPayload};
use slint::ComponentHandle;

use crate::AppWindow;

static MANAGER: OnceLock<Arc<Manager>> = OnceLock::new();

thread_local! {
    static UI: RefCell<Option<slint::Weak<AppWindow>>> = const { RefCell::new(None) };
    /// The last "on-download-progress" packet (`lastPacket` in the renderer).
    static LAST_PACKET: RefCell<Option<Progress>> = const { RefCell::new(None) };
    /// download-slice `extraction`: (visibleId, progress)
    static EXTRACTION: RefCell<Option<(String, f64)>> = const { RefCell::new(None) };
}

pub fn manager() -> Option<Arc<Manager>> {
    MANAGER.get().cloned()
}

/// The game being extracted and its progress.
pub fn extraction() -> Option<(String, f64)> {
    EXTRACTION.with(|e| e.borrow().clone())
}

/// The live packet, if a download is running.
pub fn last_packet() -> Option<Progress> {
    LAST_PACKET.with(|p| p.borrow().clone())
}

pub fn init(ui: &AppWindow, db: Arc<Db>, api: Arc<HydraApi>, user_data: &Path) {
    UI.with(|u| *u.borrow_mut() = Some(ui.as_weak()));
    let manager = Manager::new(
        db,
        Some(api),
        user_data,
        Box::new(|event| {
            let _ = slint::invoke_from_event_loop(move || on_event(event));
        }),
    );
    let _ = MANAGER.set(manager.clone());
    let _ = slint::invoke_from_event_loop(crate::downloads_page::refresh);
    let probe = manager.clone();
    std::thread::spawn(move || {
        manager.bootstrap();
        manager.spawn_watch_loop();
    });
    // HYDRA_DEV_PROBE_LINK="<downloader number> <uri>": resolve one hoster or
    // debrid link inside the app (FuckingFast needs its webview), print the
    // direct link without its query, download nothing.
    if let Ok(spec) = std::env::var("HYDRA_DEV_PROBE_LINK")
        && let Some((number, uri)) = spec.split_once(' ')
        && let Some(downloader) = number
            .parse()
            .ok()
            .and_then(hydra_core::repacks::Downloader::from_i64)
    {
        let (uri, folder) = (uri.to_string(), user_data.join("probe"));
        std::thread::spawn(move || {
            let started = std::time::Instant::now();
            let result = probe.probe_link(downloader, &uri, &folder.to_string_lossy());
            eprintln!(
                "[DevProbe] {} after {:.1}s: {result:?}",
                downloader.name(),
                started.elapsed().as_secs_f64()
            );
        });
    }
}

fn on_event(event: Event) {
    match event {
        Event::Progress(packet) => {
            LAST_PACKET.with(|p| *p.borrow_mut() = packet.clone());
            crate::downloads_page::on_progress(packet.as_ref());
            crate::game_page::on_download_progress(packet.as_ref());
            // getGameTitle: "Downloading (12%)" in the sidebar list
            crate::shell::refresh_rows();
        }
        Event::Updated => {
            crate::downloads_page::refresh();
            crate::game_page::on_downloads_updated();
            crate::shell::load_library();
        }
        Event::ExtractionProgress { game_id, progress } => {
            EXTRACTION.with(|e| *e.borrow_mut() = Some((game_id, progress)));
            crate::downloads_page::refresh();
            crate::game_page::on_downloads_updated();
        }
        Event::ExtractionComplete { game_id } => {
            EXTRACTION.with(|e| *e.borrow_mut() = None);
            crate::downloads_page::refresh();
            crate::game_page::on_downloads_updated();
            crate::shell::load_library();
            crate::notify::extraction_complete(&game_id);
        }
        Event::ExtractionFailed { failure, .. } => {
            EXTRACTION.with(|e| *e.borrow_mut() = None);
            crate::downloads_page::refresh();
            crate::game_page::on_downloads_updated();
            crate::shell::load_library();
            use hydra_downloads::extraction::Failure;
            let (title, description) = match failure {
                Failure::UnsupportedFormat(format) => (
                    crate::shell::tr("downloads.extraction_unsupported_format_title"),
                    crate::shell::tr_with(
                        "downloads.extraction_unsupported_format_description",
                        &[("format", format.as_str().into())],
                    ),
                ),
                Failure::FileNotFound => (
                    crate::shell::tr("downloads.extraction_file_not_found_title"),
                    crate::shell::tr("downloads.extraction_file_not_found_description"),
                ),
                Failure::Other => (
                    crate::shell::tr("downloads.extraction_failed_title"),
                    crate::shell::tr("downloads.extraction_failed_description"),
                ),
            };
            crate::toast::error_with(&title, &description, 2500);
        }
        Event::Completed { title, game_id } => {
            eprintln!("[Downloads] {game_id} complete: {title}");
            crate::notify::download_complete(&game_id);
        }
    }
}

/// window.electron.startGameDownload: `Err` carries the error key or message.
pub fn start(payload: StartPayload, done: impl FnOnce(Result<(), String>) + Send + 'static) {
    let Some(manager) = manager() else {
        return done(Err("Downloads are not ready".into()));
    };
    std::thread::spawn(move || {
        let result = manager.start_game_download(payload);
        let _ = slint::invoke_from_event_loop(move || done(result));
    });
}

/// window.electron.addGameToQueue (the modal's "Add to queue" while a
/// download runs).
pub fn add_to_queue(payload: StartPayload, done: impl FnOnce(Result<(), String>) + Send + 'static) {
    let Some(manager) = manager() else {
        return done(Err("Downloads are not ready".into()));
    };
    std::thread::spawn(move || {
        let result = manager.add_game_to_queue(payload);
        let _ = slint::invoke_from_event_loop(move || done(result));
    });
}

/// pauseGameDownload / resumeGameDownload / cancelGameDownload
pub fn pause(shop: &str, object_id: &str) {
    pause_confirmed(shop, object_id, false);
}

fn pause_confirmed(shop: &str, object_id: &str, confirmed: bool) {
    let Some(manager) = manager() else { return };
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    std::thread::spawn(move || {
        manager.pause_by_id_confirmed(&shop, &object_id, confirmed);
    });
}

/// download-group.tsx pauseDownload: getDownloadPauseWarning first; a
/// TorBox ZIP that can't resume asks before it starts over.
pub fn pause_with_warning(shop: &str, object_id: &str) {
    let Some(manager) = manager() else { return };
    let id = format!("{shop}:{object_id}");
    if !manager.requires_pause_confirmation(&id) {
        return pause(shop, object_id);
    }
    let t = crate::shell::tr;
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    crate::dialogs::confirm(
        crate::dialogs::Confirm {
            title: &t("downloads.generated_zip_pause_title"),
            description: &t("downloads.generated_zip_pause_message"),
            body: "",
            confirm_label: &t("downloads.pause"),
            cancel_label: &t("downloads.generated_zip_keep_downloading"),
            danger: false,
        },
        move || {
            pause_confirmed(&shop, &object_id, true);
            crate::dialogs::close();
        },
    );
}

/// updateDownloadQueuePosition(shop, objectId, "up" | "down")
pub fn move_in_queue(shop: &str, object_id: &str, up: bool) {
    let Some(manager) = manager() else { return };
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    std::thread::spawn(move || {
        manager.move_in_queue(&shop, &object_id, up);
    });
}

/// window.electron.getDebridFiles(magnet, downloader)
pub fn debrid_files(
    magnet: String,
    downloader: hydra_core::repacks::Downloader,
    done: impl FnOnce(Result<hydra_downloads::manager::TorrentFiles, String>) + Send + 'static,
) {
    let Some(manager) = manager() else {
        return done(Err("download_error_torrent_files_unavailable".into()));
    };
    std::thread::spawn(move || {
        let result =
            dev_files_fixture().unwrap_or_else(|| manager.debrid_files(&magnet, downloader));
        let _ = slint::invoke_from_event_loop(move || done(result));
    });
}

/// HYDRA_DEV_DEBRID_FILES=<json>: the file list from a recorded
/// getDebridFiles answer (`{ name, totalSize, archiveOnly, files: [{ index,
/// path, length }] }`), for screenshots without a debrid account.
fn dev_files_fixture() -> Option<Result<hydra_downloads::manager::TorrentFiles, String>> {
    use serde_json::Value;
    let path = std::env::var("HYDRA_DEV_DEBRID_FILES").ok()?;
    let value: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    let files = value
        .get("files")?
        .as_array()?
        .iter()
        .filter_map(|f| {
            Some(hydra_downloads::debrid::files::DebridFile {
                index: f.get("index")?.as_i64()?,
                path: f.get("path")?.as_str()?.to_string(),
                size: f.get("length")?.as_u64()?,
            })
        })
        .collect::<Vec<_>>();
    std::thread::sleep(std::time::Duration::from_millis(600));
    Some(Ok(hydra_downloads::manager::TorrentFiles {
        name: value.get("name")?.as_str()?.to_string(),
        total_size: files.iter().map(|f| f.size).sum(),
        archive_only: value.get("archiveOnly").and_then(Value::as_bool) == Some(true),
        files,
    }))
}

pub fn resume(shop: &str, object_id: &str, strategy: &'static str) {
    let Some(manager) = manager() else { return };
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    std::thread::spawn(move || {
        manager.resume(&shop, &object_id, strategy, None);
    });
}

pub fn cancel(shop: &str, object_id: &str) {
    let Some(manager) = manager() else { return };
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    std::thread::spawn(move || {
        manager.cancel_by_id(&shop, &object_id);
    });
}

/// DownloadManager.cancelDownload() (sign-out).
pub fn stop_active() {
    let Some(manager) = manager() else { return };
    std::thread::spawn(move || manager.stop_active());
}

pub fn has_active_download() -> bool {
    last_packet().is_some()
}

pub fn ui() -> Option<AppWindow> {
    UI.with(|u| u.borrow().as_ref().and_then(|w| w.upgrade()))
}
