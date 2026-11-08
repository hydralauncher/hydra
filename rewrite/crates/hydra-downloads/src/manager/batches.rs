//! download-manager.ts batches (JsBatchState): multi-part hoster downloads,
//! Real-Debrid and AllDebrid torrents and TorBox archives download their
//! files one after the other with one HTTP downloader; raw TorBox torrents
//! use the TorBox batch downloader. Also startHttpDownload and the batch
//! side of getDownloadStatusFromJs.

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use hydra_core::repacks::Downloader;
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use super::resolve::{
    JsOptions, PREPARED_TTL, assert_safe_batch_path, downloader_of, file_indices, log_url,
    parts_of, real_debrid_connections, resolve_part_filename, sanitize_relative_path, text,
};
use super::{Manager, Transfer};
use crate::batch::{self, DownloadFile, SpeedSample};
use crate::debrid::{
    self, all_debrid::AllDebrid, real_debrid::PreparedLink, real_debrid::RealDebrid, torbox::TorBox,
};
use crate::errors::{DlError, DlResult, key};
use crate::filename::{extract_download_filename, sanitize_filename};
use crate::http::{self, HttpDownloader, Phase};
use crate::layout::{self, Download};
use crate::range_state::{self, IdentityState};
use crate::torbox_batch::TorBoxBatch;

const TORBOX_MAX_PARALLEL_RANGES: u64 = 256;
const MIN_BATCH_COMPLETION_RATIO: f64 = 0.95;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Provider {
    AllDebrid,
    TorBox,
    RealDebrid,
    Hoster,
}

impl Provider {
    fn name(self) -> &'static str {
        match self {
            Provider::AllDebrid => "allDebrid",
            Provider::TorBox => "torBox",
            Provider::RealDebrid => "realDebrid",
            Provider::Hoster => "hoster",
        }
    }
}

/// JsBatchEntry
#[derive(Clone, Debug, Default)]
pub(crate) struct Entry {
    pub url: Option<String>,
    pub filename: String,
    pub size: Option<u64>,
    pub is_locked: bool,
    pub file_id: Option<i64>,
    pub is_zip: bool,
    pub resource_id: Option<String>,
    pub prepared_link: Option<PreparedLink>,
    pub file_index: Option<i64>,
    pub source_path: Option<String>,
    pub chunks: Option<u32>,
    pub headers: Vec<(String, String)>,
}

/// JsBatchState
pub(crate) struct BatchState {
    pub generation: u64,
    pub provider: Provider,
    /// Resolves each hoster part with the single-link options.
    pub hoster_download: Option<Download>,
    pub download_id: String,
    pub save_path: String,
    pub entries: Vec<Entry>,
    pub torrent_id: Option<i64>,
    pub source_uri: String,
    pub root_folder_name: Option<String>,
    pub current_index: usize,
    pub active_index: Option<usize>,
    pub completed_bytes: u64,
    pub total_bytes: u64,
    pub speed: SpeedSample,
}

pub(crate) type Batch = Arc<Mutex<BatchState>>;

fn lock(batch: &Batch) -> std::sync::MutexGuard<'_, BatchState> {
    batch.lock().unwrap_or_else(|e| e.into_inner())
}

impl BatchState {
    fn new(provider: Provider, download: &Download, id: &str, entries: Vec<Entry>) -> BatchState {
        BatchState {
            generation: 0,
            provider,
            hoster_download: None,
            download_id: id.to_string(),
            save_path: text(download, "downloadPath")
                .unwrap_or_default()
                .to_string(),
            entries,
            torrent_id: None,
            source_uri: text(download, "uri").unwrap_or_default().to_string(),
            root_folder_name: None,
            current_index: 0,
            active_index: None,
            completed_bytes: 0,
            total_bytes: 0,
            speed: SpeedSample::new(batch::now_ms(), None),
        }
    }

    /// getBatchResourceId
    fn resource_id(&self, entry: &Entry) -> String {
        entry.resource_id.clone().unwrap_or_else(|| {
            let identity = entry
                .file_id
                .or(entry.file_index)
                .map(|i| i.to_string())
                .or_else(|| entry.source_path.clone())
                .unwrap_or_else(|| entry.filename.clone());
            format!("{}:{}#{identity}", self.provider.name(), self.source_uri)
        })
    }

    /// estimateHosterPartsBytes
    fn estimate_hoster_bytes(&self) -> u64 {
        debrid::files::estimate_multipart_total_bytes(
            &self.entries.iter().map(|e| e.size).collect::<Vec<_>>(),
            self.hoster_download
                .as_ref()
                .and_then(|d| d.get("fileSize"))
                .and_then(Value::as_f64)
                .map(|s| s as u64),
        )
    }

    /// skipCompletedHosterParts: finished parts are skipped before their
    /// links resolve (the last part still runs, so the batch completes).
    fn skip_completed_hoster_parts(&mut self) {
        let files = self
            .hoster_download
            .as_ref()
            .map(batch::files_of)
            .unwrap_or_default();
        while self.current_index + 1 < self.entries.len() {
            let Some(file) = files.get(self.current_index).filter(|f| f.completed) else {
                break;
            };
            self.completed_bytes += file.size;
            self.current_index += 1;
        }
    }
}

/// assertUniqueHosterPartFilenames
fn assert_unique_filenames(entries: &[Entry]) -> DlResult<()> {
    let names: Vec<String> = entries
        .iter()
        .map(|e| e.filename.to_lowercase())
        .filter(|n| !n.is_empty())
        .collect();
    let unique: std::collections::HashSet<&String> = names.iter().collect();
    if unique.len() != names.len() {
        return Err(DlError::msg("Two download parts have the same file name."));
    }
    Ok(())
}

