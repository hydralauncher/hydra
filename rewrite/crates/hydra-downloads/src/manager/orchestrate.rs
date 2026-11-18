//! download-orchestrator.ts, the debrid side: downloads waiting for a
//! debrid service to prepare their files ("awaiting debrid"), the readiness
//! poll that starts them (debridAutoResume within a 5-minute window),
//! Real-Debrid magnets prepared in the background, "add to queue", queue
//! positions and the paused list order.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use hydra_core::repacks::Downloader;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use super::resolve::{downloader_of, text};
use super::{Event, Manager, now_ms};
use crate::errors::{DlError, DlResult, is_debrid_pending};
use crate::layout::{self, Download};

/// DEBRID_PREPARATION_WINDOW_MS
const DEBRID_PREPARATION_WINDOW_MS: f64 = 5.0 * 60.0 * 1000.0;
/// DEBRID_READINESS_POLL_MS
const DEBRID_READINESS_POLL: Duration = Duration::from_millis(5000);
/// INTERVALS.debridReadinessWatcher
const DEBRID_READINESS_WATCHER: Duration = Duration::from_millis(5000);

const DEBRID_FIELDS: [&str; 3] = [
    "debridQueueOnly",
    "debridQueuePosition",
    "debridPreparationDeadline",
];

/// backgroundStartVersions / preparationControllers / pendingBackgroundStarts
#[derive(Default)]
pub(crate) struct Preparations {
    versions: HashMap<String, u64>,
    controllers: HashMap<String, (u64, CancellationToken)>,
    pending_background: HashMap<String, u64>,
    next_request: u64,
    last_poll: HashMap<String, Instant>,
    shutting_down: bool,
}

/// beginPreparation's handle: a signal, and whether it is still the newest.
#[derive(Clone)]
pub(crate) struct Preparation {
    key: String,
    version: u64,
    pub signal: CancellationToken,
}

fn flag(download: &Download, key: &str) -> bool {
    download.get(key).and_then(Value::as_bool) == Some(true)
}

fn clear_debrid(download: &mut Download) {
    for key in DEBRID_FIELDS {
        download.remove(key);
    }
}

impl Manager {
    fn preparations(&self) -> std::sync::MutexGuard<'_, Preparations> {
        self.preparations.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// invalidateBackgroundStart
    pub(crate) fn invalidate_background_start(&self, key: &str) {
        let mut p = self.preparations();
        p.pending_background.remove(key);
        if let Some((_, token)) = p.controllers.remove(key) {
            token.cancel();
        }
        *p.versions.entry(key.to_string()).or_insert(0) += 1;
    }

    /// beginPreparation
    pub(crate) fn begin_preparation(&self, key: &str) -> DlResult<Preparation> {
        if self.preparations().shutting_down {
            return Err(DlError::Aborted);
        }
        self.invalidate_background_start(key);
        let mut p = self.preparations();
        let version = p.versions.get(key).copied().unwrap_or(0);
        let signal = CancellationToken::new();
        p.controllers
            .insert(key.to_string(), (version, signal.clone()));
        Ok(Preparation {
            key: key.to_string(),
            version,
            signal,
        })
    }

    pub(crate) fn has_current_version(&self, preparation: &Preparation) -> bool {
        self.preparations().versions.get(&preparation.key).copied() == Some(preparation.version)
    }

    pub(crate) fn is_current(&self, preparation: &Preparation) -> bool {
        !preparation.signal.is_cancelled() && self.has_current_version(preparation)
    }

    pub(crate) fn dispose(&self, preparation: &Preparation) {
        let mut p = self.preparations();
        if p.controllers
            .get(&preparation.key)
            .is_some_and(|(v, _)| *v == preparation.version)
        {
            p.controllers.remove(&preparation.key);
        }
    }

