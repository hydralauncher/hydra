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
    std::thread::spawn(move || {
        manager.bootstrap();
        manager.spawn_watch_loop();
    });
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
        Event::ExtractionComplete { .. } => {
            EXTRACTION.with(|e| *e.borrow_mut() = None);
            crate::downloads_page::refresh();
            crate::game_page::on_downloads_updated();
            crate::shell::load_library();
            // TODO(notifications): publishExtractionCompleteNotification
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
            // TODO(notifications): publishDownloadCompleteNotification (OS notification when
            // downloadNotificationsEnabled, and a local notification linking to the game).
            eprintln!("[Downloads] {game_id} complete: {title}");
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

/// pauseGameDownload / resumeGameDownload / cancelGameDownload
pub fn pause(shop: &str, object_id: &str) {
    let Some(manager) = manager() else { return };
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    std::thread::spawn(move || {
        manager.pause_by_id(&shop, &object_id);
    });
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

pub fn has_active_download() -> bool {
    last_packet().is_some()
}

pub fn ui() -> Option<AppWindow> {
    UI.with(|u| u.borrow().as_ref().and_then(|w| w.upgrade()))
}