/// getBatchDownloadOptions (without the URL refresh).
fn entry_options(state: &BatchState, entry: &Entry, url: &str) -> http::Options {
    let provider = state.provider;
    let tor_box_parallel = provider == Provider::TorBox && !entry.is_zip;
    let resource = state.resource_id(entry);
    let filename = if provider == Provider::TorBox {
        entry.filename.clone()
    } else {
        sanitize_relative_path(&entry.filename)
    };
    let file_path = Path::new(&state.save_path).join(&entry.filename);
    let has_identity = || {
        range_state::read_identity(&file_path)
            .ok()
            .flatten()
            .is_some()
    };
    let mut options = http::Options::new(url, &state.save_path, Some(filename));
    options.headers = entry.headers.clone();
    options.allow_parallel_ranges = match provider {
        Provider::AllDebrid | Provider::Hoster => true,
        Provider::TorBox => !entry.is_zip,
        Provider::RealDebrid => {
            !entry.is_zip && !debrid::files::is_zip_download_url(url, Some(&entry.filename))
        }
    };
    if tor_box_parallel {
        options.parallel_range_size = Some(http::range_size_for_request_budget(
            entry.size.unwrap_or(0),
            TORBOX_MAX_PARALLEL_RANGES,
        ));
        options.max_parallel_ranges = Some(TORBOX_MAX_PARALLEL_RANGES as usize);
    }
    options.probe_unbounded_range = provider == Provider::RealDebrid;
    if provider == Provider::RealDebrid {
        options.parallel_range_connections = Some(real_debrid_connections(entry.chunks));
    }
    options.preserve_filename = true;
    // New hoster parts record their source before writing; legacy partials
    // stay unidentified.
    options.require_resource_identity = (provider == Provider::RealDebrid
        && (entry.is_zip || has_identity()))
        || (provider == Provider::Hoster && (!file_path.exists() || has_identity()));
    options.resource_id = Some(resource.clone());
    if matches!(provider, Provider::RealDebrid | Provider::Hoster) {
        options.before_complete = Some(Arc::new(move |file: &Path| {
            range_state::save_completed_identity(file, &resource)
        }));
    }
    if matches!(provider, Provider::TorBox | Provider::RealDebrid) && !entry.is_zip {
        options.expected_size = entry.size;
    }
    options.require_range_resume =
        provider == Provider::RealDebrid || (!entry.is_zip && provider == Provider::TorBox);
    // Verify saved bytes even for single-connection Real-Debrid files.
    options.verify_resume_prefix = provider == Provider::RealDebrid || entry.is_zip;
    options
}

impl Manager {
    // ---- startHttpDownload

    /// startHttpDownload: resolves the link(s) and starts the transfer.
    pub(crate) async fn start_http_download(
        self: &Arc<Self>,
        download: &mut Download,
        id: &str,
        generation: u64,
        signal: &CancellationToken,
    ) -> DlResult<()> {
        eprintln!("[DownloadManager] Using JS HTTP downloader");
        let prepared = self.take_prepared(download, id);
        let uri = text(download, "uri").unwrap_or_default().to_string();
        let downloader = downloader_of(download);
        let is_batch = parts_of(download).is_some()
            || matches!(downloader, Some(Downloader::AllDebrid | Downloader::TorBox))
            || (downloader == Some(Downloader::RealDebrid) && uri.starts_with("magnet:"));
        if is_batch {
            self.start_batch_download(download, id, generation, signal, prepared)
                .await
        } else {
            self.start_single_download(download, id, generation, signal, prepared)
                .await
        }
    }

    /// isCurrentStart
    pub(crate) fn is_current_start(
        &self,
        id: &str,
        generation: u64,
        signal: &CancellationToken,
    ) -> bool {
        let core = self.core();
        !signal.is_cancelled()
            && core.downloading_id.as_deref() == Some(id)
            && core.generation == generation
    }

    /// startSingleJsDownload
    async fn start_single_download(
        self: &Arc<Self>,
        download: &mut Download,
        id: &str,
        generation: u64,
        signal: &CancellationToken,
        prepared: Option<JsOptions>,
    ) -> DlResult<()> {
        let options = match prepared {
            Some(options) => options,
            None => debrid::guarded(Some(signal), self.js_options(download, Some(signal)))
                .await?
                .ok_or_else(|| DlError::msg("Failed to get download options for JS downloader"))?,
        };
        if !self.is_current_start(id, generation, signal) {
            eprintln!(
                "[DownloadManager] Download was superseded during preparation; aborting start"
            );
            return Ok(());
        }
        let http = HttpDownloader::new();
        {
            let mut core = self.core();
            http.set_max_download_speed(core.speed_limit);
            core.http = Some(Transfer::Http(http.clone()));
            core.batch = None;
            core.preparing = false;
        }
        log_url(&options.url);
        let options = options.to_http(text(download, "uri").map(str::to_string));
        let (this, id) = (self.clone(), id.to_string());
        tokio::spawn(async move {
            if let Err(error) = http.start(options).await {
                // handleRuntimeDownloadError touches the DB: off the runtime.
                std::thread::spawn(move || this.handle_runtime_error(&id, &error, generation));
            }
        });
        Ok(())
    }

    // ---- startBatchDownload

    async fn start_batch_download(
        self: &Arc<Self>,
        download: &mut Download,
        id: &str,
        generation: u64,
        signal: &CancellationToken,
        prepared: Option<JsOptions>,
    ) -> DlResult<()> {
        let state = if parts_of(download).is_some() {
            self.prepare_hoster_parts(download, id, prepared, signal)
                .await?
        } else {
            match downloader_of(download) {
                Some(Downloader::TorBox) => self.prepare_torbox_batch(download, id).await?,
                Some(Downloader::AllDebrid) => self.prepare_all_debrid_batch(download, id).await?,
                _ => {
                    self.prepare_real_debrid_batch(download, id, generation, signal)
                        .await?
                }
            }
        };
        if !self.is_current_start(id, generation, signal) {
            eprintln!(
                "[DownloadManager] Download was superseded during preparation; aborting start"
            );
            return Ok(());
        }
        if matches!(state.provider, Provider::TorBox | Provider::Hoster) {
            let Some(mut record) = layout::get(&self.db, id) else {
                return Ok(());
            };
            if signal.is_cancelled() || self.core().generation != generation {
                return Ok(());
            }
            if let Some(files) = download.get("files") {
                record.insert("files".into(), files.clone());
            }
            if state.provider == Provider::Hoster {
                record.insert(
                    "folderName".into(),
                    state
                        .root_folder_name
                        .clone()
                        .map_or(Value::Null, Value::from),
                );
            }
            layout::put(&self.db, &record);
            if signal.is_cancelled() || self.core().generation != generation {
                return Ok(());
            }
        }
        if state.provider == Provider::TorBox && state.entries.iter().all(|e| !e.is_zip) {
            return self.start_torbox_files(download, state, generation);
        }
        let mut state = state;
        state.generation = generation;
        let http = HttpDownloader::new();
        let batch: Batch = Arc::new(Mutex::new(state));
        {
            let mut core = self.core();
            http.set_max_download_speed(core.speed_limit);
            core.batch = Some(batch.clone());
            core.http = Some(Transfer::Http(http));
            core.preparing = false;
        }
        let this = self.clone();
        tokio::spawn(async move { this.run_batch().await });
        Ok(())
    }