    /// cancelPendingDebridPreparations (shutdown)
    pub fn cancel_pending_debrid_preparations(&self) {
        let keys: Vec<String> = {
            let mut p = self.preparations();
            p.shutting_down = true;
            p.pending_background.clear();
            p.controllers.keys().cloned().collect()
        };
        for key in keys {
            self.invalidate_background_start(&key);
        }
    }

    /// preparesRealDebridInBackground
    pub fn prepares_real_debrid_in_background(download: &Download) -> bool {
        downloader_of(download) == Some(Downloader::RealDebrid)
            && text(download, "uri").is_some_and(|u| u.starts_with("magnet:"))
    }

    /// validateDownloadOrMarkPending
    pub(crate) fn validate_or_mark_pending(&self, download: &mut Download) -> DlResult<()> {
        let downloader = downloader_of(download);
        match self
            .runtime
            .block_on(self.validate_js_download(download, None))
        {
            Ok(()) => Ok(()),
            Err(error) if downloader.is_some_and(|d| is_debrid_pending(&error, d)) => {
                download.insert("awaitingDebrid".into(), json!(true));
                Ok(())
            }
            Err(error) => Err(error),
        }
    }

    /// saveAwaitingDebridDownload: paused at the front of the paused list
    /// while the service prepares it.
    pub(crate) fn save_awaiting(
        &self,
        download: &Download,
        is_current: &dyn Fn() -> bool,
    ) -> Option<Download> {
        if !is_current() {
            return None;
        }
        let mut next = download.clone();
        let keep_deadline = flag(download, "debridAutoResume")
            && download
                .get("debridPreparationDeadline")
                .and_then(Value::as_f64)
                .is_some_and(f64::is_finite);
        let deadline = if keep_deadline {
            download
                .get("debridPreparationDeadline")
                .cloned()
                .unwrap_or(Value::Null)
        } else {
            json!(now_ms() + DEBRID_PREPARATION_WINDOW_MS)
        };
        next.insert("awaitingDebrid".into(), json!(true));
        next.insert("debridAutoResume".into(), json!(true));
        next.insert("debridPreparationDeadline".into(), deadline);
        let next = layout::as_paused(next, "paused");
        layout::put(&self.db, &next);
        if !is_current() {
            return None;
        }
        let id = layout::id(download);
        let downloads = layout::all(&self.db);
        let state = layout::normalized(&self.db, &downloads);
        layout::set_queues(
            &self.db,
            &downloads,
            state.queue_order.into_iter().filter(|e| *e != id).collect(),
            layout::with_inserted_id(&state.paused_order, &id, Some(0)),
        );
        self.emit(Event::Updated);
        Some(next)
    }

    /// saveDebridPreparationError
    fn save_preparation_error(&self, download: &Download, is_current: &dyn Fn() -> bool) {
        if !is_current() {
            return;
        }
        let mut next = download.clone();
        next.insert("awaitingDebrid".into(), json!(false));
        next.insert("debridAutoResume".into(), json!(false));
        clear_debrid(&mut next);
        layout::put(&self.db, &layout::as_paused(next, "error"));
        if !is_current() {
            return;
        }
        layout::sync(&self.db, &layout::all(&self.db));
        self.emit(Event::Updated);
    }

    /// expireDebridPreparation: the window passed; it stays paused.
    fn expire_preparation(&self, download: &Download) {
        let Some(mut current) = layout::get(&self.db, &layout::id(download)) else {
            return;
        };
        if !flag(&current, "awaitingDebrid")
            || !flag(&current, "debridAutoResume")
            || layout::status(&current) != "paused"
            || current.get("debridPreparationDeadline") != download.get("debridPreparationDeadline")
        {
            return;
        }
        current.insert("queued".into(), json!(false));
        current.insert("debridAutoResume".into(), json!(false));
        clear_debrid(&mut current);
        layout::put(&self.db, &current);
        self.emit(Event::Updated);
    }

