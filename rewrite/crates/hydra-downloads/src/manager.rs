//! download-manager.ts + download-orchestrator.ts + start-game-download.ts:
//! one transfer at a time, a queue and a paused list (their order is the
//! layout state), progress every 2 seconds, completion.
//!
//! The manager is shared between the UI thread (which only calls into it
//! from worker threads) and its own tokio runtime, where the HTTP transfers
//! run.
//!
//! Hoster and debrid links resolve in [`resolve`], multi-file downloads run
//! in [`batches`], and the debrid waiting/readiness flow is [`orchestrate`].

mod batches;
mod orchestrate;
mod resolve;

pub use resolve::TorrentFiles;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use hydra_core::api::{HydraApi, Options as ApiOptions};
use hydra_core::repacks::{self, Downloader};
use hydra_db::{Db, keys};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use crate::errors::{DlError, is_debrid_pending};
use crate::http::{self, HttpDownloader, Phase};
use crate::layout::{self, Download, Layout};
use crate::torbox_batch::TorBoxBatch;

/// DOWNLOAD_ERROR keys the renderer translates (`t(response.error)`).
pub mod errors {
    pub const ARCHIVE_ORG_INVALID_FILE_URL: &str = "download_error_archive_org_invalid_file_url";
    pub const DOWNLOAD_LINK_RETURNED_WEB_PAGE: &str = "download_error_link_returned_web_page";
}

/// The running HTTP transfer: one downloader, or the TorBox batch downloader.
#[derive(Clone)]
pub(crate) enum Transfer {
    Http(HttpDownloader),
    TorBox(TorBoxBatch),
}

impl Transfer {
    fn set_max_download_speed(&self, limit: Option<u64>) {
        match self {
            Transfer::Http(d) => d.set_max_download_speed(limit),
            Transfer::TorBox(d) => d.set_max_download_speed(limit),
        }
    }

    fn pause(&self) {
        match self {
            Transfer::Http(d) => d.pause(),
            Transfer::TorBox(d) => d.pause(),
        }
    }

    async fn wait_for_idle(&self) {
        match self {
            Transfer::Http(d) => d.wait_for_idle().await,
            Transfer::TorBox(d) => d.wait_for_idle().await,
        }
    }

    fn cancel(&self, delete_file: bool) {
        match self {
            Transfer::Http(d) => d.cancel(delete_file),
            Transfer::TorBox(d) => d.cancel(delete_file),
        }
    }

    fn status(&self) -> Option<http::Status> {
        match self {
            Transfer::Http(d) => d.status(),
            Transfer::TorBox(d) => Some(d.status()),
        }
    }
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
    http: Option<Transfer>,
    speed_limit: Option<u64>,
    /// jsBatch: the multi-file download in progress.
    batch: Option<batches::Batch>,
    /// preparationController: cancels the link resolution of the start.
    preparation: Option<CancellationToken>,
}