    /// startTorBoxFiles
    fn start_torbox_files(
        self: &Arc<Self>,
        download: &Download,
        state: BatchState,
        generation: u64,
    ) -> DlResult<()> {
        let token = self
            .tokens()
            .torbox
            .ok_or_else(|| DlError::msg(key::TORBOX_ACCOUNT_NOT_AUTHORIZED))?;
        let folder = state
            .root_folder_name
            .clone()
            .or_else(|| state.entries.first().map(|e| e.filename.clone()))
            .unwrap_or_default();
        let torrent_id = state.torrent_id.unwrap_or(-1);
        let file_ids: Vec<i64> = state
            .entries
            .iter()
            .map(|e| e.file_id.unwrap_or(-1))
            .collect();
        let state = Arc::new(state);
        let options_state = state.clone();
        let downloader = TorBoxBatch::new(
            batch::files_of(download),
            folder,
            Arc::new(move |index, signal| {
                let token = token.clone();
                let file_id = file_ids.get(index).copied().unwrap_or(-1);
                Box::pin(async move {
                    TorBox::new(&token)
                        .request_link(torrent_id, file_id, Some(&signal))
                        .await
                })
            }),
            Arc::new(move |index, url| {
                let entry = options_state
                    .entries
                    .get(index)
                    .ok_or_else(|| DlError::msg("The TorBox file selection is incomplete."))?;
                assert_safe_batch_path(&options_state.save_path, &entry.filename)?;
                Ok(entry_options(&options_state, entry, &url))
            }),
        )?;
        {
            let mut core = self.core();
            downloader.set_max_download_speed(core.speed_limit);
            core.batch = None;
            core.http = Some(Transfer::TorBox(downloader.clone()));
            core.preparing = false;
        }
        let (this, id) = (self.clone(), state.download_id.clone());
        tokio::spawn(async move {
            let Err(error) = downloader.start().await else {
                return;
            };
            let current = |this: &Manager| {
                let core = this.core();
                core.generation == generation
                    && matches!(core.http.as_ref(), Some(Transfer::TorBox(d)) if d.same(&downloader))
            };
            if !current(&this) {
                return;
            }
            std::thread::spawn(move || {
                if let Err(persist) = this.persist_paused_js_progress(&id, generation) {
                    eprintln!("[DownloadManager] Failed to save batch progress: {persist}");
                }
                this.handle_runtime_error(&id, &error.message(), generation);
            });
        });
        Ok(())
    }

    // ---- preparation per provider

    /// prepareHosterPartsBatch
    async fn prepare_hoster_parts(
        &self,
        download: &mut Download,
        id: &str,
        prepared: Option<JsOptions>,
        signal: &CancellationToken,
    ) -> DlResult<BatchState> {
        crate::hosters::assert_multipart_enabled(&self.hosters).await?;
        let parts = parts_of(download).unwrap_or_default();
        let saved: std::collections::HashMap<i64, String> = batch::files_of(download)
            .into_iter()
            .map(|f| (f.index, f.path))
            .collect();
        let hints: Vec<Option<String>> = parts
            .iter()
            .map(|uri| extract_download_filename(uri, None))
            .collect();
        let mut first_options = prepared;
        let mut first_filename = hints.first().cloned().flatten();
        let mut root = text(download, "folderName").map(str::to_string);
        if root.is_none() {
            if first_filename.is_none() && first_options.is_none() {
                let mut fresh = download.clone();
                fresh.insert("folderName".into(), Value::Null);
                first_options =
                    debrid::guarded(Some(signal), self.js_options(&mut fresh, Some(signal)))
                        .await?;
            }
            if first_filename.is_none()
                && let Some(options) = first_options.as_ref()
            {
                first_filename = resolve_part_filename(options).await;
            }
            let name = first_filename
                .clone()
                .ok_or_else(|| DlError::msg("The first download part has no file name."))?;
            root = Some(sanitize_filename(&debrid::files::multipart_folder_name(
                &name,
            )));
        }
        let root = root.unwrap_or_default();
        let mut entries: Vec<Entry> = parts
            .iter()
            .enumerate()
            .map(|(index, uri)| Entry {
                url: Some(uri.clone()),
                filename: saved
                    .get(&(index as i64))
                    .filter(|p| !p.is_empty())
                    .cloned()
                    .or_else(|| {
                        hints[index]
                            .as_ref()
                            .map(|hint| format!("{root}/{}", sanitize_filename(hint)))
                    })
                    .unwrap_or_default(),
                file_index: Some(index as i64),
                resource_id: Some(uri.clone()),
                ..Entry::default()
            })
            .collect();
        if let (Some(options), Some(first)) = (first_options.as_ref(), entries.first_mut()) {
            first.prepared_link = Some(PreparedLink {
                url: options.url.clone(),
                resolved_at: Instant::now(),
            });
            first.headers = options.headers.clone();
            if first.filename.is_empty() {
                if first_filename.is_none() {
                    first_filename = resolve_part_filename(options).await;
                }
                if let Some(name) = first_filename.as_ref() {
                    first.filename = format!("{root}/{}", sanitize_filename(name));
                }
            }
        }
        assert_unique_filenames(&entries)?;
        let mut state = BatchState::new(Provider::Hoster, download, id, entries);
        state.root_folder_name = Some(root);
        self.restore_hoster_parts_progress(download, &mut state)?;
        Ok(state)
    }