    /// isAwaitingDebridReady
    pub(crate) fn is_awaiting_ready(
        &self,
        download: &mut Download,
        signal: Option<&CancellationToken>,
    ) -> DlResult<bool> {
        if !flag(download, "awaitingDebrid") {
            return Ok(true);
        }
        let downloader = downloader_of(download);
        let result = if Self::prepares_real_debrid_in_background(download) {
            self.runtime
                .block_on(self.prepare_real_debrid_download(download, signal))
        } else {
            self.runtime
                .block_on(self.validate_js_download(download, signal))
                .map(|()| true)
        };
        match result {
            Err(error) if downloader.is_some_and(|d| is_debrid_pending(&error, d)) => Ok(false),
            other => other,
        }
    }

    /// prepareRealDebridForQueue
    fn prepare_real_debrid_for_queue(
        &self,
        download: &mut Download,
        is_current: &dyn Fn() -> bool,
        signal: Option<&CancellationToken>,
    ) -> DlResult<bool> {
        if !Self::prepares_real_debrid_in_background(download) {
            return Ok(true);
        }
        match self
            .runtime
            .block_on(self.prepare_real_debrid_download(download, signal))
        {
            Ok(true) => Ok(is_current()),
            Ok(false) => {
                if is_current() {
                    self.save_awaiting(download, is_current);
                }
                Ok(false)
            }
            Err(_) if !is_current() => Ok(false),
            Err(error) if is_debrid_pending(&error, Downloader::RealDebrid) => {
                self.save_awaiting(download, is_current);
                Ok(false)
            }
            Err(error) => {
                let mut failed = download.clone();
                failed.insert("status".into(), json!("error"));
                failed.insert("queued".into(), json!(false));
                failed.insert("awaitingDebrid".into(), json!(false));
                failed.insert("debridAutoResume".into(), json!(false));
                clear_debrid(&mut failed);
                layout::put(&self.db, &failed);
                self.emit(Event::Updated);
                Err(error)
            }
        }
    }

    /// startPreparedDownload: queue it, then start the queue's head when
    /// nothing runs (Real-Debrid magnets are prepared first).
    pub(crate) fn start_prepared(
        self: &Arc<Self>,
        download: Download,
        preparation: Option<&Preparation>,
    ) -> DlResult<()> {
        let owned = match preparation {
            Some(_) => None,
            None => Some(self.begin_preparation(&layout::id(&download))?),
        };
        let Some(preparation) = preparation.or(owned.as_ref()) else {
            return Ok(());
        };
        let is_current = || self.is_current(preparation);
        let mut download = download;
        let result = (|| {
            if !self.prepare_real_debrid_for_queue(
                &mut download,
                &is_current,
                Some(&preparation.signal),
            )? {
                return Ok(());
            }
            let _activation = self.activation.lock().unwrap_or_else(|e| e.into_inner());
            if !is_current() {
                return Ok(());
            }
            let id = layout::id(&download);
            if let Some(current) = layout::get(&self.db, &id)
                && (layout::is_active_like(&current) || layout::is_terminal(&current))
            {
                return Ok(());
            }
            let queue_only = flag(&download, "debridQueueOnly");
            let position = download
                .get("debridQueuePosition")
                .and_then(Value::as_u64)
                .map(|p| p as usize);
            self.queue_download(download.clone(), position);
            if !is_current() {
                return Ok(());
            }
            // Read the slot after preparation and queue persistence.
            let result = if queue_only {
                Ok(())
            } else {
                self.activate_next_queued_checked()
            };
            self.emit(Event::Updated);
            result
        })();
        if let Some(owned) = owned.as_ref() {
            self.dispose(owned);
        }
        result
    }

