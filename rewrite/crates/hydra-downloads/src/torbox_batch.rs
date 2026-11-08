//! torbox-batch-downloader.ts: every transfer and prepared link of one raw
//! (not zipped) TorBox download. Large files download one at a time over
//! parallel ranges; runs of small files download four at a time. Up to four
//! upcoming links are requested ahead.

use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::batch::{self, DownloadFile, INCOMPLETE_BATCH_PROGRESS_LIMIT, SpeedSample};
use crate::errors::{DlError, DlResult};
use crate::http::{
    self, HttpDownloader, PARALLEL_RANGE_COUNT, PARALLEL_RANGE_SIZE, Phase, ResumeCapability,
};
use crate::range_state::{self, IdentityState};
use crate::throttle::Throttle;

pub type LinkFuture = Pin<Box<dyn Future<Output = DlResult<String>> + Send>>;
/// A fresh link for file `index`.
pub type ResolveLink = Arc<dyn Fn(usize, CancellationToken) -> LinkFuture + Send + Sync>;
/// The downloader options for file `index` at `url`.
pub type GetOptions = Arc<dyn Fn(usize, String) -> DlResult<http::Options> + Send + Sync>;

struct State {
    files: Vec<DownloadFile>,
    links: HashMap<usize, JoinHandle<DlResult<String>>>,
    prefetch_position: usize,
    transfer_started: bool,
    failure: Option<DlError>,
    phase: Phase,
    is_reconnecting: bool,
    speed: SpeedSample,
    workers: HashMap<usize, HttpDownloader>,
}

struct Inner {
    token: CancellationToken,
    throttle: Arc<Throttle>,
    folder_name: String,
    pending: Vec<usize>,
    resolve_link: ResolveLink,
    get_options: GetOptions,
    state: Mutex<State>,
    run_lock: tokio::sync::Mutex<()>,
}

/// TorBoxBatchDownloader. Cheap to clone; clones share the download.
#[derive(Clone)]
pub struct TorBoxBatch {
    inner: Arc<Inner>,
}

/// verifyCompletedFile: a file only counts as done with a matching receipt.
fn verify_completed(file: &DownloadFile, options: &http::Options) -> DlResult<DownloadFile> {
    if !file.completed || file.size == 0 {
        return Ok(file.clone());
    }
    let filename = options
        .save_path
        .join(options.filename.as_deref().unwrap_or_default());
    let identity = match options.resource_id.as_deref() {
        Some(resource) => range_state::identity_state(&filename, resource).map_err(DlError::msg)?,
        None => IdentityState::Unidentified,
    };
    if identity == IdentityState::Complete {
        return Ok(file.clone());
    }
    // Interrupted finalization retains provenance and must pass the
    // downloader's saved-byte checks.
    let ranges = range_state::read(&filename).map_err(DlError::msg)?;
    let matches_ranges = ranges.is_some_and(|r| {
        r.resource_id.is_some()
            && r.resource_id == range_state::resource_id(options.resource_id.as_deref())
    });
    if identity != IdentityState::Changed
        && (identity == IdentityState::Identified || matches_ranges)
    {
        let mut next = file.clone();
        next.completed = false;
        return Ok(next);
    }
    Err(DlError::msg(
        "The existing completed file has no matching verified identity. Keeping the saved file.",
    ))
}