    /// restoreHosterPartsProgress: a part counts as done only with a
    /// completion receipt for its own link.
    fn restore_hoster_parts_progress(
        &self,
        download: &mut Download,
        state: &mut BatchState,
    ) -> DlResult<()> {
        let previous: std::collections::HashMap<i64, u64> = batch::files_of(download)
            .into_iter()
            .map(|f| (f.index, f.size))
            .collect();
        let mut files = Vec::with_capacity(state.entries.len());
        for index in 0..state.entries.len() {
            let mut file = DownloadFile {
                index: index as i64,
                path: state.entries[index].filename.clone(),
                size: previous.get(&(index as i64)).copied().unwrap_or(0),
                bytes_downloaded: 0,
                completed: false,
            };
            if file.size > 0 {
                state.entries[index].size = Some(file.size);
            }
            if !state.entries[index].filename.is_empty() {
                assert_safe_batch_path(&state.save_path, &state.entries[index].filename)?;
                let path = Path::new(&state.save_path).join(&state.entries[index].filename);
                if path.exists() {
                    file.bytes_downloaded =
                        range_state::downloaded_bytes(&path).map_err(DlError::msg)?;
                    let resource = state.resource_id(&state.entries[index]);
                    match range_state::identity_state(&path, &resource).map_err(DlError::msg)? {
                        IdentityState::Changed => {
                            return Err(DlError::msg(
                                "The completed download file changed. Keeping the saved file.",
                            ));
                        }
                        IdentityState::Complete => {
                            file.size = file.bytes_downloaded;
                            file.completed = true;
                            state.entries[index].size = Some(file.size);
                        }
                        _ => {}
                    }
                }
            }
            files.push(file);
        }
        download.insert("files".into(), batch::files_json(&files));
        state.hoster_download = Some(download.clone());
        state.skip_completed_hoster_parts();
        state.total_bytes = state.estimate_hoster_bytes();
        Ok(())
    }

    /// prepareTorBoxBatch
    async fn prepare_torbox_batch(
        &self,
        download: &mut Download,
        id: &str,
    ) -> DlResult<BatchState> {
        let (manifest, selected) = self.prepare_torbox_files(download).await?;
        let entries = selected
            .iter()
            .map(|f| Entry {
                file_id: Some(f.id),
                filename: f.path.clone(),
                size: Some(f.size),
                is_zip: manifest.archive_only,
                ..Entry::default()
            })
            .collect();
        let mut state = BatchState::new(Provider::TorBox, download, id, entries);
        state.torrent_id = Some(manifest.torrent_id);
        state.root_folder_name = if selected.len() == 1 && !selected[0].path.contains('/') {
            None
        } else {
            Some(manifest.name.clone())
        };
        state.total_bytes = selected.iter().map(|f| f.size).sum();
        if manifest.archive_only {
            // Completed earlier files need no new expiring TorBox link on resume.
            while state.current_index + 1 < state.entries.len() {
                let entry = &state.entries[state.current_index];
                assert_safe_batch_path(&state.save_path, &entry.filename)?;
                let path = Path::new(&state.save_path).join(&entry.filename);
                let Ok(meta) = std::fs::metadata(&path) else {
                    break;
                };
                let ranges = range_state::read(&path).map_err(DlError::msg)?;
                if !meta.is_file()
                    || Some(meta.len()) != entry.size
                    || ranges.is_some_and(|r| range_state::saved_bytes(&r) != r.total)
                {
                    break;
                }
                state.completed_bytes += entry.size.unwrap_or(0);
                state.current_index += 1;
            }
        }
        Ok(state)
    }

    /// prepareAllDebridBatch
    async fn prepare_all_debrid_batch(
        &self,
        download: &mut Download,
        id: &str,
    ) -> DlResult<BatchState> {
        let token = self
            .tokens()
            .all_debrid
            .ok_or_else(|| DlError::msg(key::ALLDEBRID_ACCOUNT_NOT_AUTHORIZED))?;
        let uri = text(download, "uri").unwrap_or_default().to_string();
        let entries = AllDebrid::new(&token)
            .download_entries(&uri)
            .await?
            .filter(|e| !e.is_empty())
            .ok_or_else(|| DlError::msg(key::NOT_CACHED_ON_ALLDEBRID))?;
        let all_sized = entries.iter().all(|e| e.size.is_some());
        let total = entries.iter().filter_map(|e| e.size).sum();
        let entries = entries
            .into_iter()
            .map(|e| Entry {
                url: Some(e.url),
                filename: sanitize_relative_path(&e.filename),
                size: e.size,
                is_locked: e.is_locked,
                ..Entry::default()
            })
            .collect();
        let mut state = BatchState::new(Provider::AllDebrid, download, id, entries);
        state.total_bytes = if all_sized { total } else { 0 };
        Ok(state)
    }

    /// resolvePreparedRealDebridEntries
    async fn resolve_prepared_rd_entries(
        &self,
        download: &mut Download,
        id: &str,
        generation: u64,
        signal: &CancellationToken,
    ) -> DlResult<Option<Vec<debrid::real_debrid::Entry>>> {
        let uri = text(download, "uri").unwrap_or_default().to_string();
        let indices = file_indices(download);
        let selection = serde_json::to_string(&indices).unwrap_or_default();
        let torrent = text(download, "realDebridTorrentId").map(str::to_string);
        let prepared = self.prepared_rd().remove(id);
        let resolved = match prepared {
            Some(p)
                if p.uri == uri
                    && p.selection == selection
                    && p.resolved.torrent_id == torrent
                    && p.resolved_at.elapsed() < PREPARED_TTL =>
            {
                p.resolved
            }
            _ => {
                let token = self
                    .tokens()
                    .real_debrid
                    .ok_or_else(|| DlError::msg(key::REAL_DEBRID_ACCOUNT_NOT_AUTHORIZED))?;
                RealDebrid::new(&token)
                    .download_entries(&uri, indices.as_deref(), torrent.as_deref(), Some(signal))
                    .await?
            }
        };
        debrid::check(Some(signal))?;
        if let Some(found) = resolved.torrent_id.as_ref()
            && Some(found) != torrent.as_ref()
            && self.is_current_start(id, generation, signal)
        {
            download.insert("realDebridTorrentId".into(), json!(found));
            layout::put(&self.db, download);
        }
        Ok(resolved.entries)
    }