    /// prepareAndStartDownload: Real-Debrid magnets wait as "awaiting debrid"
    /// while Real-Debrid prepares them.
    pub(crate) fn prepare_and_start(self: &Arc<Self>, download: Download) -> DlResult<()> {
        let key = layout::id(&download);
        let request = {
            let mut p = self.preparations();
            if p.shutting_down {
                return Ok(());
            }
            p.next_request += 1;
            let request = p.next_request;
            p.pending_background.insert(key.clone(), request);
            request
        };
        // beginBackgroundPreparation
        let preparation = {
            let _activation = self.activation.lock().unwrap_or_else(|e| e.into_inner());
            let pending =
                self.preparations().pending_background.get(&key).copied() == Some(request);
            let current = layout::get(&self.db, &key);
            let busy = current
                .as_ref()
                .is_some_and(|c| layout::is_active_like(c) || layout::is_terminal(c));
            let preparation = if pending && !busy {
                let preparation = self.begin_preparation(&key)?;
                // Persist the waiting intent first, so completion and restart
                // can't pick an item whose files are still being prepared.
                self.save_awaiting(&download, &|| self.is_current(&preparation));
                Some(preparation)
            } else {
                None
            };
            let mut p = self.preparations();
            if p.pending_background.get(&key).copied() == Some(request) {
                p.pending_background.remove(&key);
            }
            preparation
        };
        let Some(preparation) = preparation else {
            return Ok(());
        };
        if !self.is_current(&preparation) {
            self.dispose(&preparation);
            return Ok(());
        }
        let result = self.start_prepared(download, Some(&preparation));
        self.dispose(&preparation);
        match result {
            Err(error) if self.is_current(&preparation) => Err(error),
            _ => Ok(()),
        }
    }

    /// enqueuePreparedDownload ("Add to queue"): an idle queue stays manual,
    /// a running one continues.
    pub fn enqueue_prepared(self: &Arc<Self>, download: Download) {
        let mut queued = download.clone();
        queued.insert("debridQueueOnly".into(), json!(!self.has_active_download()));
        if flag(&download, "awaitingDebrid") {
            self.save_awaiting(&queued, &|| true);
        } else if Self::prepares_real_debrid_in_background(&download) {
            let this = self.clone();
            std::thread::spawn(move || {
                if let Err(error) = this.prepare_and_start(queued) {
                    eprintln!("Failed to prepare queued download: {error}");
                }
            });
        } else {
            self.queue_download(download, None);
        }
        self.emit(Event::Updated);
    }

    /// activateReadyDebridDownload
    fn activate_ready_debrid(
        self: &Arc<Self>,
        download: &Download,
        preparation: &Preparation,
    ) -> DlResult<()> {
        let is_current = || self.is_current(preparation);
        if !is_current() {
            return Ok(());
        }
        let id = layout::id(download);
        let Some(current) = layout::get(&self.db, &id) else {
            return Ok(());
        };
        if !is_current()
            || !flag(&current, "awaitingDebrid")
            || !flag(&current, "debridAutoResume")
            || current.get("uri") != download.get("uri")
        {
            return Ok(());
        }
        let mut ready = current.clone();
        if let Some(torrent) = download.get("realDebridTorrentId") {
            ready.insert("realDebridTorrentId".into(), torrent.clone());
        }
        ready.insert("awaitingDebrid".into(), json!(false));
        ready.insert("debridAutoResume".into(), json!(false));
        ready.remove("debridQueueOnly");
        ready.remove("debridPreparationDeadline");
        if flag(&current, "debridQueueOnly") {
            let position = ready
                .get("debridQueuePosition")
                .and_then(Value::as_u64)
                .map(|p| p as usize);
            self.queue_download(ready, position);
            self.emit(Event::Updated);
            return Ok(());
        }
        let downloads = layout::all(&self.db);
        if !is_current() {
            return Ok(());
        }
        let state = layout::normalized(&self.db, &downloads);
        if self.has_active_transfer(&downloads)
            || !layout::queued_in_order(&downloads, &state).is_empty()
        {
            let position = ready
                .get("debridQueuePosition")
                .and_then(Value::as_u64)
                .map(|p| p as usize);
            self.queue_download(ready, position);
            if !is_current() {
                return Ok(());
            }
            let result = self.activate_next_queued_checked();
            self.emit(Event::Updated);
            return result;
        }
        let activated = self.activate_download_checked(ready.clone())?;
        if activated.is_none() || !is_current() {
            return Ok(());
        }
        layout::remove(&self.db, &id, &layout::all(&self.db));
        self.emit(Event::Updated);
        Ok(())
    }

