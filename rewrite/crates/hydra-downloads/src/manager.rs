//! download-manager.ts + download-orchestrator.ts + start-game-download.ts:
//! one transfer at a time, a queue and a paused list (their order is the
//! layout state), progress every 2 seconds, completion.
//!
//! The manager is shared between the UI thread (which only calls into it
//! from worker threads) and its own tokio runtime, where the HTTP transfers
//! run.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use hydra_core::api::{HydraApi, Options as ApiOptions};
use hydra_core::repacks::{self, Downloader};
use hydra_db::{Db, keys};
use serde_json::{Value, json};

use crate::http::{self, HttpDownloader, Phase};
use crate::layout::{self, Download, Layout};

/// DOWNLOAD_ERROR keys the renderer translates (`t(response.error)`).
pub mod errors {
    pub const ARCHIVE_ORG_INVALID_FILE_URL: &str = "download_error_archive_org_invalid_file_url";
    pub const DOWNLOAD_LINK_RETURNED_WEB_PAGE: &str = "download_error_link_returned_web_page";
}

/// StartGameDownloadPayload
#[derive(Clone, Debug)]
pub struct StartPayload {
    pub object_id: String,
    pub title: String,
    pub shop: String,
    pub download_path: String,
    pub downloader: Downloader,
    pub uri: String,
    pub parts: Option<Vec<String>>,
    pub automatically_extract: bool,
    pub automatically_delete_archive_files: bool,
    pub file_size: Option<String>,
    pub file_indices: Option<Vec<i64>>,
    pub selected_files_size: Option<u64>,
}

/// DownloadProgress (the "on-download-progress" packet).
#[derive(Clone, Debug)]
pub struct Progress {
    pub download_speed: f64,
    /// Milliseconds, -1 when unknown.
    pub time_remaining: f64,
    pub num_peers: u64,
    pub num_seeds: u64,
    pub is_downloading_metadata: bool,
    pub is_checking_files: bool,
    pub is_reconnecting: bool,
    pub is_recovering: bool,
    pub recovery_progress: f64,
    pub progress: f64,
    pub game_id: String,
    pub download: Download,
    pub game: Option<Value>,
}

/// What the UI hears about.
pub enum Event {
    /// on-download-progress; `None` clears the live packet.
    Progress(Option<Progress>),
    /// sendDownloadsUpdated: the list changed.
    Updated,
    /// The download finished (publishDownloadCompleteNotification).
    Completed { title: String, game_id: String },
    /// on-extraction-progress (0..1)
    ExtractionProgress { game_id: String, progress: f64 },
    /// on-extraction-complete
    ExtractionComplete { game_id: String },
    /// on-extraction-failed
    ExtractionFailed {
        game_id: String,
        failure: crate::extraction::Failure,
    },
}

type Listener = Box<dyn Fn(Event) + Send + Sync>;

#[derive(Default)]
struct Core {
    downloading_id: Option<String>,
    generation: u64,
    preparing: bool,
    http: Option<HttpDownloader>,
    speed_limit: Option<u64>,
}

pub struct Manager {
    db: Arc<Db>,
    api: Option<Arc<HydraApi>>,
    runtime: tokio::runtime::Runtime,
    core: Mutex<Core>,
    /// withDownloadActivation: activations run one at a time.
    activation: Mutex<()>,
    listener: Listener,
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// calculateETA
fn eta(total: f64, completed: f64, speed: f64) -> f64 {
    let remaining = total - completed;
    if remaining >= 0.0 && speed > 0.0 {
        remaining / speed * 1000.0
    } else {
        -1.0
    }
}

fn downloader_of(d: &Download) -> Option<Downloader> {
    d.get("downloader")
        .and_then(Value::as_i64)
        .and_then(Downloader::from_i64)
}

fn is_http(downloader: Downloader) -> bool {
    downloader != Downloader::Torrent && downloader != Downloader::Epic
}

impl Manager {
    pub fn new(
        db: Arc<Db>,
        api: Option<Arc<HydraApi>>,
        user_data: &std::path::Path,
        listener: Listener,
    ) -> Arc<Manager> {
        crate::range_state::configure_directory(user_data.join("DownloadRanges"));
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("downloads")
            .enable_all()
            .build()
            .expect("downloads runtime");
        Arc::new(Manager {
            db,
            api,
            runtime,
            core: Mutex::new(Core::default()),
            activation: Mutex::new(()),
            listener,
        })
    }