    /// prepareRealDebridBatch
    async fn prepare_real_debrid_batch(
        &self,
        download: &mut Download,
        id: &str,
        generation: u64,
        signal: &CancellationToken,
    ) -> DlResult<BatchState> {
        let entries = self
            .resolve_prepared_rd_entries(download, id, generation, signal)
            .await?
            .filter(|e| !e.is_empty())
            .ok_or_else(|| DlError::msg(key::NOT_CACHED_ON_REAL_DEBRID))?;
        let count = entries.len();
        let mut batch_entries = Vec::with_capacity(count);
        for entry in &entries {
            let output = self.debrid_output_path(download, entry.index, &entry.path, count)?;
            batch_entries.push(Entry {
                url: Some(entry.url.clone()),
                filename: sanitize_relative_path(&output),
                size: Some(entry.size),
                is_zip: entry.is_archive,
                resource_id: entry.resource_id.clone(),
                prepared_link: entry.prepared_link.clone(),
                is_locked: entry.is_locked,
                file_index: Some(entry.index),
                source_path: entry
                    .source_path
                    .clone()
                    .or_else(|| Some(entry.path.clone())),
                chunks: entry.chunks,
                ..Entry::default()
            });
        }
        let mut state = BatchState::new(Provider::RealDebrid, download, id, batch_entries);
        state.root_folder_name = debrid::files::root_folder_name(
            &entries
                .iter()
                .map(|e| sanitize_relative_path(&e.path))
                .collect::<Vec<_>>(),
        );
        state.total_bytes = entries.iter().map(|e| e.size).sum();
        // restoreRealDebridBatchProgress
        let local = self.read_local_file_progress(
            &state.save_path,
            &state
                .entries
                .iter()
                .map(|e| {
                    (
                        e.file_index.unwrap_or(0),
                        e.filename.clone(),
                        e.size.unwrap_or(0),
                    )
                })
                .collect::<Vec<_>>(),
        )?;
        let mut files = Vec::with_capacity(local.len());
        for (index, mut file) in local.into_iter().enumerate() {
            if file.completed {
                let path = Path::new(&state.save_path).join(&file.path);
                let resource = state.resource_id(&state.entries[index]);
                let identity =
                    range_state::identity_state(&path, &resource).map_err(DlError::msg)?;
                if identity == IdentityState::Changed {
                    return Err(DlError::msg(
                        "The completed download file changed. Keeping the saved file.",
                    ));
                }
                // Without a matching receipt, the downloader verifies the saved bytes.
                file.completed = identity == IdentityState::Complete;
            }
            files.push(file);
        }
        while state.current_index + 1 < state.entries.len() {
            let Some(file) = files.get(state.current_index).filter(|f| f.completed) else {
                break;
            };
            state.completed_bytes += file.size;
            state.current_index += 1;
        }
        download.insert("files".into(), batch::files_json(&files));
        Ok(state)
    }

    // ---- running a batch

    /// isCurrentBatch
    fn is_current_batch(
        &self,
        batch: &Batch,
        downloader: &HttpDownloader,
        generation: u64,
    ) -> bool {
        let core = self.core();
        let download_id = lock(batch).download_id.clone();
        core.batch.as_ref().is_some_and(|b| Arc::ptr_eq(b, batch))
            && matches!(core.http.as_ref(), Some(Transfer::Http(h)) if h.same(downloader))
            && core.generation == generation
            && core.downloading_id.as_deref() == Some(download_id.as_str())
    }

    /// runJsBatch
    async fn run_batch(self: Arc<Self>) {
        loop {
            let (batch, downloader) = {
                let core = self.core();
                match (core.batch.clone(), core.http.clone()) {
                    (Some(batch), Some(Transfer::Http(http))) => (batch, http),
                    _ => return,
                }
            };
            let index = {
                let mut state = lock(&batch);
                if state.provider == Provider::Hoster {
                    state.skip_completed_hoster_parts();
                }
                if state.current_index >= state.entries.len() {
                    return;
                }
                state.current_index
            };
            if !self.run_batch_entry(&batch, &downloader, index).await {
                return;
            }
        }
    }

    /// runJsBatchEntry: true when the entry finished and was banked.
    async fn run_batch_entry(
        self: &Arc<Self>,
        batch: &Batch,
        downloader: &HttpDownloader,
        index: usize,
    ) -> bool {
        let generation = lock(batch).generation;
        let result = async {
            if !self.is_current_batch(batch, downloader, generation) {
                return Ok(false);
            }
            let (provider, entry) = {
                let state = lock(batch);
                (state.provider, state.entries[index].clone())
            };
            let url = if matches!(provider, Provider::TorBox | Provider::RealDebrid)
                && !entry.is_zip
                && entry.size == Some(0)
            {
                "about:blank".to_string()
            } else {
                self.resolve_batch_entry_url(batch, index, true).await?
            };
            if !self.is_current_batch(batch, downloader, generation) {
                return Ok(false);
            }
            if url.is_empty() {
                return Err(DlError::msg("The download link is unavailable."));
            }
            // batch_refresh locks the batch itself: build it outside the lock.
            let refresh = self.batch_refresh(batch, index);
            let options = {
                let mut state = lock(batch);
                state.active_index = Some(state.current_index);
                let entry = state.entries[index].clone();
                let mut options = entry_options(&state, &entry, &url);
                options.refresh_url = refresh;
                options
            };
            log_url(&options.url);
            downloader.start(options).await.map_err(DlError::msg)?;
            if !self.is_current_batch(batch, downloader, generation) {
                return Ok(false);
            }
            let Some(status) = downloader.status() else {
                return Ok(false);
            };
            if matches!(status.phase, Phase::Paused | Phase::Error) {
                return Ok(false);
            }
            if self
                .reject_mismatched_entry(batch, downloader, index, &status)
                .await
            {
                return Ok(false);
            }
            bank_entry(&mut lock(batch), index, &status);
            Ok(true)
        }
        .await;
        match result {
            Ok(done) => done,
            Err(error) => {
                self.fail_batch_entry(batch, downloader, generation, error)
                    .await;
                false
            }
        }
    }

    /// getBatchUrlRefresh
    fn batch_refresh(self: &Arc<Self>, batch: &Batch, index: usize) -> Option<http::RefreshUrl> {
        let (provider, entry, torrent_id) = {
            let state = lock(batch);
            (
                state.provider,
                state.entries[index].clone(),
                state.torrent_id,
            )
        };
        let runtime = tokio::runtime::Handle::current();
        let (this, batch) = (self.clone(), batch.clone());
        match provider {
            Provider::Hoster => Some(Arc::new(move || {
                runtime
                    .block_on(this.resolve_hoster_part_url(&batch, index, false))
                    .map_err(|e| e.message())
            })),
            Provider::TorBox => {
                let (torrent, file) = (torrent_id?, entry.file_id?);
                let token = this.tokens().torbox?;
                Some(Arc::new(move || {
                    runtime
                        .block_on(TorBox::new(&token).request_link(torrent, file, None))
                        .map_err(|e| e.message())
                }))
            }
            Provider::RealDebrid if entry.url.is_some() => Some(Arc::new(move || {
                runtime
                    .block_on(this.resolve_batch_entry_url(&batch, index, false))
                    .map_err(|e| e.message())
                    .and_then(|link| {
                        if link.is_empty() {
                            Err("The download link is unavailable.".to_string())
                        } else {
                            Ok(link)
                        }
                    })
            })),
            _ => None,
        }
    }