    /// pollAwaitingDebridDownloads: one readiness check per waiting download
    /// every 5 seconds, until its deadline.
    pub fn poll_awaiting_debrid(self: &Arc<Self>) {
        if self.preparations().shutting_down {
            return;
        }
        let now = now_ms();
        for download in layout::all(&self.db) {
            if layout::status(&download) != "paused"
                || !flag(&download, "awaitingDebrid")
                || !flag(&download, "debridAutoResume")
            {
                continue;
            }
            let key = layout::id(&download);
            let deadline = download
                .get("debridPreparationDeadline")
                .and_then(Value::as_f64)
                .filter(|d| d.is_finite());
            let Some(deadline) = deadline.filter(|d| *d > now) else {
                self.invalidate_background_start(&key);
                self.expire_preparation(&download);
                continue;
            };
            {
                let mut p = self.preparations();
                let recent = p
                    .last_poll
                    .get(&key)
                    .is_some_and(|at| at.elapsed() < DEBRID_READINESS_POLL);
                if p.controllers.contains_key(&key) || recent {
                    continue;
                }
                p.last_poll.insert(key.clone(), Instant::now());
            }
            let Ok(preparation) = self.begin_preparation(&key) else {
                continue;
            };
            let this = self.clone();
            std::thread::Builder::new()
                .name("debrid-readiness".into())
                .spawn(move || this.run_readiness_poll(download, preparation, deadline - now))
                .ok();
        }
    }

    /// startDebridReadinessPoll's poll.
    fn run_readiness_poll(
        self: Arc<Self>,
        download: Download,
        preparation: Preparation,
        remaining_ms: f64,
    ) {
        let key = layout::id(&download);
        let downloader = downloader_of(&download);
        // The deadline also stops a provider call that ignores cancellation.
        let timer = {
            let signal = preparation.signal.clone();
            let wait = Duration::from_millis(remaining_ms.max(0.0) as u64);
            self.runtime.spawn(async move {
                tokio::time::sleep(wait).await;
                signal.cancel();
            })
        };
        let mut probe = download.clone();
        let result = self.is_awaiting_ready(&mut probe, Some(&preparation.signal));
        timer.abort();
        let outcome = (|| -> DlResult<()> {
            let ready = result?;
            if !self.is_current(&preparation) {
                return Ok(());
            }
            if !ready {
                let Some(mut current) = layout::get(&self.db, &key) else {
                    return Ok(());
                };
                if !self.is_current(&preparation) || !flag(&current, "debridAutoResume") {
                    return Ok(());
                }
                // Preparation can discover the cloud torrent ID before its files.
                if let Some(torrent) = probe.get("realDebridTorrentId") {
                    current.insert("realDebridTorrentId".into(), torrent.clone());
                }
                layout::put(&self.db, &current);
                return Ok(());
            }
            let _activation = self.activation.lock().unwrap_or_else(|e| e.into_inner());
            self.activate_ready_debrid(&probe, &preparation)
        })();
        if let Err(error) = outcome
            && self.has_current_version(&preparation)
        {
            if preparation.signal.is_cancelled() {
                self.expire_preparation(&download);
            } else if !downloader.is_some_and(|d| is_debrid_pending(&error, d)) {
                self.save_preparation_error(&download, &|| self.is_current(&preparation));
                eprintln!("Failed to prepare pending debrid download: {error}");
            }
        }
        self.dispose(&preparation);
    }