impl TorBoxBatch {
    pub fn new(
        files: Vec<DownloadFile>,
        folder_name: String,
        resolve_link: ResolveLink,
        get_options: GetOptions,
    ) -> DlResult<TorBoxBatch> {
        let mut verified = Vec::with_capacity(files.len());
        for (index, file) in files.iter().enumerate() {
            let options = get_options(index, "about:blank".into())?;
            verified.push(verify_completed(file, &options)?);
        }
        let pending = verified
            .iter()
            .enumerate()
            .filter(|(_, f)| !f.completed)
            .map(|(i, _)| i)
            .collect();
        let bytes = verified.iter().map(|f| f.bytes_downloaded).sum();
        Ok(TorBoxBatch {
            inner: Arc::new(Inner {
                token: CancellationToken::new(),
                throttle: Arc::new(Throttle::default()),
                folder_name,
                pending,
                resolve_link,
                get_options,
                state: Mutex::new(State {
                    files: verified,
                    links: HashMap::new(),
                    prefetch_position: 0,
                    transfer_started: false,
                    failure: None,
                    phase: Phase::Active,
                    is_reconnecting: false,
                    speed: SpeedSample::new(batch::now_ms(), Some(bytes)),
                    workers: HashMap::new(),
                }),
                run_lock: tokio::sync::Mutex::new(()),
            }),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.inner.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn set_max_download_speed(&self, limit: Option<u64>) {
        self.inner.throttle.set_limit(limit);
    }

    /// Whether both handles are the same download.
    pub fn same(&self, other: &TorBoxBatch) -> bool {
        Arc::ptr_eq(&self.inner, &other.inner)
    }

    /// prefetch: links for the next four pending files.
    fn prefetch(&self, position: usize) {
        let pending = &self.inner.pending;
        let end = pending.len().min(position + PARALLEL_RANGE_COUNT);
        let mut s = self.lock();
        while s.prefetch_position < end {
            let index = pending[s.prefetch_position];
            s.prefetch_position += 1;
            if self.inner.token.is_cancelled() {
                break;
            }
            if s.files[index].size == 0 || s.links.contains_key(&index) {
                continue;
            }
            let link = (self.inner.resolve_link)(index, self.inner.token.clone());
            s.links.insert(index, tokio::spawn(link));
        }
    }

    fn aborted(&self) -> DlResult<()> {
        if self.inner.token.is_cancelled() {
            return Err(DlError::Aborted);
        }
        Ok(())
    }

    async fn download_file(&self, position: usize) -> DlResult<()> {
        self.aborted()?;
        let index = self.inner.pending[position];
        let (size, bytes_downloaded) = {
            let s = self.lock();
            (s.files[index].size, s.files[index].bytes_downloaded)
        };
        self.prefetch(position);
        let url = if size > 0 {
            let handle = self.lock().links.remove(&index);
            match handle {
                Some(handle) => handle
                    .await
                    .map_err(|e| DlError::msg(e.to_string()))
                    .and_then(|r| r)?,
                None => (self.inner.resolve_link)(index, self.inner.token.clone()).await?,
            }
        } else {
            "about:blank".to_string()
        };
        self.aborted()?;
        self.prefetch(position + 1);

        let downloader = HttpDownloader::new();
        self.lock().workers.insert(index, downloader.clone());
        let mut options = (self.inner.get_options)(index, url)?;
        options.throttle = Some(self.inner.throttle.clone());
        let resource = options.resource_id.clone().unwrap_or_default();
        options.before_complete = Some(Arc::new(move |file: &Path| {
            range_state::save_completed_identity(file, &resource)
        }));
        let target = options
            .save_path
            .join(options.filename.as_deref().unwrap_or_default());
        // New files record provenance before writing; unidentified legacy
        // partials keep overlap verification.
        options.require_resource_identity = bytes_downloaded == 0
            || range_state::read_identity(&target)
                .map_err(DlError::msg)?
                .is_some();
        options.allow_parallel_ranges = true;
        options.parallel_range_connections = Some(if size > PARALLEL_RANGE_SIZE {
            PARALLEL_RANGE_COUNT
        } else {
            1
        });
        let runtime = tokio::runtime::Handle::current();
        let (resolve, token) = (self.inner.resolve_link.clone(), self.inner.token.clone());
        options.refresh_url = Some(Arc::new(move || {
            runtime
                .block_on(resolve(index, token.clone()))
                .map_err(|e| e.message())
        }));
        let reconnecting = {
            let mut s = self.lock();
            if !s.transfer_started {
                self.inner.throttle.reset();
                s.transfer_started = true;
            }
            s.is_reconnecting
        };
        downloader.set_reconnecting(reconnecting);
        downloader.start(options).await.map_err(DlError::msg)?;
        let status = downloader.status();
        if let Some(status) = status
            && status.phase == Phase::Complete
            && status.bytes_downloaded == size
        {
            let mut s = self.lock();
            s.files[index].bytes_downloaded = size;
            s.files[index].completed = true;
            s.workers.remove(&index);
            return Ok(());
        }
        self.aborted()?;
        Err(DlError::msg(
            "A downloaded file did not finish with the expected size.",
        ))
    }

    async fn run_small_files(&self, start: usize, end: usize) -> DlResult<()> {
        let position = Arc::new(AtomicUsize::new(start));
        let workers = PARALLEL_RANGE_COUNT.min(end - start);
        let mut tasks = Vec::with_capacity(workers);
        for _ in 0..workers {
            let (this, position) = (self.clone(), position.clone());
            tasks.push(tokio::spawn(async move {
                loop {
                    this.aborted()?;
                    let next = position.fetch_add(1, Ordering::SeqCst);
                    if next >= end {
                        return Ok(());
                    }
                    if let Err(error) = this.download_file(next).await {
                        if !this.inner.token.is_cancelled() {
                            this.lock().failure = Some(error.clone());
                            this.stop(Phase::Error);
                        }
                        return Err(error);
                    }
                }
            }));
        }
        let mut first_error = None;
        for task in tasks {
            let result = task
                .await
                .map_err(|e| DlError::msg(e.to_string()))
                .and_then(|r| r);
            if let Err(error) = result
                && first_error.is_none()
            {
                first_error = Some(error);
            }
        }
        match first_error {
            Some(error) => Err(self.lock().failure.clone().unwrap_or(error)),
            None => Ok(()),
        }
    }

    async fn run(&self) -> DlResult<()> {
        let result = async {
            let pending = &self.inner.pending;
            let mut position = 0;
            while position < pending.len() {
                self.aborted()?;
                let index = pending[position];
                let size = self.lock().files[index].size;
                if size > PARALLEL_RANGE_SIZE {
                    self.download_file(position).await?;
                    position += 1;
                    continue;
                }
                let start = position;
                while position < pending.len()
                    && self.lock().files[pending[position]].size <= PARALLEL_RANGE_SIZE
                {
                    position += 1;
                }
                self.run_small_files(start, position).await?;
            }
            if !self.inner.token.is_cancelled() {
                self.lock().phase = Phase::Complete;
            }
            Ok(())
        }
        .await;
        let links: Vec<JoinHandle<DlResult<String>>> =
            self.lock().links.drain().map(|(_, h)| h).collect();
        for link in links {
            let _ = link.await;
        }
        match result {
            Err(_) if self.lock().phase == Phase::Paused => Ok(()),
            Err(error) => {
                self.stop(Phase::Error);
                Err(error)
            }
            ok => ok,
        }
    }

    /// startDownload: runs until every file is done, paused or failed.
    pub async fn start(&self) -> DlResult<()> {
        let _run = self.inner.run_lock.lock().await;
        self.run().await
    }

    fn stop(&self, phase: Phase) {
        let workers: Vec<HttpDownloader> = {
            let mut s = self.lock();
            s.phase = phase;
            s.workers.values().cloned().collect()
        };
        self.inner.token.cancel();
        for worker in workers {
            if worker.status().is_none_or(|s| s.phase != Phase::Complete) {
                worker.pause();
            }
        }
    }

    /// pauseDownload
    pub fn pause(&self) {
        if self.lock().phase != Phase::Complete {
            self.stop(Phase::Paused);
        }
    }

    /// waitForIdle
    pub async fn wait_for_idle(&self) {
        let _run = self.inner.run_lock.lock().await;
    }

    /// cancelDownload
    pub fn cancel(&self, delete_file: bool) {
        self.pause();
        let workers: Vec<HttpDownloader> = self.lock().workers.drain().map(|(_, w)| w).collect();
        for worker in workers {
            worker.cancel(delete_file);
        }
    }

    pub fn set_reconnecting(&self, value: bool) {
        let workers: Vec<HttpDownloader> = {
            let mut s = self.lock();
            s.is_reconnecting = value;
            s.workers.values().cloned().collect()
        };
        for worker in workers {
            worker.set_reconnecting(value);
        }
    }

    pub fn reconnect(&self) {
        let workers: Vec<HttpDownloader> = self.lock().workers.values().cloned().collect();
        for worker in workers {
            worker.reconnect();
        }
    }

    /// getFiles
    pub fn files(&self) -> Vec<DownloadFile> {
        let s = self.lock();
        s.files
            .iter()
            .enumerate()
            .map(|(index, file)| {
                let live = s
                    .workers
                    .get(&index)
                    .and_then(|w| w.status())
                    .map_or(0, |st| st.bytes_downloaded);
                DownloadFile {
                    bytes_downloaded: file.bytes_downloaded.max(live),
                    ..file.clone()
                }
            })
            .collect()
    }

    /// getDownloadStatus
    pub fn status(&self) -> http::Status {
        let files = self.files();
        let bytes: u64 = files.iter().map(|f| f.bytes_downloaded).sum();
        let file_size: u64 = files.iter().map(|f| f.size).sum();
        let mut s = self.lock();
        s.speed = batch::sample_speed(s.speed, bytes, 0.0, batch::now_ms());
        let statuses: Vec<http::Status> = s.workers.values().filter_map(|w| w.status()).collect();
        let progress = if file_size > 0 {
            bytes as f64 / file_size as f64
        } else {
            0.0
        };
        http::Status {
            folder_name: self.inner.folder_name.clone(),
            file_size,
            progress: if s.phase == Phase::Complete {
                1.0
            } else {
                progress.min(INCOMPLETE_BATCH_PROGRESS_LIMIT)
            },
            download_speed: if s.phase == Phase::Active {
                s.speed.speed
            } else {
                0.0
            },
            phase: s.phase,
            bytes_downloaded: bytes,
            is_reconnecting: s.is_reconnecting || statuses.iter().any(|st| st.is_reconnecting),
            is_recovering: statuses.iter().any(|st| st.is_recovering),
            recovery_progress: 0.0,
            resume_capability: if statuses
                .iter()
                .any(|st| st.resume_capability == ResumeCapability::Unsupported)
            {
                ResumeCapability::Unsupported
            } else {
                ResumeCapability::Supported
            },
        }
    }
}