    /// resolveBatchEntryUrl
    async fn resolve_batch_entry_url(
        &self,
        batch: &Batch,
        index: usize,
        reuse_prepared: bool,
    ) -> DlResult<String> {
        let (provider, save_path, torrent_id) = {
            let state = lock(batch);
            (state.provider, state.save_path.clone(), state.torrent_id)
        };
        if provider == Provider::Hoster {
            return self
                .resolve_hoster_part_url(batch, index, reuse_prepared)
                .await;
        }
        let (entry, prepared) = {
            let mut state = lock(batch);
            let prepared = state.entries[index].prepared_link.take();
            (state.entries[index].clone(), prepared)
        };
        assert_safe_batch_path(&save_path, &entry.filename)?;
        let url = entry.url.clone().unwrap_or_default();
        match provider {
            Provider::TorBox => {
                let (Some(torrent), Some(file)) = (torrent_id, entry.file_id) else {
                    return Err(DlError::msg("The TorBox file selection is incomplete."));
                };
                let token = self
                    .tokens()
                    .torbox
                    .ok_or_else(|| DlError::msg(key::TORBOX_ACCOUNT_NOT_AUTHORIZED))?;
                TorBox::new(&token).request_link(torrent, file, None).await
            }
            Provider::RealDebrid if entry.is_locked && !url.is_empty() => {
                if reuse_prepared
                    && let Some(prepared) =
                        prepared.filter(|p| p.resolved_at.elapsed() < PREPARED_TTL)
                {
                    return Ok(prepared.url);
                }
                let token = self
                    .tokens()
                    .real_debrid
                    .ok_or_else(|| DlError::msg(key::REAL_DEBRID_ACCOUNT_NOT_AUTHORIZED))?;
                let signal = self.core().preparation.clone();
                let expected = entry
                    .source_path
                    .clone()
                    .unwrap_or_else(|| entry.filename.clone());
                let size = if entry.is_zip {
                    0
                } else {
                    entry.size.unwrap_or(0)
                };
                let (link, chunks) = RealDebrid::new(&token)
                    .unlock_file(&url, &expected, size, signal.as_ref())
                    .await?;
                lock(batch).entries[index].chunks = chunks;
                Ok(link)
            }
            Provider::AllDebrid if entry.is_locked && !url.is_empty() => {
                let token = self
                    .tokens()
                    .all_debrid
                    .ok_or_else(|| DlError::msg(key::ALLDEBRID_ACCOUNT_NOT_AUTHORIZED))?;
                AllDebrid::new(&token).unlock_download_link(&url).await
            }
            _ => Ok(url),
        }
    }

    /// resolveHosterPartUrl: the part's own link through its hoster.
    async fn resolve_hoster_part_url(
        &self,
        batch: &Batch,
        index: usize,
        reuse_prepared: bool,
    ) -> DlResult<String> {
        let (prepared, hoster, url, has_name) = {
            let mut state = lock(batch);
            let prepared = state.entries[index].prepared_link.take();
            (
                prepared,
                state.hoster_download.clone().unwrap_or_default(),
                state.entries[index].url.clone().unwrap_or_default(),
                !state.entries[index].filename.is_empty(),
            )
        };
        let fresh = prepared.filter(|p| reuse_prepared && p.resolved_at.elapsed() < PREPARED_TTL);
        if let Some(prepared) = fresh {
            self.assign_hoster_part_filename(batch, index, None)?;
            return Ok(prepared.url);
        }
        let mut part = hoster;
        part.insert("uri".into(), json!(url));
        part.insert("folderName".into(), Value::Null);
        let options = self
            .js_options(&mut part, None)
            .await?
            .ok_or_else(|| DlError::msg("The download link is unavailable."))?;
        lock(batch).entries[index].headers = options.headers.clone();
        let resolved = if has_name {
            None
        } else {
            resolve_part_filename(&options).await
        };
        self.assign_hoster_part_filename(batch, index, resolved)?;
        Ok(options.url)
    }

    /// assignHosterPartFilename: parts without a name take the resolved one.
    fn assign_hoster_part_filename(
        &self,
        batch: &Batch,
        index: usize,
        resolved: Option<String>,
    ) -> DlResult<()> {
        let mut state = lock(batch);
        if state.entries[index].filename.is_empty() {
            let name = resolved.ok_or_else(|| DlError::msg("A download part has no file name."))?;
            let root = state.root_folder_name.clone().unwrap_or_default();
            state.entries[index].filename = format!("{root}/{}", sanitize_filename(&name));
            assert_unique_filenames(&state.entries)?;
        }
        assert_safe_batch_path(&state.save_path, &state.entries[index].filename)
    }

    /// rejectMismatchedBatchEntry: a short file means the link served an
    /// error page.
    async fn reject_mismatched_entry(
        self: &Arc<Self>,
        batch: &Batch,
        downloader: &HttpDownloader,
        index: usize,
        status: &http::Status,
    ) -> bool {
        let (provider, entry, generation, id, current) = {
            let state = lock(batch);
            (
                state.provider,
                state.entries[index].clone(),
                state.generation,
                state.download_id.clone(),
                state.current_index,
            )
        };
        let expected = entry.size.unwrap_or(0);
        let exact = matches!(provider, Provider::TorBox | Provider::RealDebrid);
        let mismatch = !entry.is_zip
            && if exact {
                status.bytes_downloaded != expected
            } else {
                expected > 0
                    && (status.bytes_downloaded as f64)
                        < expected as f64 * MIN_BATCH_COMPLETION_RATIO
            };
        if !mismatch {
            return false;
        }
        eprintln!(
            "[DownloadManager] {} batch entry {current} size mismatch: downloaded={} expected={expected}. The download URL may have returned an error page.",
            provider.name(),
            status.bytes_downloaded
        );
        if !self.is_current_batch(batch, downloader, generation) {
            return true;
        }
        if !self.cleanup_batch(batch, downloader, generation).await {
            return true;
        }
        let this = self.clone();
        std::thread::spawn(move || {
            this.handle_runtime_error(
                &id,
                "A downloaded file returned fewer bytes than expected. Its link may have expired.",
                generation,
            )
        });
        true
    }