    /// The readiness watcher (main-loop.ts: every 5 seconds).
    pub fn spawn_debrid_watch_loop(self: &Arc<Self>) {
        let this = self.clone();
        std::thread::Builder::new()
            .name("debrid-watcher".into())
            .spawn(move || {
                loop {
                    std::thread::sleep(DEBRID_READINESS_WATCHER);
                    this.poll_awaiting_debrid();
                }
            })
            .expect("debrid watcher");
    }

    /// resumeDownloadWithPreparation's readiness step: `Ok(None)` when the
    /// download is now waiting for its debrid service.
    pub(crate) fn ready_for_resume(
        &self,
        download: Download,
        strategy: &str,
        target: Option<usize>,
        preparation: &Preparation,
    ) -> DlResult<Option<Download>> {
        let mut resuming = download;
        resuming.insert("debridAutoResume".into(), json!(true));
        resuming.insert(
            "debridQueueOnly".into(),
            json!(strategy == "queue" && !self.has_active_download()),
        );
        match target.filter(|_| strategy == "queue") {
            Some(target) => resuming.insert("debridQueuePosition".into(), json!(target)),
            None => resuming.remove("debridQueuePosition"),
        };
        resuming.insert(
            "debridPreparationDeadline".into(),
            json!(now_ms() + DEBRID_PREPARATION_WINDOW_MS),
        );
        let is_current = || self.is_current(preparation);
        match self.is_awaiting_ready(&mut resuming, Some(&preparation.signal)) {
            Ok(true) => {}
            Ok(false) => {
                self.save_awaiting(&resuming, &is_current);
                return Ok(None);
            }
            Err(error) => {
                if is_current() {
                    self.save_preparation_error(&resuming, &is_current);
                    return Err(error);
                }
                return Ok(None);
            }
        }
        if !is_current() {
            return Ok(None);
        }
        resuming.insert("awaitingDebrid".into(), json!(false));
        Ok(Some(resuming))
    }

    // ---- queue order

    /// setQueuePosition
    pub fn set_queue_position(&self, shop: &str, object_id: &str, target: usize) -> bool {
        let downloads = layout::all(&self.db);
        let state = layout::sync(&self.db, &downloads);
        let id = format!("{shop}:{object_id}");
        if !layout::queued_in_order(&downloads, &state)
            .iter()
            .any(|d| layout::id(d) == id)
        {
            return false;
        }
        layout::set_queues(
            &self.db,
            &downloads,
            layout::with_inserted_id(&state.queue_order, &id, Some(target)),
            state.paused_order,
        );
        self.emit(Event::Updated);
        true
    }

    /// setPausedPosition
    pub fn set_paused_position(&self, shop: &str, object_id: &str, target: usize) -> bool {
        let downloads = layout::all(&self.db);
        let state = layout::sync(&self.db, &downloads);
        let id = format!("{shop}:{object_id}");
        if !layout::paused_in_order(&downloads, &state)
            .iter()
            .any(|d| layout::id(d) == id)
        {
            return false;
        }
        layout::set_queues(
            &self.db,
            &downloads,
            state.queue_order,
            layout::with_inserted_id(&state.paused_order, &id, Some(target)),
        );
        self.emit(Event::Updated);
        true
    }

    /// updateDownloadQueuePosition: one step up or down the queue.
    pub fn move_in_queue(&self, shop: &str, object_id: &str, up: bool) -> bool {
        let downloads = layout::all(&self.db);
        let state = layout::record(&self.db);
        let id = format!("{shop}:{object_id}");
        let queued = layout::queued_in_order(&downloads, &state);
        let Some(current) = queued.iter().position(|d| layout::id(d) == id) else {
            return false;
        };
        let target = if up {
            current.saturating_sub(1)
        } else {
            current + 1
        };
        if up && current == 0 {
            // targetIndex -1 clamps to the front in withInsertedId.
            return self.set_queue_position(shop, object_id, 0);
        }
        self.set_queue_position(shop, object_id, target)
    }
}