    fn emit(&self, event: Event) {
        (self.listener)(event);
    }

    fn core(&self) -> std::sync::MutexGuard<'_, Core> {
        self.core.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn has_active_download(&self) -> bool {
        self.core().downloading_id.is_some()
    }

    pub fn active_download_id(&self) -> Option<String> {
        self.core().downloading_id.clone()
    }

    /// applyDownloadSpeedLimit
    pub fn set_speed_limit(&self, bytes_per_second: Option<u64>) {
        let mut core = self.core();
        core.speed_limit = bytes_per_second;
        if let Some(http) = core.http.as_ref() {
            http.set_max_download_speed(bytes_per_second);
        }
    }

    // ---- start-game-download.ts

    /// startGameDownload: Ok(()) or the error key/message for the toast.
    pub fn start_game_download(self: &Arc<Self>, payload: StartPayload) -> Result<(), String> {
        let game_key = format!("{}:{}", payload.shop, payload.object_id);
        eprintln!(
            "[Downloads] Start requested for {game_key} (downloader={})",
            payload.downloader as i64
        );
        let parsed_size = payload.file_size.as_deref().and_then(repacks::parse_bytes);
        let mut download: Download = json!({
            "shop": payload.shop,
            "objectId": payload.object_id,
            "status": "paused",
            "progress": 0,
            "bytesDownloaded": 0,
            "downloadPath": payload.download_path,
            "downloader": payload.downloader as i64,
            "uri": payload.uri,
            "folderName": null,
            "shouldSeed": false,
            "timestamp": now_ms(),
            "queued": false,
            "pinnedToHero": false,
            "extracting": false,
            "automaticallyExtract": payload.automatically_extract,
            "automaticallyDeleteArchiveFiles": payload.automatically_delete_archive_files,
            "selectedFilesSize": payload.selected_files_size,
            "fileSize": payload.selected_files_size.or(parsed_size),
            "customTrackers": self.global_trackers(),
        })
        .as_object()
        .cloned()
        .unwrap_or_default();
        if let Some(parts) = payload.parts.as_ref() {
            download.insert("parts".into(), json!(parts));
        }
        if let Some(indices) = payload.file_indices.as_ref() {
            download.insert("fileIndices".into(), json!(indices));
        }

        let mut wrote = false;
        let result = (|| -> Result<(), String> {
            // DownloadOrchestrator.validateDownloadOrMarkPending
            self.validate_download_url(&download)?;
            hydra_core::library_actions::prepare_game_entry(
                &self.db,
                &game_key,
                &payload.title,
                &payload.object_id,
                &payload.shop,
            )
            .map_err(|e| e.to_string())?;
            self.cancel_runtime(&game_key);
            layout::put(&self.db, &download);
            wrote = true;
            self.start_prepared_download(download.clone());
            Ok(())
        })();
        if let Err(error) = result {
            if wrote {
                self.cancel_runtime(&game_key);
                let _ = self.db.delete_in(keys::DOWNLOADS, &game_key);
                self.emit(Event::Updated);
            }
            eprintln!("[Downloads] Failed to start download: {error}");
            return Err(error);
        }
        // createGame + POST /games/{shop}/{objectId}/download
        if let Some(api) = self.api.clone() {
            let db = self.db.clone();
            let (shop, object_id) = (payload.shop.clone(), payload.object_id.clone());
            std::thread::spawn(move || {
                if let Some(Value::Object(game)) = db.get_in::<Value>(keys::GAMES, &game_key) {
                    let _ = hydra_core::library_actions::create_game(&db, &api, &game);
                }
                let _ = api.post(
                    &format!("/games/{shop}/{object_id}/download"),
                    &Value::Null,
                    ApiOptions::public(),
                );
            });
        }
        Ok(())
    }