    /// failJsBatchEntry
    async fn fail_batch_entry(
        self: &Arc<Self>,
        batch: &Batch,
        downloader: &HttpDownloader,
        generation: u64,
        error: DlError,
    ) {
        if !self.is_current_batch(batch, downloader, generation) {
            return;
        }
        let (provider, id) = {
            let state = lock(batch);
            (state.provider, state.download_id.clone())
        };
        eprintln!(
            "[DownloadManager] {} batch entry error: {error}",
            provider.name()
        );
        if let Some(mut download) = layout::get(&self.db, &id)
            && let Some((updated, _)) = self.js_progress(&id, &download)
        {
            for key in ["bytesDownloaded", "progress", "fileSize", "folderName"] {
                if let Some(value) = updated.get(key) {
                    download.insert(key.into(), value.clone());
                }
            }
            if !self.is_current_batch(batch, downloader, generation) {
                return;
            }
            layout::put(&self.db, &download);
        }
        if !self.cleanup_batch(batch, downloader, generation).await {
            return;
        }
        let this = self.clone();
        std::thread::spawn(move || this.handle_runtime_error(&id, &error.message(), generation));
    }

    /// cleanupBatch: a failed request keeps the saved bytes.
    async fn cleanup_batch(
        &self,
        batch: &Batch,
        downloader: &HttpDownloader,
        generation: u64,
    ) -> bool {
        if !self.is_current_batch(batch, downloader, generation) {
            return false;
        }
        downloader.wait_for_idle().await;
        if !self.is_current_batch(batch, downloader, generation) {
            return false;
        }
        downloader.cancel(false);
        let mut core = self.core();
        core.http = None;
        core.batch = None;
        core.downloading_id = None;
        core.preparing = false;
        true
    }

    // ---- getDownloadStatusFromJs

    /// The record updated from the transfer, and the packet's numbers:
    /// (download, speed, is_reconnecting, is_recovering, recovery, phase).
    pub(crate) fn js_progress(
        &self,
        id: &str,
        download: &Download,
    ) -> Option<(Download, JsProgress)> {
        let (transfer, batch) = {
            let core = self.core();
            if core.downloading_id.as_deref() != Some(id) {
                return None;
            }
            (core.http.clone()?, core.batch.clone())
        };
        let status = transfer.status()?;
        let mut progress = status.progress;
        let mut bytes = status.bytes_downloaded;
        let mut file_size = status.file_size;
        let mut folder = status.folder_name.clone();
        let mut speed = status.download_speed;
        let mut phase = status.phase;
        let mut files = match &transfer {
            Transfer::TorBox(d) => Some(batch::files_json(&d.files())),
            Transfer::Http(_) => download.get("files").cloned(),
        };
        if let Some(batch) = batch.as_ref() {
            let mut state = lock(batch);
            if state.download_id == id {
                let done = state.current_index >= state.entries.len() && phase == Phase::Complete;
                if state.provider == Provider::Hoster {
                    if let Some(active) = state.active_index
                        && active == state.current_index
                        && status.file_size > 0
                        && let Some(entry) = state.entries.get_mut(active)
                    {
                        entry.size = Some(status.file_size);
                    }
                    state.total_bytes = state.estimate_hoster_bytes();
                }
                if matches!(
                    state.provider,
                    Provider::TorBox | Provider::RealDebrid | Provider::Hoster
                ) {
                    let previous = batch::files_of(download);
                    let list: Vec<DownloadFile> = state
                        .entries
                        .iter()
                        .enumerate()
                        .map(|(index, entry)| {
                            let file_index =
                                entry.file_id.or(entry.file_index).unwrap_or(index as i64);
                            let completed = index < state.current_index;
                            let mut entry_bytes = previous
                                .iter()
                                .find(|f| f.index == file_index)
                                .map_or(0, |f| f.bytes_downloaded);
                            if completed {
                                entry_bytes = entry.size.unwrap_or(0);
                            } else if Some(index) == state.active_index {
                                entry_bytes = status.bytes_downloaded;
                            }
                            DownloadFile {
                                index: file_index,
                                path: entry.filename.clone(),
                                size: entry.size.unwrap_or(0),
                                bytes_downloaded: entry_bytes,
                                completed,
                            }
                        })
                        .collect();
                    files = Some(batch::files_json(&list));
                }
                if done {
                    progress = 1.0;
                    bytes = state.completed_bytes;
                    file_size = state.total_bytes;
                    if let Some(root) = state.root_folder_name.clone() {
                        folder = root;
                    }
                } else {
                    if phase == Phase::Complete {
                        phase = Phase::Active;
                    }
                    let (current_bytes, batch_progress) = batch::batch_progress(
                        state.current_index,
                        state.active_index,
                        state.completed_bytes,
                        state.total_bytes,
                        state.entries.len(),
                        status.bytes_downloaded,
                        status.progress,
                    );
                    progress = batch_progress;
                    bytes = state.completed_bytes + current_bytes;
                    if state.total_bytes > 0 {
                        file_size = state.total_bytes;
                    }
                    folder = state
                        .root_folder_name
                        .clone()
                        .or_else(|| {
                            state
                                .entries
                                .get(state.current_index)
                                .map(|e| e.filename.clone())
                        })
                        .unwrap_or(folder);
                    state.speed = batch::sample_speed(
                        state.speed,
                        bytes,
                        if status.is_recovering {
                            0.0
                        } else {
                            status.download_speed
                        },
                        batch::now_ms(),
                    );
                    speed = state.speed.speed;
                }
            }
        }
        let progress = progress.clamp(0.0, 1.0);
        let effective_size = if file_size > 0 {
            Some(file_size as f64)
        } else {
            download.get("fileSize").and_then(Value::as_f64)
        };
        let mut updated = download.clone();
        if let Some(files) = files {
            updated.insert("files".into(), files);
        }
        updated.insert("bytesDownloaded".into(), json!(bytes));
        updated.insert(
            "fileSize".into(),
            effective_size.map_or(Value::Null, |s| json!(s as u64)),
        );
        updated.insert("progress".into(), json!(progress));
        updated.insert("folderName".into(), json!(folder));
        updated.insert(
            "status".into(),
            json!(if phase == Phase::Complete {
                "complete"
            } else {
                "active"
            }),
        );
        Some((
            updated,
            JsProgress {
                speed,
                phase,
                file_size: effective_size,
                bytes,
                is_reconnecting: status.is_reconnecting,
                is_recovering: status.is_recovering,
                recovery_progress: status.recovery_progress,
            },
        ))
    }