pub struct Manager {
    db: Arc<Db>,
    api: Option<Arc<HydraApi>>,
    runtime: tokio::runtime::Runtime,
    core: Mutex<Core>,
    /// withDownloadActivation: activations run one at a time.
    activation: Mutex<()>,
    listener: Listener,
    hosters: crate::hosters::Context,
    /// preparedJsDownloads: links resolved by the URL check, reused at start.
    prepared: Mutex<HashMap<String, resolve::PreparedJs>>,
    /// preparedRealDebridDownloads
    prepared_real_debrid: Mutex<HashMap<String, resolve::PreparedRd>>,
    preparations: Mutex<orchestrate::Preparations>,
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
        let hosters = crate::hosters::Context {
            api: api.clone(),
            user_data: user_data.to_path_buf(),
        };
        Arc::new(Manager {
            db,
            api,
            runtime,
            core: Mutex::new(Core::default()),
            activation: Mutex::new(()),
            listener,
            hosters,
            prepared: Mutex::new(HashMap::new()),
            prepared_real_debrid: Mutex::new(HashMap::new()),
            preparations: Mutex::new(orchestrate::Preparations::default()),
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
        let mut download = self.new_download_record(&payload);

        let mut wrote = false;
        let result = (|| -> Result<(), DlError> {
            self.check_parts(&payload)?;
            let in_background = Self::prepares_real_debrid_in_background(&download);
            if !in_background {
                self.validate_or_mark_pending(&mut download)?;
            }
            hydra_core::library_actions::prepare_game_entry(
                &self.db,
                &game_key,
                &payload.title,
                &payload.object_id,
                &payload.shop,
            )
            .map_err(|e| DlError::msg(e.to_string()))?;
            self.cancel_runtime(&game_key);
            layout::put(&self.db, &download);
            wrote = true;
            if download.get("awaitingDebrid").and_then(Value::as_bool) == Some(true) {
                self.save_awaiting(&download, &|| true);
                Ok(())
            } else if in_background {
                self.prepare_and_start(download.clone())
            } else {
                self.start_prepared(download.clone(), None)
            }
        })();
        if let Err(error) = result {
            if wrote {
                self.cancel_runtime(&game_key);
                let _ = self.db.delete_in(keys::DOWNLOADS, &game_key);
                layout::remove(&self.db, &game_key, &layout::all(&self.db));
                self.emit(Event::Updated);
            }
            if error.is_known() {
                eprintln!("Failed to start download with expected download error: {error}");
            } else {
                eprintln!("[Downloads] Failed to start download: {error}");
            }
            return Err(crate::errors::describe(&error, payload.downloader));
        }
        self.register_download(&payload, game_key);
        Ok(())
    }

    /// addGameToQueue: checked like a start, then queued without starting
    /// (a running queue continues with it).
    pub fn add_game_to_queue(self: &Arc<Self>, payload: StartPayload) -> Result<(), String> {
        let game_key = format!("{}:{}", payload.shop, payload.object_id);
        let mut download = self.new_download_record(&payload);
        let prepared = (|| -> Result<(), DlError> {
            self.check_parts(&payload)?;
            if !Self::prepares_real_debrid_in_background(&download) {
                self.validate_or_mark_pending(&mut download)?;
            }
            hydra_core::library_actions::prepare_game_entry(
                &self.db,
                &game_key,
                &payload.title,
                &payload.object_id,
                &payload.shop,
            )
            .map_err(|e| DlError::msg(e.to_string()))?;
            self.cancel_runtime(&game_key);
            Ok(())
        })();
        if let Err(error) = prepared {
            eprintln!("Failed to validate download URL for queue: {error}");
            return Err(crate::errors::describe(&error, payload.downloader));
        }
        layout::put(&self.db, &download);
        self.enqueue_prepared(download);
        self.register_download(&payload, game_key);
        Ok(())
    }

    /// The record startGameDownload / addGameToQueue write.
    fn new_download_record(&self, payload: &StartPayload) -> Download {
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
        download
    }

    /// getMultipartDownloadParts: groups only for hosters that support them,
    /// and only with the feature on.
    fn check_parts(&self, payload: &StartPayload) -> Result<(), DlError> {
        let Some(parts) =
            crate::debrid::files::download_parts(&payload.uri, payload.parts.as_deref())?
        else {
            return Ok(());
        };
        let _ = parts;
        if !repacks::is_multipart_downloader(payload.downloader) {
            return Err(DlError::msg(
                "This downloader does not support multi-part downloads.",
            ));
        }
        self.runtime
            .block_on(crate::hosters::assert_multipart_enabled(&self.hosters))
    }

    /// createGame + POST /games/{shop}/{objectId}/download
    fn register_download(&self, payload: &StartPayload, game_key: String) {
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

    // ---- orchestrator

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

    /// activateNextQueuedDownload after a completion or a failure: a start
    /// that fails parks that download and the next one is tried.
    fn activate_next_queued(self: &Arc<Self>) {
        let _ = self.activate_next(false);
    }

    /// activateNextQueuedDownload: a start that fails stops here and the
    /// error reaches the caller (startGameDownload's toast).
    pub(crate) fn activate_next_queued_checked(self: &Arc<Self>) -> Result<(), DlError> {
        self.activate_next(true)
    }

    fn activate_next(self: &Arc<Self>, stop_on_error: bool) -> Result<(), DlError> {
        loop {
            let downloads = layout::all(&self.db);
            if self.has_active_transfer(&downloads) {
                return Ok(());
            }
            let state = layout::normalized(&self.db, &downloads);
            let Some(next) = layout::next_queued(&downloads, &state) else {
                self.emit(Event::Updated);
                return Ok(());
            };
            match self.activate_download_checked(next) {
                Ok(Some(_)) => {
                    self.emit(Event::Updated);
                    return Ok(());
                }
                Ok(None) => {}
                Err(error) if stop_on_error => return Err(error),
                Err(_) => {}
            }
        }
    }

    /// activateDownload, with a failed start logged.
    fn activate_download(self: &Arc<Self>, download: Download) -> Option<Download> {
        self.activate_download_checked(download).ok().flatten()
    }

    /// activateDownload: mark it active and start the transfer. `Ok(None)`
    /// when it now waits for its debrid service to prepare the files.
    pub(crate) fn activate_download_checked(
        self: &Arc<Self>,
        download: Download,
    ) -> Result<Option<Download>, DlError> {
        let id = layout::id(&download);
        {
            let core = self.core();
            // A repeated manual action keeps the downloader that owns the slot.
            if core.downloading_id.as_deref() == Some(id.as_str()) && !core.preparing {
                return Ok(Some(download));
            }
        }
        let original = download.clone();
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
            if downloader_of(&active).is_some_and(|d| is_debrid_pending(&error, d)) {
                let mut waiting = active.clone();
                for key in ["debridAutoResume", "debridPreparationDeadline"] {
                    match original.get(key) {
                        Some(value) => waiting.insert(key.into(), value.clone()),
                        None => waiting.remove(key),
                    };
                }
                self.save_awaiting(&waiting, &|| true);
                return Ok(None);
            }
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
            return Err(error);
        }
        Ok(Some(active))
    }

    /// DownloadManager.startDownload: resolves the link(s), then the transfer
    /// runs on the downloads runtime.
    fn start_download(self: &Arc<Self>, download: &Download) -> Result<(), DlError> {
        let id = layout::id(download);
        let downloader =
            downloader_of(download).ok_or_else(|| DlError::msg("Unknown downloader"))?;
        if !is_http(downloader) {
            return Err(DlError::msg(format!(
                "TODO(downloads): {} downloads are not supported yet",
                downloader.name()
            )));
        }
        let signal = CancellationToken::new();
        let generation = {
            let mut core = self.core();
            core.generation += 1;
            if let Some(previous) = core.preparation.replace(signal.clone()) {
                previous.cancel();
            }
            core.downloading_id = Some(id.clone());
            core.preparing = true;
            core.http = None;
            core.batch = None;
            core.generation
        };
        let mut download = download.clone();
        let result = self.runtime.block_on(self.start_http_download(
            &mut download,
            &id,
            generation,
            &signal,
        ));
        let mut core = self.core();
        if core.generation != generation {
            // Paused, cancelled or restarted during the preparation.
            return Ok(());
        }
        let reset = |core: &mut Core| {
            core.preparing = false;
            core.downloading_id = None;
            core.http = None;
            core.batch = None;
        };
        match result {
            // An aborted manifest lookup can return without a downloader.
            Ok(()) if core.preparing && signal.is_cancelled() => {
                reset(&mut core);
                Err(DlError::Aborted)
            }
            Ok(()) => Ok(()),
            Err(error) => {
                reset(&mut core);
                Err(error)
            }
        }
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
            core.batch = None;
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
        let (http, generation) = {
            let mut core = self.core();
            if core.downloading_id.as_deref() != Some(id) {
                return;
            }
            core.generation += 1;
            if let Some(preparation) = core.preparation.take() {
                preparation.cancel();
            }
            (core.http.clone(), core.generation)
        };
        if let Some(http) = http {
            http.pause();
            self.runtime.block_on(http.wait_for_idle());
            if let Err(error) = self.persist_paused_js_progress(id, generation) {
                eprintln!("[Downloads] Could not save the paused progress: {error}");
            }
        }
        let mut core = self.core();
        if core.generation == generation {
            core.downloading_id = None;
            core.preparing = false;
            core.http = None;
            core.batch = None;
        }
    }

    /// DownloadManager.cancelDownload: stop the transfer and delete its partial file.
    fn cancel_runtime(&self, id: &str) {
        self.prepared_rd().remove(id);
        let http = {
            let mut core = self.core();
            if core.downloading_id.as_deref() != Some(id) {
                return;
            }
            // Invalidate an in-flight preparation so a late answer can't
            // start a downloader after the cancel.
            core.generation += 1;
            if let Some(preparation) = core.preparation.take() {
                preparation.cancel();
            }
            core.batch = None;
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
        self.invalidate_background_start(&id);
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

    /// pauseDownload/cancelDownload abort a preparation of this download
    /// first, so it releases the activation it holds.
    fn interrupt_preparation(&self, id: &str) {
        self.invalidate_background_start(id);
        let mut core = self.core();
        if core.downloading_id.as_deref() == Some(id) && core.preparing {
            core.generation += 1;
            if let Some(preparation) = core.preparation.take() {
                preparation.cancel();
            }
        }
    }

    /// pauseDownloadById
    pub fn pause_by_id(self: &Arc<Self>, shop: &str, object_id: &str) -> bool {
        self.pause_by_id_confirmed(shop, object_id, false)
    }

    /// pauseDownloadById(shop, objectId, confirmed): a TorBox ZIP that can't
    /// resume needs the user's confirmation (requiresPauseConfirmation).
    pub fn pause_by_id_confirmed(
        self: &Arc<Self>,
        shop: &str,
        object_id: &str,
        confirmed: bool,
    ) -> bool {
        let id = format!("{shop}:{object_id}");
        if !confirmed && self.requires_pause_confirmation(&id) {
            return false;
        }
        self.interrupt_preparation(&id);
        let _activation = self.activation.lock().unwrap_or_else(|e| e.into_inner());
        let Some(download) = layout::get(&self.db, &id) else {
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
        match self.resume_checked(shop, object_id, strategy, target) {
            Ok(resumed) => resumed,
            Err(error) => {
                eprintln!("[Downloads] Could not resume {shop}:{object_id}: {error}");
                false
            }
        }
    }

    /// resumeDownload: a download waiting for its debrid service checks
    /// readiness first (outside the activation lock).
    pub fn resume_checked(
        self: &Arc<Self>,
        shop: &str,
        object_id: &str,
        strategy: &str,
        target: Option<usize>,
    ) -> Result<bool, DlError> {
        let id = format!("{shop}:{object_id}");
        eprintln!("[Downloads] Resume requested for {id} (strategy={strategy})");
        let preparation = self.begin_preparation(&id)?;
        let result = (|| {
            let Some(download) = layout::get(&self.db, &id) else {
                return Ok(false);
            };
            let progress = download
                .get("progress")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            if !matches!(layout::status(&download), "paused" | "active" | "error")
                || (progress == 1.0 && downloader_of(&download) != Some(Downloader::Epic))
            {
                return Ok(false);
            }
            if !self.is_current(&preparation) {
                return Ok(false);
            }
            let Some(ready) = self.ready_for_resume(download, strategy, target, &preparation)?
            else {
                return Ok(false);
            };
            let _activation = self.activation.lock().unwrap_or_else(|e| e.into_inner());
            self.activate_resumed(ready, strategy, target, &preparation)
        })();
        self.dispose(&preparation);
        result
    }

    /// activateResumedDownload
    fn activate_resumed(
        self: &Arc<Self>,
        ready: Download,
        strategy: &str,
        target: Option<usize>,
        preparation: &orchestrate::Preparation,
    ) -> Result<bool, DlError> {
        if !self.is_current(preparation) {
            return Ok(false);
        }
        let id = layout::id(&ready);
        let downloads = layout::all(&self.db);
        let active = downloads
            .iter()
            .find(|d| layout::is_active_like(d) && layout::id(d) != id)
            .cloned();
        if strategy == "queue" || (active.is_some() && strategy == "queueIfActive") {
            let queue_only = ready.get("debridQueueOnly").and_then(Value::as_bool) == Some(true);
            let mut queued = ready;
            queued.insert("debridAutoResume".into(), json!(false));
            queued.remove("debridPreparationDeadline");
            self.queue_download(queued, if strategy == "queue" { target } else { Some(0) });
            let result = if strategy == "queue" && !queue_only {
                self.activate_next_queued_checked()
            } else {
                Ok(())
            };
            self.emit(Event::Updated);
            return result.map(|()| true);
        }
        if let Some(active) = active.clone() {
            self.pause_download(active, "paused", false);
        }
        if self.activate_download_checked(ready)?.is_none() {
            if !self.is_current(preparation) {
                return Ok(false);
            }
            // restoreInterruptedDownload
            if let Some(previous) = active
                && self.activate_download(previous.clone()).is_some()
            {
                layout::remove(&self.db, &layout::id(&previous), &layout::all(&self.db));
                self.emit(Event::Updated);
            }
            return Ok(false);
        }
        let downloads = layout::all(&self.db);
        layout::remove(&self.db, &id, &downloads);
        self.emit(Event::Updated);
        Ok(true)
    }

    /// DownloadManager.cancelDownload() with no id (sign-out): stop whatever is
    /// running without touching the queue.
    pub fn stop_active(&self) {
        if let Some(id) = self.active_download_id() {
            self.cancel_runtime(&id);
        }
    }

    /// cancelDownloadById: stop, mark "removed", start the next one.
    pub fn cancel_by_id(self: &Arc<Self>, shop: &str, object_id: &str) -> bool {
        let id = format!("{shop}:{object_id}");
        self.interrupt_preparation(&id);
        let _activation = self.activation.lock().unwrap_or_else(|e| e.into_inner());
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
        // GofileApi.initialize: a guest token ready before the first GoFile link.
        let hosters = self.hosters.clone();
        self.runtime
            .spawn(async move { crate::hosters::gofile::initialize(&hosters).await });
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
            let awaiting = download.get("awaitingDebrid").and_then(Value::as_bool) == Some(true);
            normalize_awaiting_startup(&mut next);
            if layout::status(&next) == "active" {
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
        let Some(_transfer) = http else { return };
        let Some((updated, js)) = self.js_progress(&id, &download) else {
            return;
        };
        let progress = updated
            .get("progress")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let complete = js.phase == Phase::Complete;
        if matches!(js.phase, Phase::Active | Phase::Complete) {
            layout::put(&self.db, &updated);
        }
        let packet = Progress {
            download_speed: js.speed,
            time_remaining: eta(js.file_size.unwrap_or(0.0), js.bytes as f64, js.speed),
            num_peers: 0,
            num_seeds: 0,
            is_downloading_metadata: false,
            is_checking_files: false,
            is_reconnecting: js.is_reconnecting,
            is_recovering: js.is_recovering,
            recovery_progress: js.recovery_progress,
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
        // TODO(downloads): installer size.
        if extract {
            self.extract(&id);
        } else {
            let this = self.clone();
            let id = id.clone();
            std::thread::spawn(move || this.bind_executable(&id));
        }
        let _activation = self.activation.lock().unwrap_or_else(|e| e.into_inner());
        self.activate_next_queued();
    }

    /// searchAndBindExecutable for the download's game; the library
    /// reloads when it binds one.
    pub(crate) fn bind_executable(&self, id: &str) {
        let (Some(api), Some((shop, object_id))) = (self.api(), id.split_once(':')) else {
            return;
        };
        let before: Option<serde_json::Value> = self.db.get_in(hydra_db::keys::GAMES, id);
        let had = before
            .as_ref()
            .and_then(|g| g.get("executablePath"))
            .and_then(serde_json::Value::as_str)
            .is_some_and(|s| !s.is_empty());
        if hydra_core::executables::search_and_bind(&self.db, &api, shop, object_id).is_some()
            && !had
        {
            self.emit(Event::Updated);
        }
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

    /// The watch loop thread (main-loop.ts: every INTERVALS.downloadWatcher),
    /// and the debrid readiness watcher next to it.
    pub fn spawn_watch_loop(self: &Arc<Self>) {
        self.spawn_debrid_watch_loop();
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

/// normalizeAwaitingStartupDownload: a download that waited for its debrid
/// service resumes waiting only inside its preparation window.
fn normalize_awaiting_startup(download: &mut Download) {
    if download.get("awaitingDebrid").and_then(Value::as_bool) != Some(true) {
        return;
    }
    let clear = |download: &mut Download| {
        download.insert("debridAutoResume".into(), json!(false));
        for key in [
            "debridQueueOnly",
            "debridQueuePosition",
            "debridPreparationDeadline",
        ] {
            download.remove(key);
        }
    };
    if layout::is_terminal(download) {
        download.insert("awaitingDebrid".into(), json!(false));
        clear(download);
        return;
    }
    download.insert("status".into(), json!("paused"));
    download.insert("queued".into(), json!(false));
    let deadline = download
        .get("debridPreparationDeadline")
        .and_then(Value::as_f64)
        .filter(|d| d.is_finite());
    if download.get("debridAutoResume").and_then(Value::as_bool) == Some(true)
        && deadline.is_none_or(|d| d <= now_ms())
    {
        clear(download);
    }
}