    /// getGlobalTrackers (manual list only; the URL list comes with the torrent work).
    fn global_trackers(&self) -> Vec<String> {
        let prefs: Option<Value> = self.db.get(keys::USER_PREFERENCES);
        prefs
            .as_ref()
            .and_then(|p| p.get("globalTrackers"))
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    // ---- links

    /// getJsDownloadOptions: the URL, folder and file name for an HTTP downloader.
    fn http_options(&self, download: &Download) -> Result<http::Options, String> {
        let uri = download
            .get("uri")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let save_path = download
            .get("downloadPath")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let resuming = download
            .get("folderName")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        match downloader_of(download) {
            Some(Downloader::ArchiveOrg) => {
                let (identifier, path) = repacks::parse_archive_org_file_uri(uri)
                    .ok_or(errors::ARCHIVE_ORG_INVALID_FILE_URL)?;
                let encode = |s: &str| {
                    s.bytes()
                        .map(|b| match b {
                            b'A'..=b'Z'
                            | b'a'..=b'z'
                            | b'0'..=b'9'
                            | b'-'
                            | b'_'
                            | b'.'
                            | b'!'
                            | b'~'
                            | b'*'
                            | b'\''
                            | b'('
                            | b')' => (b as char).to_string(),
                            _ => format!("%{b:02X}"),
                        })
                        .collect::<String>()
                };
                let encoded_path = path.split('/').map(encode).collect::<Vec<_>>().join("/");
                let url = format!(
                    "https://archive.org/download/{}/{encoded_path}",
                    encode(&identifier)
                );
                let filename = path.rsplit('/').next().unwrap_or(&path).to_string();
                Ok(http::Options::new(
                    url,
                    save_path,
                    Some(resuming.unwrap_or_else(|| crate::filename::sanitize_filename(&filename))),
                ))
            }
            Some(other) => Err(format!(
                "TODO(downloads): {} links are not supported yet",
                other.name()
            )),
            None => Err("Unknown downloader".into()),
        }
    }

    /// validateDownloadUrl: a preflight GET (Range 0-0) so dead links fail before queueing.
    fn validate_download_url(&self, download: &Download) -> Result<(), String> {
        let Some(downloader) = downloader_of(download) else {
            return Ok(());
        };
        if !is_http(downloader) {
            return Ok(());
        }
        let options = self.http_options(download)?;
        self.runtime.block_on(preflight(&options))
    }

    // ---- orchestrator

    /// startPreparedDownload: queue it, then start the queue's head if nothing runs.
    fn start_prepared_download(self: &Arc<Self>, download: Download) {
        let _activation = self.activation.lock().unwrap_or_else(|e| e.into_inner());
        let id = layout::id(&download);
        if let Some(current) = layout::get(&self.db, &id)
            && (layout::is_active_like(&current) || layout::is_terminal(&current))
        {
            return;
        }
        self.queue_download(download, None);
        self.activate_next_queued();
        self.emit(Event::Updated);
    }

    fn queue_download(&self, download: Download, target: Option<usize>) -> Download {
        let mut download = download;
        download.remove("debridQueueOnly");
        download.remove("debridQueuePosition");
        let next = layout::as_queued(download);
        layout::put(&self.db, &next);
        let downloads = layout::all(&self.db);
        let state = layout::normalized(&self.db, &downloads);
        let id = layout::id(&next);
        let queue = layout::with_inserted_id(&state.queue_order, &id, target);
        let paused = state
            .paused_order
            .into_iter()
            .filter(|e| *e != id)
            .collect();
        layout::set_queues(&self.db, &downloads, queue, paused);
        next
    }

    fn has_active_transfer(&self, downloads: &[Download]) -> bool {
        self.has_active_download() || downloads.iter().any(|d| layout::status(d) == "active")
    }

    /// activateNextQueuedDownload
    fn activate_next_queued(self: &Arc<Self>) {
        loop {
            let downloads = layout::all(&self.db);
            if self.has_active_transfer(&downloads) {
                return;
            }
            let state = layout::normalized(&self.db, &downloads);
            let Some(next) = layout::next_queued(&downloads, &state) else {
                self.emit(Event::Updated);
                return;
            };
            if self.activate_download(next).is_some() {
                self.emit(Event::Updated);
                return;
            }
        }
    }

    /// activateDownload: mark it active and start the transfer.
    fn activate_download(self: &Arc<Self>, download: Download) -> Option<Download> {
        let id = layout::id(&download);
        if self.core().downloading_id.as_deref() == Some(id.as_str()) {
            return Some(download);
        }
        let mut active = download;
        for key in [
            "debridQueueOnly",
            "debridQueuePosition",
            "debridPreparationDeadline",
        ] {
            active.remove(key);
        }
        active.insert("awaitingDebrid".into(), json!(false));
        active.insert("debridAutoResume".into(), json!(false));
        active.insert("status".into(), json!("active"));
        active.insert("queued".into(), json!(false));
        active.insert("pinnedToHero".into(), json!(false));
        active.insert("extracting".into(), json!(false));
        active.insert("extractionProgress".into(), json!(0));
        active.insert("timestamp".into(), json!(now_ms()));
        layout::put(&self.db, &active);
        if let Err(error) = self.start_download(&active) {
            eprintln!("[Downloads] Could not start {id}: {error}");
            let failed = layout::as_paused(active, "error");
            layout::put(&self.db, &failed);
            let downloads = layout::all(&self.db);
            let state = layout::normalized(&self.db, &downloads);
            let mut paused = vec![id.clone()];
            paused.extend(state.paused_order.into_iter().filter(|e| *e != id));
            layout::set_queues(
                &self.db,
                &downloads,
                state.queue_order.into_iter().filter(|e| *e != id).collect(),
                paused,
            );
            self.emit(Event::Updated);
            return None;
        }
        Some(active)
    }

    /// DownloadManager.startDownload
    fn start_download(self: &Arc<Self>, download: &Download) -> Result<(), String> {
        let id = layout::id(download);
        let downloader = downloader_of(download).ok_or("Unknown downloader")?;
        if !is_http(downloader) {
            return Err(format!(
                "TODO(downloads): {} downloads are not supported yet",
                downloader.name()
            ));
        }
        let generation = {
            let mut core = self.core();
            core.generation += 1;
            core.downloading_id = Some(id.clone());
            core.preparing = true;
            core.generation
        };
        let options = match self.http_options(download) {
            Ok(options) => options,
            Err(error) => {
                let mut core = self.core();
                if core.generation == generation {
                    core.preparing = false;
                    core.downloading_id = None;
                }
                return Err(error);
            }
        };
        let uri = download
            .get("uri")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let mut options = options;
        options.resource_id = Some(uri);
        let http = HttpDownloader::new();
        {
            let mut core = self.core();
            if core.generation != generation {
                return Ok(());
            }
            http.set_max_download_speed(core.speed_limit);
            core.http = Some(http.clone());
            core.preparing = false;
        }
        eprintln!("[Downloads] Using the HTTP downloader for {}", options.url);
        let this = self.clone();
        self.runtime.spawn(async move {
            if let Err(error) = http.start(options).await {
                let this = this.clone();
                let id = id.clone();
                // handleRuntimeDownloadError touches the DB: off the runtime.
                std::thread::spawn(move || this.handle_runtime_error(&id, &error, generation));
            }
        });
        Ok(())
    }

    /// handleRuntimeDownloadError
    fn handle_runtime_error(self: &Arc<Self>, id: &str, error: &str, generation: u64) {
        {
            let mut core = self.core();
            let current = core.generation == generation
                && core.downloading_id.as_deref().is_none_or(|d| d == id);
            if !current {
                eprintln!("[Downloads] Ignoring stale download error for {id}: {error}");
                return;
            }
            eprintln!("[Downloads] Download failed for {id}: {error}");
            core.downloading_id = None;
            core.preparing = false;
            core.http = None;
        }
        self.emit(Event::Progress(None));
        if let Some(mut download) = layout::get(&self.db, id) {
            download.insert("status".into(), json!("error"));
            download.insert("queued".into(), json!(false));
            download.insert("pinnedToHero".into(), json!(false));
            download.insert("extracting".into(), json!(false));
            layout::put(&self.db, &download);
            let downloads = layout::all(&self.db);
            let state = layout::record(&self.db);
            let mut paused = vec![id.to_string()];
            paused.extend(state.paused_order.into_iter().filter(|e| e != id));
            layout::set_queues(
                &self.db,
                &downloads,
                state.queue_order.into_iter().filter(|e| e != id).collect(),
                paused,
            );
        }
        self.emit(Event::Updated);
        let _activation = self.activation.lock().unwrap_or_else(|e| e.into_inner());
        self.activate_next_queued();
    }

    /// DownloadManager.pauseDownload: stop the transfer, keep its progress.
    fn pause_runtime(&self, id: &str) {
        let http = {
            let mut core = self.core();
            if core.downloading_id.as_deref() != Some(id) {
                return;
            }
            core.generation += 1;
            core.http.clone()
        };
        if let Some(http) = http {
            http.pause();
            self.runtime.block_on(http.wait_for_idle());
            // persistPausedJsProgress
            if let (Some(status), Some(mut download)) = (http.status(), layout::get(&self.db, id)) {
                download.insert("bytesDownloaded".into(), json!(status.bytes_downloaded));
                download.insert("progress".into(), json!(status.progress));
                download.insert("folderName".into(), json!(status.folder_name));
                if status.file_size > 0 {
                    download.insert("fileSize".into(), json!(status.file_size));
                }
                layout::put(&self.db, &download);
            }
        }
        let mut core = self.core();
        core.downloading_id = None;
        core.http = None;
    }

    /// DownloadManager.cancelDownload: stop the transfer and delete its partial file.
    fn cancel_runtime(&self, id: &str) {
        let http = {
            let mut core = self.core();
            if core.downloading_id.as_deref() != Some(id) {
                return;
            }
            core.generation += 1;
            core.http.take()
        };
        if let Some(http) = http {
            if http.status().is_none_or(|s| s.phase != Phase::Complete) {
                http.pause();
            }
            self.runtime.block_on(http.wait_for_idle());
            http.cancel(true);
        }
        let mut core = self.core();
        core.downloading_id = None;
        core.preparing = false;
        drop(core);
        self.emit(Event::Progress(None));
    }

    /// DownloadOrchestrator.pauseDownload
    fn pause_download(
        self: &Arc<Self>,
        download: Download,
        reason: &str,
        start_next: bool,
    ) -> Download {
        let id = layout::id(&download);
        if layout::is_active_like(&download) {
            self.pause_runtime(&id);
            self.emit(Event::Progress(None));
        }
        let saved = layout::get(&self.db, &id).unwrap_or(download);
        let mut next = layout::as_paused(saved, if reason == "error" { "error" } else { "paused" });
        next.insert("debridAutoResume".into(), json!(false));
        for key in [
            "debridQueueOnly",
            "debridQueuePosition",
            "debridPreparationDeadline",
        ] {
            next.remove(key);
        }
        layout::put(&self.db, &next);
        let downloads = layout::all(&self.db);
        let state = layout::normalized(&self.db, &downloads);
        let paused = layout::with_inserted_id(&state.paused_order, &id, Some(0));
        layout::set_queues(
            &self.db,
            &downloads,
            state.queue_order.into_iter().filter(|e| *e != id).collect(),
            paused,
        );
        if start_next && !self.has_active_download() {
            self.activate_next_queued();
        }
        self.emit(Event::Updated);
        next
    }

    /// pauseDownloadById
    pub fn pause_by_id(self: &Arc<Self>, shop: &str, object_id: &str) -> bool {
        let _activation = self.activation.lock().unwrap_or_else(|e| e.into_inner());
        let Some(download) = layout::get(&self.db, &format!("{shop}:{object_id}")) else {
            return false;
        };
        self.pause_download(download, "paused", true);
        true
    }

    /// resumeDownload(shop, objectId, strategy): "interruptActive" | "queueIfActive" | "queue"
    pub fn resume(
        self: &Arc<Self>,
        shop: &str,
        object_id: &str,
        strategy: &str,
        target: Option<usize>,
    ) -> bool {
        let _activation = self.activation.lock().unwrap_or_else(|e| e.into_inner());
        let id = format!("{shop}:{object_id}");
        let Some(download) = layout::get(&self.db, &id) else {
            return false;
        };
        let progress = download
            .get("progress")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        if !matches!(layout::status(&download), "paused" | "active" | "error")
            || (progress == 1.0 && downloader_of(&download) != Some(Downloader::Epic))
        {
            return false;
        }
        let mut ready = download;
        ready.insert("awaitingDebrid".into(), json!(false));
        let downloads = layout::all(&self.db);
        let active = downloads
            .iter()
            .find(|d| layout::is_active_like(d) && layout::id(d) != id)
            .cloned();
        if strategy == "queue" || (active.is_some() && strategy == "queueIfActive") {
            ready.insert("debridAutoResume".into(), json!(false));
            self.queue_download(ready, if strategy == "queue" { target } else { Some(0) });
            if strategy == "queue" {
                self.activate_next_queued();
            }
            self.emit(Event::Updated);
            return true;
        }
        if let Some(active) = active.clone() {
            self.pause_download(active, "paused", false);
        }
        if self.activate_download(ready.clone()).is_none() {
            if let Some(previous) = active {
                self.activate_download(previous);
            }
            return false;
        }
        let downloads = layout::all(&self.db);
        layout::remove(&self.db, &id, &downloads);
        self.emit(Event::Updated);
        true
    }

    /// cancelDownloadById: stop, mark "removed", start the next one.
    pub fn cancel_by_id(self: &Arc<Self>, shop: &str, object_id: &str) -> bool {
        let _activation = self.activation.lock().unwrap_or_else(|e| e.into_inner());
        let id = format!("{shop}:{object_id}");
        let Some(download) = layout::get(&self.db, &id) else {
            return false;
        };
        let was_active = layout::is_active_like(&download);
        self.cancel_runtime(&id);
        let mut removed = download;
        removed.insert("status".into(), json!("removed"));
        for (key, value) in [
            ("queued", false),
            ("pinnedToHero", false),
            ("shouldSeed", false),
            ("extracting", false),
            ("awaitingDebrid", false),
            ("debridAutoResume", false),
        ] {
            removed.insert(key.into(), json!(value));
        }
        for key in [
            "debridQueueOnly",
            "debridQueuePosition",
            "debridPreparationDeadline",
        ] {
            removed.remove(key);
        }
        layout::put(&self.db, &removed);
        let downloads: Vec<Download> = layout::all(&self.db)
            .into_iter()
            .filter(|d| layout::id(d) != id)
            .collect();
        layout::remove(&self.db, &id, &downloads);
        if was_active {
            self.activate_next_queued();
            return true;
        }
        self.emit(Event::Updated);
        true
    }

    /// setQueuePosition / setPausedPosition / moveDownloadPlacement come with the Downloads page.
    pub fn layout(&self) -> Layout {
        layout::sync(&self.db, &layout::all(&self.db))
    }

    pub fn downloads(&self) -> Vec<Download> {
        layout::all(&self.db)
    }

    // ---- startup

    /// bootstrapDownloadsOnStartup + restoring the interrupted download.
    pub fn bootstrap(self: &Arc<Self>) {
        let downloads = layout::all(&self.db);
        let mut interrupted: Option<String> = None;
        for download in &downloads {
            let mut next = download.clone();
            if next.get("extracting").and_then(Value::as_bool) == Some(true) {
                next.insert("extracting".into(), json!(false));
            }
            if next.get("pinnedToHero").and_then(Value::as_bool) == Some(true) {
                next.insert("pinnedToHero".into(), json!(false));
            }
            if layout::status(&next) == "active" {
                let awaiting = next.get("awaitingDebrid").and_then(Value::as_bool) == Some(true);
                next.insert("status".into(), json!("paused"));
                next.insert("queued".into(), json!(interrupted.is_none()));
                if !awaiting && interrupted.is_none() {
                    interrupted = Some(layout::id(&next));
                }
            }
            if layout::is_terminal(&next)
                && next.get("queued").and_then(Value::as_bool) == Some(true)
            {
                next.insert("queued".into(), json!(false));
            }
            if next != *download {
                layout::put(&self.db, &next);
            }
        }
        let downloads = layout::all(&self.db);
        let state = layout::sync(&self.db, &downloads);
        let restore = match interrupted {
            Some(id) => downloads.into_iter().find(|d| layout::id(d) == id),
            None => layout::next_queued(&downloads, &state),
        };
        if let Some(download) = restore {
            let _activation = self.activation.lock().unwrap_or_else(|e| e.into_inner());
            if self.activate_download(download.clone()).is_some() {
                layout::remove(&self.db, &layout::id(&download), &layout::all(&self.db));
            }
            self.emit(Event::Updated);
        }
    }

    // ---- watchDownloads (every 2 seconds)

    pub fn watch(self: &Arc<Self>) {
        let (id, http, preparing) = {
            let core = self.core();
            (
                core.downloading_id.clone(),
                core.http.clone(),
                core.preparing,
            )
        };
        let Some(id) = id else { return };
        let Some(download) = layout::get(&self.db, &id) else {
            eprintln!(
                "[Downloads] Download entry for {id} no longer exists, cancelling orphaned download"
            );
            self.cancel_runtime(&id);
            return;
        };
        let game: Option<Value> = self.db.get_in(keys::GAMES, &id);
        if preparing {
            self.emit(Event::Progress(Some(Progress {
                download_speed: 0.0,
                time_remaining: -1.0,
                num_peers: 0,
                num_seeds: 0,
                is_downloading_metadata: true,
                is_checking_files: false,
                is_reconnecting: false,
                is_recovering: false,
                recovery_progress: 0.0,
                progress: 0.0,
                game_id: id,
                download,
                game,
            })));
            return;
        }
        let Some(http) = http else { return };
        let Some(status) = http.status() else { return };
        let file_size = if status.file_size > 0 {
            Some(status.file_size as f64)
        } else {
            download.get("fileSize").and_then(Value::as_f64)
        };
        let progress = status.progress.clamp(0.0, 1.0);
        let mut updated = download.clone();
        updated.insert("bytesDownloaded".into(), json!(status.bytes_downloaded));
        updated.insert(
            "fileSize".into(),
            file_size.map_or(Value::Null, |s| json!(s as u64)),
        );
        updated.insert("progress".into(), json!(progress));
        updated.insert("folderName".into(), json!(status.folder_name));
        let complete = status.phase == Phase::Complete;
        updated.insert(
            "status".into(),
            json!(if complete { "complete" } else { "active" }),
        );
        if matches!(status.phase, Phase::Active | Phase::Complete) {
            layout::put(&self.db, &updated);
        }
        let packet = Progress {
            download_speed: status.download_speed,
            time_remaining: eta(
                file_size.unwrap_or(0.0),
                status.bytes_downloaded as f64,
                status.download_speed,
            ),
            num_peers: 0,
            num_seeds: 0,
            is_downloading_metadata: false,
            is_checking_files: false,
            is_reconnecting: status.is_reconnecting,
            is_recovering: status.is_recovering,
            recovery_progress: status.recovery_progress,
            progress,
            game_id: id.clone(),
            download: updated.clone(),
            game: game.clone(),
        };
        // TODO(downloads): haltDownloadIfStorageIsFull
        self.emit(Event::Progress(Some(packet)));
        if complete {
            self.handle_completion(updated, game);
        }
    }

    /// handleDownloadCompletion (HTTP downloads: no seeding).
    fn handle_completion(self: &Arc<Self>, download: Download, game: Option<Value>) {
        let id = layout::id(&download);
        let title = game
            .as_ref()
            .and_then(|g| g.get("title"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        self.emit(Event::Completed {
            title,
            game_id: id.clone(),
        });
        let extract = download
            .get("automaticallyExtract")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let mut done = download;
        done.insert("status".into(), json!("complete"));
        done.insert("shouldSeed".into(), json!(false));
        done.insert("queued".into(), json!(false));
        done.insert("pinnedToHero".into(), json!(false));
        done.insert("extracting".into(), json!(extract));
        layout::put(&self.db, &done);
        self.emit(Event::Updated);
        self.cancel_runtime(&id);
        // TODO(downloads): installer size, executable binding without extraction.
        if extract {
            self.extract(&id);
        }
        let _activation = self.activation.lock().unwrap_or_else(|e| e.into_inner());
        self.activate_next_queued();
    }

    /// handleExtraction on a worker thread (also the "Extract" action).
    pub fn extract(self: &Arc<Self>, id: &str) {
        let (this, db, id) = (self.clone(), self.db.clone(), id.to_string());
        if let Some(mut download) = layout::get(&db, &id) {
            download.insert("extracting".into(), json!(true));
            layout::put(&db, &download);
            self.emit(Event::Updated);
        }
        std::thread::Builder::new()
            .name("extraction".into())
            .spawn(move || crate::extraction::Extraction::new(this, db, id).handle())
            .expect("extraction thread");
    }

    pub(crate) fn emit_event(&self, event: Event) {
        self.emit(event);
    }

    pub(crate) fn api(&self) -> Option<Arc<HydraApi>> {
        self.api.clone()
    }

    /// The watch loop thread (main-loop.ts: every INTERVALS.downloadWatcher).
    pub fn spawn_watch_loop(self: &Arc<Self>) {
        let this = self.clone();
        std::thread::Builder::new()
            .name("download-watcher".into())
            .spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_millis(2000));
                    this.watch();
                }
            })
            .expect("download watcher");
    }
}