    /// persistPausedJsProgress
    pub(crate) fn persist_paused_js_progress(
        &self,
        id: &str,
        generation: u64,
    ) -> Result<(), String> {
        if self.core().generation != generation {
            return Ok(());
        }
        let Some(mut download) = layout::get(&self.db, id) else {
            return Ok(());
        };
        let Some((updated, _)) = self.js_progress(id, &download) else {
            return Ok(());
        };
        for key in [
            "bytesDownloaded",
            "progress",
            "files",
            "folderName",
            "fileSize",
        ] {
            if let Some(value) = updated.get(key) {
                download.insert(key.into(), value.clone());
            }
        }
        layout::put(&self.db, &download);
        Ok(())
    }

    /// requiresPauseConfirmation: pausing a TorBox ZIP that can't resume
    /// starts it over.
    pub fn requires_pause_confirmation(&self, id: &str) -> bool {
        let core = self.core();
        if core.downloading_id.as_deref() != Some(id) {
            return false;
        }
        let (Some(batch), Some(transfer)) = (core.batch.as_ref(), core.http.as_ref()) else {
            return false;
        };
        let state = lock(batch);
        state.provider == Provider::TorBox
            && state
                .entries
                .get(state.current_index)
                .is_some_and(|e| e.is_zip)
            && transfer
                .status()
                .is_some_and(|s| s.resume_capability == http::ResumeCapability::Unsupported)
    }
}

/// The numbers getDownloadStatusFromJs adds to the packet.
pub(crate) struct JsProgress {
    pub speed: f64,
    pub phase: Phase,
    pub file_size: Option<f64>,
    pub bytes: u64,
    pub is_reconnecting: bool,
    pub is_recovering: bool,
    pub recovery_progress: f64,
}

/// bankCompletedBatchEntry
fn bank_entry(state: &mut BatchState, index: usize, status: &http::Status) {
    if state.provider == Provider::Hoster {
        state.entries[index].size = Some(status.bytes_downloaded);
        state.completed_bytes += status.bytes_downloaded;
        state.current_index += 1;
        state.total_bytes = state.estimate_hoster_bytes();
        return;
    }
    let expected = state.entries[index].size.unwrap_or(0);
    if state.entries[index].is_zip && expected != status.bytes_downloaded {
        state.total_bytes = (state.total_bytes + status.bytes_downloaded).saturating_sub(expected);
        state.entries[index].size = Some(status.bytes_downloaded);
    }
    let entry = &state.entries[index];
    let banked = if entry.is_zip || entry.size.is_none_or(|s| s == 0) {
        status.bytes_downloaded
    } else {
        entry.size.unwrap_or(0)
    };
    state.completed_bytes += banked;
    state.current_index += 1;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(provider: Provider, sizes: &[Option<u64>]) -> BatchState {
        let mut download = Download::new();
        download.insert("downloadPath".into(), json!("C:/Games"));
        download.insert("uri".into(), json!("magnet:?xt=urn:btih:abc"));
        BatchState::new(
            provider,
            &download,
            "steam:1",
            sizes
                .iter()
                .enumerate()
                .map(|(i, s)| Entry {
                    filename: format!("G/{i}.bin"),
                    size: *s,
                    file_index: Some(i as i64),
                    ..Entry::default()
                })
                .collect(),
        )
    }

    fn done(bytes: u64) -> http::Status {
        http::Status {
            bytes_downloaded: bytes,
            phase: Phase::Complete,
            ..http::Status::default()
        }
    }

    #[test]
    fn resource_ids() {
        let s = state(Provider::RealDebrid, &[Some(1)]);
        assert_eq!(
            s.resource_id(&s.entries[0]),
            "realDebrid:magnet:?xt=urn:btih:abc#0"
        );
        let mut e = s.entries[0].clone();
        e.resource_id = Some("own".into());
        assert_eq!(s.resource_id(&e), "own");
    }

    #[test]
    fn banking_hoster_parts_estimates_the_rest() {
        let mut s = state(Provider::Hoster, &[None, None, None]);
        bank_entry(&mut s, 0, &done(100));
        assert_eq!(s.current_index, 1);
        assert_eq!(s.completed_bytes, 100);
        assert_eq!(s.total_bytes, 300);
    }

    #[test]
    fn banking_zips_corrects_the_total() {
        let mut s = state(Provider::TorBox, &[Some(50)]);
        s.entries[0].is_zip = true;
        s.total_bytes = 50;
        bank_entry(&mut s, 0, &done(80));
        assert_eq!(s.total_bytes, 80);
        assert_eq!(s.completed_bytes, 80);
    }

    #[test]
    fn options_per_provider() {
        let s = state(Provider::RealDebrid, &[Some(10)]);
        let o = entry_options(&s, &s.entries[0], "https://rd/dl/a.bin");
        assert!(o.allow_parallel_ranges && o.probe_unbounded_range && o.require_range_resume);
        assert_eq!(o.parallel_range_connections, Some(4));
        assert_eq!(o.expected_size, Some(10));
        let zip = entry_options(&s, &s.entries[0], "https://rd/dl/a.zip");
        assert!(!zip.allow_parallel_ranges);
        let t = state(Provider::TorBox, &[Some(10)]);
        let o = entry_options(&t, &t.entries[0], "https://tb/x");
        assert_eq!(o.max_parallel_ranges, Some(256));
        assert!(o.before_complete.is_none());
        let h = state(Provider::Hoster, &[Some(10)]);
        let o = entry_options(&h, &h.entries[0], "https://h/x");
        assert!(o.before_complete.is_some() && o.expected_size.is_none());
        assert!(assert_unique_filenames(&h.entries).is_ok());
    }
}