/// runPreflightAttempt / validatePreflightAttempt
async fn preflight(options: &http::Options) -> Result<(), String> {
    const ATTEMPTS: u32 = 3;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    for attempt in 1..=ATTEMPTS {
        let mut request = client.get(&options.url);
        let has = |name: &str| {
            options
                .headers
                .iter()
                .any(|(k, _)| k.eq_ignore_ascii_case(name))
        };
        for (name, value) in &options.headers {
            request = request.header(name, value);
        }
        if !has("user-agent") {
            request = request.header("user-agent", http::DEFAULT_DOWNLOAD_USER_AGENT);
        }
        if !has("accept-encoding") {
            request = request.header("accept-encoding", "identity");
        }
        if !has("range") {
            request = request.header("range", "bytes=0-0");
        }
        let response = request.send().await.map_err(|e| {
            if e.is_timeout() {
                "Download URL validation timed out".to_string()
            } else {
                e.to_string()
            }
        })?;
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("unknown")
            .to_string();
        eprintln!("[Downloads] Preflight response status={status} content-type={content_type}");
        drop(response);
        if status == 416 {
            return Ok(());
        }
        if [408, 429, 500, 502, 503, 504].contains(&status) {
            if attempt < ATTEMPTS {
                tokio::time::sleep(Duration::from_millis(1000 * attempt as u64)).await;
                continue;
            }
            return Ok(());
        }
        if status >= 400 {
            return Err(format!(
                "The download link is not available (HTTP {status})."
            ));
        }
        if content_type.contains("text/html") || content_type.contains("application/xhtml") {
            return Err(errors::DOWNLOAD_LINK_RETURNED_WEB_PAGE.into());
        }
        return Ok(());
    }
    Ok(())
}
