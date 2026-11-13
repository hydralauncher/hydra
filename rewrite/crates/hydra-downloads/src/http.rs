//! js-http-downloader.ts, js-http-downloader-helpers.ts and
//! parallel-range-download.ts: download one file over HTTP.
//!
//! - Retries network errors (10 attempts, 1s doubling to 15s), transient
//!   statuses (408/429/5xx: 4 attempts, honouring Retry-After up to 20s) and
//!   reads that stall for 30s; a refresh hook gets a new link on 401/403/404.
//! - Resumes from the saved bytes (Range + If-Range with a strong validator),
//!   re-reading a 64 KiB overlap to verify it when the server can't prove
//!   the file didn't change.
//! - Large files with a strong validator download as 8 MiB byte ranges over
//!   4 connections; the saved ranges are checkpointed every second
//!   ([`crate::range_state`]) so a pause or crash resumes them.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{Client, Response, StatusCode};
use tokio_util::sync::CancellationToken;

use crate::filename;
use crate::range_state::{self, RangeState};
use crate::throttle::Throttle;

pub const DEFAULT_DOWNLOAD_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

const MAX_RETRY_ATTEMPTS: u32 = 10;
const MAX_STATUS_RETRY_ATTEMPTS: u32 = 4;
const MAX_RETRY_AFTER: Duration = Duration::from_millis(20_000);
const INITIAL_RETRY_DELAY_MS: u64 = 1000;
const MAX_RETRY_DELAY_MS: u64 = 15_000;
const STALL_TIMEOUT: Duration = Duration::from_millis(30_000);
const STALL_CHECK_INTERVAL: Duration = Duration::from_millis(2000);
const RECONNECT_RETRY_DELAY: Duration = Duration::from_millis(500);
const RESUME_OVERLAP_BYTES: u64 = 64 * 1024;
const PROGRESS_RESET_THRESHOLD_BYTES: u64 = 16 * 1024 * 1024;
const MAX_BUDGET_RESETS: u32 = 50;
const MAX_RESTARTS_FROM_ZERO: u32 = 3;
const RETRYABLE_HTTP_STATUS: [u16; 6] = [408, 429, 500, 502, 503, 504];

pub const PARALLEL_RANGE_SIZE: u64 = 8 * 1024 * 1024;
pub const PARALLEL_RANGE_COUNT: usize = 4;
pub const MAX_PARALLEL_RANGE_SIZE: u64 = 256 * 1024 * 1024;
const PARALLEL_RANGE_FAILURE_LIMIT: u32 = 2;
const MAX_PARALLEL_CONNECTIONS: usize = 16;
const RANGE_CHECKPOINT_INTERVAL: Duration = Duration::from_millis(1000);
const STRONG_LAST_MODIFIED_AGE_MS: i64 = 60_000;
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// Called before the file counts as complete (e.g. hash checks).
pub type BeforeComplete = Arc<dyn Fn(&Path) -> Result<(), String> + Send + Sync>;
/// Gets a fresh link when the current one stopped working.
pub type RefreshUrl = Arc<dyn Fn() -> Result<String, String> + Send + Sync>;

/// JsHttpDownloaderOptions
#[derive(Clone)]
pub struct Options {
    pub url: String,
    pub refresh_url: Option<RefreshUrl>,
    pub save_path: PathBuf,
    pub filename: Option<String>,
    pub headers: Vec<(String, String)>,
    pub allow_parallel_ranges: bool,
    pub parallel_range_size: Option<u64>,
    pub probe_unbounded_range: bool,
    pub parallel_range_connections: Option<usize>,
    pub max_parallel_ranges: Option<usize>,
    pub preserve_filename: bool,
    pub allow_resume: bool,
    pub verify_resume_prefix: bool,
    pub resource_id: Option<String>,
    pub require_resource_identity: bool,
    pub expected_size: Option<u64>,
    pub require_range_resume: bool,
    /// A throttle shared with other files of the same download.
    pub throttle: Option<Arc<Throttle>>,
    pub before_complete: Option<BeforeComplete>,
}

impl Options {
    pub fn new(
        url: impl Into<String>,
        save_path: impl Into<PathBuf>,
        filename: Option<String>,
    ) -> Options {
        Options {
            url: url.into(),
            refresh_url: None,
            save_path: save_path.into(),
            filename,
            headers: Vec::new(),
            allow_parallel_ranges: true,
            parallel_range_size: None,
            probe_unbounded_range: false,
            parallel_range_connections: None,
            max_parallel_ranges: None,
            preserve_filename: false,
            allow_resume: true,
            verify_resume_prefix: false,
            resource_id: None,
            require_resource_identity: false,
            expected_size: None,
            require_range_resume: false,
            throttle: None,
            before_complete: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Phase {
    Active,
    #[default]
    Paused,
    Complete,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ResumeCapability {
    #[default]
    Unknown,
    Supported,
    Unsupported,
}

/// JsHttpDownloaderStatus
#[derive(Clone, Debug, Default)]
pub struct Status {
    pub folder_name: String,
    pub file_size: u64,
    pub progress: f64,
    pub download_speed: f64,
    pub phase: Phase,
    pub bytes_downloaded: u64,
    pub is_reconnecting: bool,
    pub is_recovering: bool,
    pub recovery_progress: f64,
    pub resume_capability: ResumeCapability,
}

// ---- errors ---------------------------------------------------------------

#[derive(Debug, Clone)]
enum Fail {
    /// HttpDownloadStatusError
    Status {
        code: u16,
        retryable: bool,
        retry_after: Option<Duration>,
    },
    /// ParallelRangeHttpStatusError
    RangeStatus {
        code: u16,
        retry_after: Option<String>,
    },
    /// ParallelRangeUnsupportedError (retryable)
    RangeUnsupported(String),
    /// AbortError
    Aborted,
    /// Network failures and errors flagged `retryable = true`.
    Retryable(String),
    Other(String),
}

impl Fail {
    fn message(&self) -> String {
        match self {
            Fail::Status { code, .. } => {
                format!("The download link is not available (HTTP {code}).")
            }
            Fail::RangeStatus { code, .. } => format!("Byte range server returned HTTP {code}"),
            Fail::RangeUnsupported(m) | Fail::Retryable(m) | Fail::Other(m) => m.clone(),
            Fail::Aborted => "This operation was aborted".into(),
        }
    }

    fn other(message: impl Into<String>) -> Fail {
        Fail::Other(message.into())
    }
}

fn network(error: reqwest::Error) -> Fail {
    Fail::Retryable(error.to_string())
}

/// isRetryableDownloadError
fn is_retryable(error: &Fail) -> bool {
    match error {
        Fail::Retryable(_) | Fail::RangeUnsupported(_) => true,
        Fail::Other(message) => {
            let m = message.to_lowercase();
            let m = m.trim();
            m == "terminated"
                || [
                    "network",
                    "socket",
                    "connection",
                    "timeout",
                    "aborted",
                    "econnreset",
                    "etimedout",
                    "fetch failed",
                ]
                .iter()
                .any(|f| m.contains(f))
        }
        _ => false,
    }
}

fn is_retryable_status(code: u16) -> bool {
    RETRYABLE_HTTP_STATUS.contains(&code)
}

/// Date.parse for HTTP dates.
fn parse_http_date(text: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc2822(text.trim())
        .ok()
        .map(|d| d.timestamp_millis())
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// parseRetryAfterMs
fn parse_retry_after(value: Option<&str>) -> Option<Duration> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.bytes().all(|b| b.is_ascii_digit()) {
        return trimmed
            .parse::<u64>()
            .ok()
            .map(|s| Duration::from_millis(s.saturating_mul(1000)));
    }
    parse_http_date(trimmed).map(|date| Duration::from_millis((date - now_ms()).max(0) as u64))
}

fn status_error(response: &Response) -> Fail {
    let code = response.status().as_u16();
    Fail::Status {
        code,
        retryable: is_retryable_status(code),
        retry_after: parse_retry_after(header(response, "retry-after")),
    }
}

fn header<'a>(response: &'a Response, name: &str) -> Option<&'a str> {
    response.headers().get(name).and_then(|v| v.to_str().ok())
}

// ---- response helpers (parallel-range-download.ts) --------------------------

/// getRangeTotal: the total size when the response is exactly the requested range.
fn range_total(response: &Response, start: u64, end: u64) -> Option<u64> {
    if response.status() != StatusCode::PARTIAL_CONTENT {
        return None;
    }
    let content_range = header(response, "content-range")?;
    let rest = content_range.strip_prefix("bytes ").or_else(|| {
        content_range
            .get(..6)
            .filter(|p| p.eq_ignore_ascii_case("bytes "))
            .map(|_| &content_range[6..])
    })?;
    let (span, total) = rest.split_once('/')?;
    let (actual_start, actual_end) = span.split_once('-')?;
    let all_digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if !all_digits(actual_start) || !all_digits(actual_end) || !all_digits(total) {
        return None;
    }
    let (actual_start, actual_end, total): (u64, u64, u64) = (
        actual_start.parse().ok()?,
        actual_end.parse().ok()?,
        total.parse().ok()?,
    );
    let encoding = header(response, "content-encoding").map(str::to_lowercase);
    if actual_start != start
        || actual_end != end.min(total.saturating_sub(1))
        || total > MAX_SAFE_INTEGER
        || total <= start
        || encoding.is_some_and(|e| !e.is_empty() && e != "identity")
    {
        return None;
    }
    if let Some(length) = header(response, "content-length")
        && length.parse::<u64>().ok() != Some(actual_end - start + 1)
    {
        return None;
    }
    Some(total)
}

/// getStrongRangeValidator: a strong ETag, or a Last-Modified at least a minute before Date.
fn strong_validator(response: &Response) -> Option<String> {
    if let Some(etag) = response.headers().get("etag") {
        let bytes = etag.as_bytes();
        let strong = bytes.len() >= 2
            && bytes[0] == b'"'
            && bytes[bytes.len() - 1] == b'"'
            && bytes[1..bytes.len() - 1]
                .iter()
                .all(|b| *b == 0x21 || (0x23..=0x7e).contains(b) || *b >= 0x80);
        return strong.then(|| String::from_utf8_lossy(bytes).into_owned());
    }
    let modified = header(response, "last-modified")?;
    let date = header(response, "date")?;
    let (m, d) = (parse_http_date(modified)?, parse_http_date(date)?);
    (d - m >= STRONG_LAST_MODIFIED_AGE_MS).then(|| modified.to_string())
}

fn is_html(response: &Response) -> bool {
    header(response, "content-type").is_some_and(|t| {
        let t = t.to_lowercase();
        t.starts_with("text/html") || t.starts_with("application/xhtml")
    })
}

/// getRangeResumeCapability
fn resume_capability(
    response: &Response,
    requested: Option<&str>,
    if_range: Option<&str>,
) -> ResumeCapability {
    let Some(range) = requested.and_then(|r| r.strip_prefix("bytes=")) else {
        return ResumeCapability::Unknown;
    };
    let Some((start, end)) = range.split_once('-') else {
        return ResumeCapability::Unknown;
    };
    let Ok(start) = start.parse::<u64>() else {
        return ResumeCapability::Unknown;
    };
    let end = if end.is_empty() {
        Some(MAX_SAFE_INTEGER)
    } else {
        end.parse::<u64>().ok()
    };
    let Some(end) = end else {
        return ResumeCapability::Unknown;
    };
    if is_html(response) {
        return ResumeCapability::Unknown;
    }
    if response.status() == StatusCode::OK {
        return if if_range.is_some() {
            ResumeCapability::Unknown
        } else {
            ResumeCapability::Unsupported
        };
    }
    if range_total(response, start, end).is_some() {
        ResumeCapability::Supported
    } else {
        ResumeCapability::Unknown
    }
}

/// computeFileSize
fn compute_file_size(
    status: u16,
    content_range: Option<&str>,
    content_length: Option<&str>,
    start_byte: u64,
) -> Option<u64> {
    if let Some(range) = content_range {
        // /bytes \d+-\d+\/(\d+)/
        let total = range.split_once('/').map(|(_, t)| t.trim());
        let looks = range.starts_with("bytes ") && range.contains('-');
        return if looks {
            total.and_then(|t| t.parse().ok())
        } else {
            None
        };
    }
    let length: u64 = content_length?.trim().parse().ok()?;
    Some(if status == 206 {
        start_byte + length
    } else {
        length
    })
}

/// /bytes\s+(\d+)-/i
fn content_range_start(response: &Response) -> Option<u64> {
    let value = header(response, "content-range")?;
    let rest = value.get(..5).filter(|p| p.eq_ignore_ascii_case("bytes"))?;
    let _ = rest;
    let digits: String = value[5..]
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    let after = &value[5..].trim_start()[digits.len()..];
    if digits.is_empty() || !after.starts_with('-') {
        return None;
    }
    digits.parse().ok()
}

/// /bytes\s+\*\/(\d+)/i
fn total_from_416(response: &Response) -> Option<u64> {
    let value = header(response, "content-range")?;
    let lower = value.to_lowercase();
    let index = lower.find("bytes")?;
    let rest = value[index + 5..].trim_start().strip_prefix("*/")?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok().filter(|t| *t > 0)
}

struct ResumeAction {
    append: bool,
    skip_bytes: u64,
    restart: bool,
    range_ignored: bool,
}

/// resolveResumeAction
fn resume_action(start_byte: u64, status: u16, partial_start: Option<u64>) -> ResumeAction {
    if start_byte == 0 {
        return ResumeAction {
            append: false,
            skip_bytes: 0,
            restart: false,
            range_ignored: false,
        };
    }
    if status == 200 {
        return ResumeAction {
            append: true,
            skip_bytes: start_byte,
            restart: false,
            range_ignored: true,
        };
    }
    if let Some(partial) = partial_start {
        if partial > start_byte {
            return ResumeAction {
                append: false,
                skip_bytes: 0,
                restart: true,
                range_ignored: false,
            };
        }
        if partial < start_byte {
            return ResumeAction {
                append: true,
                skip_bytes: start_byte - partial,
                restart: false,
                range_ignored: false,
            };
        }
    }
    ResumeAction {
        append: true,
        skip_bytes: 0,
        restart: false,
        range_ignored: false,
    }
}

/// getRangeSizeForRequestBudget
pub fn range_size_for_request_budget(total: u64, max_ranges: u64) -> u64 {
    if total == 0 || total > MAX_SAFE_INTEGER || max_ranges == 0 {
        return PARALLEL_RANGE_SIZE;
    }
    let units = total.div_ceil(max_ranges * PARALLEL_RANGE_SIZE);
    (units * PARALLEL_RANGE_SIZE).clamp(PARALLEL_RANGE_SIZE, MAX_PARALLEL_RANGE_SIZE)
}

fn clamp_progress(progress: f64) -> f64 {
    if progress.is_finite() {
        progress.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

// ---- the downloader ---------------------------------------------------------

#[derive(Default)]
struct State {
    options: Option<Options>,
    attempt: Option<CancellationToken>,
    resolved_filename: Option<String>,
    output_file: Option<PathBuf>,

    bytes_downloaded: u64,
    file_size: u64,
    download_speed: f64,
    phase: Phase,
    folder_name: String,
    last_speed_update: Option<Instant>,
    bytes_at_last_speed_update: u64,
    is_downloading: bool,

    retry_count: u32,
    status_retry_count: u32,
    budget_resets: u32,
    attempt_bytes_received: u64,
    restart_count: u32,
    pending_read_since: Option<Instant>,
    pending_range_reads: HashMap<u64, Instant>,
    is_paused: bool,
    is_stall_retry: bool,
    is_reconnecting: bool,
    is_reconnect_retry: bool,
    is_recovering: bool,
    recover_bytes_total: u64,
    recover_bytes_done: u64,
    recover_speed_last_update: Option<Instant>,
    recover_bytes_at_last_update: u64,
    parallel_ranges_disabled: bool,
    parallel_range_failures: u32,
    resource_validator: Option<String>,
    saved_range_state: Option<RangeState>,
    verify_unvalidated_resume_overlap: bool,
    resume_capability: ResumeCapability,
    url_refresh_attempted: bool,
}

impl State {
    fn reset_speed_tracking(&mut self) {
        self.last_speed_update = Some(Instant::now());
        self.bytes_at_last_speed_update = self.bytes_downloaded;
        self.download_speed = 0.0;
    }

    fn update_speed(&mut self) {
        let now = Instant::now();
        let last = *self.last_speed_update.get_or_insert(now);
        let elapsed = now.duration_since(last).as_secs_f64();
        if elapsed >= 1.0 {
            let delta = self
                .bytes_downloaded
                .saturating_sub(self.bytes_at_last_speed_update);
            self.download_speed = delta as f64 / elapsed;
            self.last_speed_update = Some(now);
            self.bytes_at_last_speed_update = self.bytes_downloaded;
        }
    }

    fn reset_recovery(&mut self) {
        self.is_recovering = false;
        self.recover_bytes_total = 0;
        self.recover_bytes_done = 0;
        self.recover_bytes_at_last_update = 0;
    }

    fn begin_recovery(&mut self, total: u64) {
        self.is_recovering = true;
        self.is_reconnecting = false;
        self.recover_bytes_total = total;
        self.recover_bytes_done = 0;
        self.recover_bytes_at_last_update = 0;
        self.recover_speed_last_update = Some(Instant::now());
        self.download_speed = 0.0;
    }

    fn track_recovered(&mut self, skipped: u64) {
        if !self.is_recovering || skipped == 0 {
            return;
        }
        self.recover_bytes_done += skipped;
        let now = Instant::now();
        let last = *self.recover_speed_last_update.get_or_insert(now);
        let elapsed = now.duration_since(last).as_secs_f64();
        if elapsed >= 1.0 {
            self.download_speed = (self
                .recover_bytes_done
                .saturating_sub(self.recover_bytes_at_last_update))
                as f64
                / elapsed;
            self.recover_speed_last_update = Some(now);
            self.recover_bytes_at_last_update = self.recover_bytes_done;
        }
    }

    fn finish_recovery(&mut self) {
        if !self.is_recovering {
            return;
        }
        self.is_recovering = false;
        self.recover_bytes_done = self.recover_bytes_total;
        self.reset_speed_tracking();
    }

    fn mark_complete(&mut self) {
        self.phase = Phase::Complete;
        self.retry_count = 0;
        self.status_retry_count = 0;
        self.budget_resets = 0;
        self.restart_count = 0;
        self.is_reconnecting = false;
        self.reset_recovery();
        self.download_speed = 0.0;
        eprintln!(
            "[JsHttpDownloader] Download complete ({} bytes)",
            self.bytes_downloaded
        );
    }

    fn should_verify_resume_prefix(&self) -> bool {
        self.saved_range_state.is_none()
            && (self
                .options
                .as_ref()
                .is_some_and(|o| o.verify_resume_prefix)
                || self.resource_validator.is_some()
                || self.verify_unvalidated_resume_overlap)
    }
}

struct Inner {
    client: Client,
    state: Mutex<State>,
    throttle: Arc<Throttle>,
    /// Serializes runs (`activeRun`).
    run_lock: tokio::sync::Mutex<()>,
}

/// JsHttpDownloader. Cheap to clone; clones share the download.
#[derive(Clone)]
pub struct HttpDownloader {
    inner: Arc<Inner>,
}

impl Default for HttpDownloader {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpDownloader {
    pub fn new() -> HttpDownloader {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .build()
            .expect("HTTP client");
        HttpDownloader {
            inner: Arc::new(Inner {
                client,
                state: Mutex::new(State::default()),
                throttle: Arc::new(Throttle::default()),
                run_lock: tokio::sync::Mutex::new(()),
            }),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.inner.state.lock().unwrap()
    }

    pub fn set_max_download_speed(&self, limit: Option<u64>) {
        self.inner.throttle.set_limit(limit);
    }

    /// Whether both handles are the same download.
    pub fn same(&self, other: &HttpDownloader) -> bool {
        Arc::ptr_eq(&self.inner, &other.inner)
    }

    /// startDownload: runs until complete, paused, cancelled or failed.
    pub async fn start(&self, options: Options) -> Result<(), String> {
        if self.lock().is_downloading {
            eprintln!("[JsHttpDownloader] Download already in progress, resuming...");
            let _idle = self.inner.run_lock.lock().await;
            return Ok(());
        }
        {
            let mut s = self.lock();
            let throttle_reset = s.options.is_none();
            *s = State {
                options: Some(options.clone()),
                // A new download starts from zero; a resume keeps the counters
                // until prepare_download_path reads them back.
                bytes_downloaded: s.bytes_downloaded,
                ..State::default()
            };
            let _ = throttle_reset;
        }
        self.inner.throttle.reset();
        if options.expected_size == Some(0) {
            let (file, _, _) = self.prepare_download_path(
                &options.save_path,
                options.filename.as_deref(),
                &options.url,
            )?;
            if self.lock().bytes_downloaded != 0 {
                return Err("The empty file has existing data. Keeping the saved file.".into());
            }
            std::fs::write(&file, b"").map_err(|e| e.to_string())?;
            return self.complete_download(&file);
        }
        let _run = self.inner.run_lock.lock().await;
        self.start_with_retry().await
    }

    /// waitForIdle
    pub async fn wait_for_idle(&self) {
        let _run = self.inner.run_lock.lock().await;
    }

    async fn start_with_retry(&self) -> Result<(), String> {
        let result = async {
            loop {
                let token = CancellationToken::new();
                let options = {
                    let mut s = self.lock();
                    if s.is_paused {
                        return Ok(());
                    }
                    let Some(options) = s.options.clone() else {
                        return Ok(());
                    };
                    s.attempt = Some(token.clone());
                    s.phase = Phase::Active;
                    s.is_downloading = true;
                    s.is_stall_retry = false;
                    s.pending_read_since = None;
                    s.attempt_bytes_received = 0;
                    options
                };
                let stall = self.start_stall_detection(token.clone());
                let attempt = async {
                    let (file, start_byte, used_fallback) = self
                        .prepare_download_path(
                            &options.save_path,
                            options.filename.as_deref(),
                            &options.url,
                        )
                        .map_err(Fail::Other)?;
                    let headers = {
                        let mut s = self.lock();
                        s.verify_unvalidated_resume_overlap = start_byte > 0
                            && s.resource_validator.is_none()
                            && s.saved_range_state.is_none()
                            && options.allow_parallel_ranges;
                        let range_start = if s.should_verify_resume_prefix() && start_byte > 0 {
                            start_byte.saturating_sub(RESUME_OVERLAP_BYTES)
                        } else {
                            start_byte
                        };
                        build_request_headers(&s, &options.headers, range_start)
                    };
                    Box::pin(self.execute(
                        options.url.clone(),
                        headers,
                        file,
                        start_byte,
                        options.save_path.clone(),
                        used_fallback,
                        token.clone(),
                    ))
                    .await
                }
                .await;
                stall.cancel();
                token.cancel();
                match attempt {
                    Ok(()) => return Ok(()),
                    Err(error) => {
                        self.restore_saved_byte_count();
                        match self.handle_error_with_retry(error).await {
                            Ok(true) => continue,
                            Ok(false) => return Ok(()),
                            Err(message) => return Err(message),
                        }
                    }
                }
            }
        }
        .await;
        self.lock().is_downloading = false;
        result
    }

    fn restore_saved_byte_count(&self) {
        let output = self.lock().output_file.clone();
        if let Some(file) = output
            && let Ok(bytes) = range_state::downloaded_bytes(&file)
        {
            self.lock().bytes_downloaded = bytes;
        }
    }

    fn start_stall_detection(&self, attempt: CancellationToken) -> CancellationToken {
        let stop = CancellationToken::new();
        let this = self.clone();
        let stopped = stop.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = stopped.cancelled() => return,
                    _ = tokio::time::sleep(STALL_CHECK_INTERVAL) => {}
                }
                let mut s = this.lock();
                if s.phase != Phase::Active || s.is_paused || s.is_stall_retry {
                    continue;
                }
                let pending = s
                    .pending_read_since
                    .into_iter()
                    .chain(s.pending_range_reads.values().copied())
                    .min();
                if let Some(since) = pending
                    && since.elapsed() > STALL_TIMEOUT
                {
                    eprintln!(
                        "[JsHttpDownloader] Read blocked for {}s with no data, triggering retry",
                        since.elapsed().as_secs()
                    );
                    s.is_stall_retry = true;
                    drop(s);
                    attempt.cancel();
                }
            }
        });
        stop
    }

    /// handleDownloadErrorWithRetry: Ok(true) retry, Ok(false) stop quietly, Err fail.
    async fn handle_error_with_retry(&self, error: Fail) -> Result<bool, String> {
        let error = {
            let mut s = self.lock();
            match error {
                Fail::RangeStatus { code, retry_after } => Fail::Status {
                    code,
                    retryable: is_retryable_status(code),
                    retry_after: parse_retry_after(retry_after.as_deref()),
                },
                Fail::RangeUnsupported(message) => {
                    s.parallel_ranges_disabled = true;
                    eprintln!(
                        "[JsHttpDownloader] Server stopped honoring byte ranges; retrying with one connection"
                    );
                    Fail::RangeUnsupported(message)
                }
                other => other,
            }
        };
        let (was_stall, was_reconnect) = {
            let mut s = self.lock();
            if s.is_paused {
                eprintln!("[JsHttpDownloader] Download paused/cancelled by user");
                s.phase = Phase::Paused;
                return Ok(false);
            }
            let flags = (s.is_stall_retry, s.is_reconnect_retry);
            s.is_reconnect_retry = false;
            // maybeResetRetryBudget
            if s.attempt_bytes_received >= PROGRESS_RESET_THRESHOLD_BYTES
                && s.budget_resets < MAX_BUDGET_RESETS
            {
                eprintln!("[JsHttpDownloader] Data is flowing again; resetting retry budget");
                s.retry_count = 0;
                s.status_retry_count = 0;
                s.budget_resets += 1;
            }
            flags
        };
        let is_abort = matches!(error, Fail::Aborted);
        let retryable = was_stall || was_reconnect || is_retryable(&error);

        if let Fail::Status {
            code: 401 | 403 | 404,
            ..
        } = error
        {
            match self.refresh_url_on_retry().await {
                Refresh::Paused => return Ok(false),
                Refresh::Refreshed => return Ok(true),
                Refresh::Failed => {}
            }
        }
        if let Fail::Status {
            code,
            retryable: true,
            retry_after,
        } = error
        {
            let attempt = {
                let mut s = self.lock();
                if s.status_retry_count >= MAX_STATUS_RETRY_ATTEMPTS {
                    None
                } else {
                    s.status_retry_count += 1;
                    Some(s.status_retry_count)
                }
            };
            let Some(attempt) = attempt else {
                return self.fail(format!(
                    "The download server is rate-limiting or temporarily unavailable (HTTP {code}). Try again later or use another source."
                ));
            };
            let backoff = Duration::from_millis(
                (INITIAL_RETRY_DELAY_MS << (attempt - 1)).min(MAX_RETRY_DELAY_MS),
            );
            let delay = retry_after.map_or(backoff, |r| r.min(MAX_RETRY_AFTER));
            eprintln!(
                "[JsHttpDownloader] Server unavailable (HTTP {code}). Retry {attempt}/{MAX_STATUS_RETRY_ATTEMPTS} in {}ms",
                delay.as_millis()
            );
            tokio::time::sleep(delay).await;
            return Ok(!self.lock().is_paused);
        }
        if was_reconnect {
            eprintln!(
                "[JsHttpDownloader] Reconnecting after a network change; resuming in {}ms",
                RECONNECT_RETRY_DELAY.as_millis()
            );
            tokio::time::sleep(RECONNECT_RETRY_DELAY).await;
            return Ok(!self.lock().is_paused);
        }
        let retry_count = self.lock().retry_count;
        if retryable && retry_count < MAX_RETRY_ATTEMPTS {
            let attempt = {
                let mut s = self.lock();
                s.retry_count += 1;
                s.is_reconnecting = true;
                s.download_speed = 0.0;
                s.retry_count
            };
            if let Refresh::Paused = self.refresh_url_on_retry().await {
                return Ok(false);
            }
            let delay = (INITIAL_RETRY_DELAY_MS << (attempt - 1)).min(MAX_RETRY_DELAY_MS);
            let reason = if was_stall {
                "stall detected".to_string()
            } else {
                error.message()
            };
            eprintln!(
                "[JsHttpDownloader] Retryable error ({reason}). Retry {attempt}/{MAX_RETRY_ATTEMPTS} in {delay}ms"
            );
            tokio::time::sleep(Duration::from_millis(delay)).await;
            return Ok(!self.lock().is_paused);
        }
        if was_stall {
            return self.fail(
                "Download stalled repeatedly and could not be resumed after multiple retries."
                    .into(),
            );
        }
        if is_abort {
            eprintln!("[JsHttpDownloader] Download aborted");
            self.lock().phase = Phase::Paused;
            return Ok(false);
        }
        self.fail(error.message())
    }

    /// handleDownloadError for real failures.
    fn fail(&self, message: String) -> Result<bool, String> {
        let mut s = self.lock();
        s.is_reconnecting = false;
        s.reset_recovery();
        eprintln!("[JsHttpDownloader] Download error: {message}");
        s.phase = Phase::Error;
        Err(message)
    }

    async fn refresh_url_on_retry(&self) -> Refresh {
        let refresh = {
            let mut s = self.lock();
            if s.url_refresh_attempted {
                return Refresh::Failed;
            }
            let Some(refresh) = s.options.as_ref().and_then(|o| o.refresh_url.clone()) else {
                return Refresh::Failed;
            };
            s.url_refresh_attempted = true;
            refresh
        };
        let fresh = tokio::task::spawn_blocking(move || refresh()).await;
        let mut s = self.lock();
        if s.is_paused {
            return Refresh::Paused;
        }
        match fresh {
            Ok(Ok(url)) if !url.is_empty() => {
                if let Some(options) = s.options.as_mut() {
                    options.url = url;
                }
                eprintln!("[JsHttpDownloader] Refreshed download link for retry");
                Refresh::Refreshed
            }
            _ => {
                eprintln!("[JsHttpDownloader] Could not refresh download link for retry");
                Refresh::Failed
            }
        }
    }

    /// prepareDownloadPath: (file, start byte, used the "download" fallback name)
    fn prepare_download_path(
        &self,
        save_path: &Path,
        filename: Option<&str>,
        url: &str,
    ) -> Result<(PathBuf, u64, bool), String> {
        let mut s = self.lock();
        let extracted = s
            .resolved_filename
            .clone()
            .or_else(|| filename.map(str::to_string))
            .or_else(|| filename::filename_from_path(url));
        let used_fallback = extracted.is_none();
        let name = extracted.unwrap_or_else(|| "download".into());
        s.folder_name = name.clone();
        let file = save_path.join(&name);
        s.output_file = Some(file.clone());
        std::fs::create_dir_all(save_path).map_err(|e| e.to_string())?;
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let allow_resume = s.options.as_ref().is_none_or(|o| o.allow_resume);
        let mut start_byte = 0;
        if allow_resume && let Ok(meta) = std::fs::metadata(&file) {
            start_byte = meta.len();
            eprintln!("[JsHttpDownloader] Resuming download from byte {start_byte}");
        }
        // assertResourceIdentity
        if let Some(options) = s.options.as_ref()
            && options.require_resource_identity
        {
            let expected = range_state::resource_id(options.resource_id.as_deref());
            if expected.is_none()
                || (start_byte > 0 && range_state::read_identity(&file)? != expected)
            {
                return Err(
                    "The saved archive identity is missing or belongs to a different resource. Keeping the partial file.".into(),
                );
            }
        }
        s.saved_range_state = if allow_resume {
            range_state::read(&file)?
        } else {
            None
        };
        if !allow_resume {
            range_state::remove(&file);
        }
        if let Some(saved) = s.saved_range_state.clone() {
            let expected =
                range_state::resource_id(s.options.as_ref().and_then(|o| o.resource_id.as_deref()));
            if saved.resource_id != expected {
                return Err(
                    "The saved file belongs to a different download. Keeping the partial file."
                        .into(),
                );
            }
            s.resource_validator = Some(saved.validator.clone());
            s.file_size = saved.total;
            start_byte = range_state::missing(&saved)
                .first()
                .map_or(s.file_size, |gap| gap[0]);
            s.bytes_downloaded = range_state::saved_bytes(&saved);
        } else {
            s.bytes_downloaded = start_byte;
        }
        s.reset_speed_tracking();
        Ok((file, start_byte, used_fallback))
    }

    fn persist_resource_identity(&self, file: &Path) -> Result<(), Fail> {
        let s = self.lock();
        let Some(options) = s.options.as_ref() else {
            return Ok(());
        };
        if (options.require_resource_identity || options.before_complete.is_some())
            && let Some(resource) = options.resource_id.as_deref()
        {
            range_state::save_identity(file, resource).map_err(Fail::Other)?;
        }
        Ok(())
    }

    async fn fetch(
        &self,
        url: &str,
        headers: &HeaderMap,
        token: &CancellationToken,
    ) -> Result<Response, Fail> {
        self.lock().pending_read_since = Some(Instant::now());
        let request = self.inner.client.get(url).headers(headers.clone()).send();
        let result = tokio::select! {
            r = request => r.map_err(network),
            _ = token.cancelled() => Err(Fail::Aborted),
        };
        self.lock().pending_read_since = None;
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn execute(
        &self,
        url: String,
        request_headers: HeaderMap,
        file: PathBuf,
        start_byte: u64,
        save_path: PathBuf,
        used_fallback: bool,
        token: CancellationToken,
    ) -> Result<(), Fail> {
        let options = self.lock().options.clone().ok_or(Fail::Aborted)?;
        if let Some(saved) = self.lock().saved_range_state.clone()
            && range_state::missing(&saved).is_empty()
        {
            self.lock().bytes_downloaded = saved.total;
            self.complete_download(&file).map_err(Fail::Other)?;
            range_state::remove(&file);
            self.lock().saved_range_state = None;
            return Ok(());
        }

        let (use_ranges, saved) = {
            let s = self.lock();
            let use_ranges = s.saved_range_state.is_some()
                || (!s.parallel_ranges_disabled
                    && options.allow_parallel_ranges
                    && !s.verify_unvalidated_resume_overlap
                    && !(start_byte > 0 && options.verify_resume_prefix));
            (use_ranges, s.saved_range_state.clone())
        };

        let mut response;
        let if_range = request_headers
            .get("if-range")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        if use_ranges {
            let range_size = if self.lock().parallel_ranges_disabled {
                MAX_SAFE_INTEGER
            } else {
                options.parallel_range_size.unwrap_or(PARALLEL_RANGE_SIZE)
            };
            let first_gap = saved
                .as_ref()
                .and_then(|s| range_state::missing(s).first().copied());
            let unbounded_probe = options.probe_unbounded_range && saved.is_none();
            let gap_end = first_gap.map_or(MAX_SAFE_INTEGER, |g| g[1] - 1);
            let range_end = if unbounded_probe {
                MAX_SAFE_INTEGER
            } else {
                (start_byte + range_size - 1).min(gap_end)
            };
            let requested = if unbounded_probe {
                format!("bytes={start_byte}-")
            } else {
                format!("bytes={start_byte}-{range_end}")
            };
            let mut headers = request_headers.clone();
            headers.insert("range", HeaderValue::from_str(&requested).unwrap());
            response = self.fetch(&url, &headers, &token).await?;
            self.track_resume_capability(&response, Some(&requested), if_range.as_deref());
            let total = range_total(&response, start_byte, range_end);
            let validator = strong_validator(&response);
            let full_range_response = total.is_some_and(|t| range_end >= t - 1);
            if let Some(saved) = saved.as_ref()
                && (total != Some(saved.total)
                    || validator.as_deref() != Some(saved.validator.as_str()))
            {
                if response.status().as_u16() >= 400 {
                    return Err(status_error(&response));
                }
                return Err(Fail::other(
                    "The server cannot safely resume the saved byte ranges. Keeping the partial file.",
                ));
            }
            let resource_validator = self.lock().resource_validator.clone();
            if let (Some(total), Some(validator)) = (total, validator.clone())
                && (start_byte == 0 || resource_validator.as_deref() == Some(validator.as_str()))
                && (saved.is_some() || total - start_byte >= range_size.saturating_mul(2))
                && !is_html(&response)
            {
                if options.expected_size.is_some_and(|e| e != total) {
                    return Err(Fail::other(
                        "The download server returned a different file size. Keeping the partial file.",
                    ));
                }
                if unbounded_probe {
                    let end = (start_byte + range_size - 1).min(total - 1);
                    let mut headers = request_headers.clone();
                    headers.insert(
                        "range",
                        HeaderValue::from_str(&format!("bytes={start_byte}-{end}")).unwrap(),
                    );
                    response = self.fetch(&url, &headers, &token).await?;
                    if range_total(&response, start_byte, end) != Some(total)
                        || strong_validator(&response).as_deref() != Some(validator.as_str())
                    {
                        if response.status().as_u16() >= 400 {
                            return Err(status_error(&response));
                        }
                        return Err(Fail::other(
                            "The download resource changed during range preparation. Keeping the partial file.",
                        ));
                    }
                }
                let fresh = start_byte == 0 && saved.is_none();
                let actual = self.resolve_output_path(
                    &response,
                    &file,
                    &save_path,
                    used_fallback,
                    fresh,
                    &options,
                );
                self.persist_resource_identity(&actual)?;
                if fresh {
                    std::fs::write(&actual, b"").map_err(|e| Fail::Other(e.to_string()))?;
                }
                {
                    let mut s = self.lock();
                    s.file_size = total;
                    s.resource_validator = Some(validator.clone());
                }
                eprintln!("[JsHttpDownloader] Downloading {total} bytes with saved byte ranges");
                let previous_bytes = self.lock().bytes_downloaded;
                let disabled = self.lock().parallel_ranges_disabled;
                let result = self
                    .download_parallel_ranges(ParallelRanges {
                        url: url.clone(),
                        headers: request_headers.clone(),
                        first: response,
                        file: actual.clone(),
                        start_byte,
                        total,
                        range_size,
                        resource_id: options.resource_id.clone(),
                        connections: if disabled {
                            1
                        } else {
                            options
                                .parallel_range_connections
                                .unwrap_or(PARALLEL_RANGE_COUNT)
                        },
                        max_ranges: if disabled {
                            usize::MAX
                        } else {
                            options.max_parallel_ranges.unwrap_or(usize::MAX)
                        },
                        token: token.clone(),
                        throttle: options
                            .throttle
                            .clone()
                            .unwrap_or_else(|| self.inner.throttle.clone()),
                        before_complete: options.before_complete.clone(),
                    })
                    .await;
                self.lock().pending_range_reads.clear();
                let complete = match result {
                    Ok(complete) => complete,
                    Err(error) => {
                        let mut s = self.lock();
                        if !s.is_paused
                            && !s.is_reconnect_retry
                            && !matches!(error, Fail::RangeUnsupported(_))
                            && (s.is_stall_retry || is_retryable(&error))
                        {
                            s.parallel_range_failures += 1;
                            if s.parallel_range_failures >= PARALLEL_RANGE_FAILURE_LIMIT {
                                s.parallel_ranges_disabled = true;
                            }
                        }
                        drop(s);
                        let committed = range_state::downloaded_bytes(&actual).unwrap_or(0);
                        let saved = range_state::read(&actual).ok().flatten();
                        let mut s = self.lock();
                        s.bytes_downloaded = committed;
                        s.saved_range_state = saved;
                        s.attempt_bytes_received = committed.saturating_sub(previous_bytes);
                        s.reset_speed_tracking();
                        return Err(error);
                    }
                };
                if complete {
                    self.lock().mark_complete();
                    return Ok(());
                }
                if token.is_cancelled() {
                    return Err(Fail::Aborted);
                }
                let saved = range_state::read(&actual)
                    .map_err(Fail::Other)?
                    .ok_or_else(|| Fail::other("The saved byte ranges are missing."))?;
                let next_byte = range_state::missing(&saved)[0][0];
                let headers = {
                    let mut s = self.lock();
                    s.saved_range_state = Some(saved.clone());
                    s.parallel_ranges_disabled = true;
                    s.bytes_downloaded = range_state::saved_bytes(&saved);
                    s.reset_speed_tracking();
                    build_request_headers(&s, &header_pairs(&request_headers), next_byte)
                };
                return Box::pin(
                    self.execute(url, headers, actual, next_byte, save_path, false, token),
                )
                .await;
            }
            if response.status() == StatusCode::PARTIAL_CONTENT && !full_range_response {
                response = self.fetch(&url, &request_headers, &token).await?;
                let range = request_headers
                    .get("range")
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string);
                self.track_resume_capability(&response, range.as_deref(), if_range.as_deref());
            }
        } else {
            response = self.fetch(&url, &request_headers, &token).await?;
            let range = request_headers
                .get("range")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);
            self.track_resume_capability(&response, range.as_deref(), if_range.as_deref());
        }

        let content_type = header(&response, "content-type")
            .unwrap_or("unknown")
            .to_string();
        eprintln!(
            "[JsHttpDownloader] Response status={} content-type={content_type} content-length={}",
            response.status().as_u16(),
            header(&response, "content-length").unwrap_or("unknown")
        );
        let status = response.status().as_u16();
        if status == 416 && start_byte > 0 {
            let remote = total_from_416(&response);
            let verify = self.lock().should_verify_resume_prefix();
            if !verify && remote == Some(start_byte) {
                let mut s = self.lock();
                s.file_size = start_byte;
                s.bytes_downloaded = start_byte;
                s.phase = Phase::Complete;
                s.retry_count = 0;
                s.download_speed = 0.0;
                eprintln!(
                    "[JsHttpDownloader] Range not satisfiable but local file already complete"
                );
                return Ok(());
            }
            return Err(Fail::other(format!(
                "[JsHttpDownloader] Range not satisfiable for resumed download (local={start_byte}, remote={}). Keeping local file and aborting to avoid restart from zero.",
                remote.map_or("unknown".to_string(), |r| r.to_string())
            )));
        }
        if status >= 400 {
            return Err(status_error(&response));
        }
        if !response.status().is_success() && status != 206 {
            return Err(Fail::other(format!("HTTP error! status: {status}")));
        }
        let resource_validator = self.lock().resource_validator.clone();
        if start_byte > 0
            && status == 206
            && resource_validator.is_some()
            && strong_validator(&response) != resource_validator
        {
            return Err(Fail::other(
                "The download resource changed while resuming; keeping the saved partial file.",
            ));
        }
        if content_type.contains("text/html") || content_type.contains("application/xhtml") {
            return Err(Fail::other(
                "The download link returned a web page instead of a file. It may have expired or be invalid.",
            ));
        }

        let action = resume_action(start_byte, status, content_range_start(&response));
        let (mut append, mut skip_bytes, mut restart) =
            (action.append, action.skip_bytes, action.restart);
        let encoding = header(&response, "content-encoding")
            .unwrap_or("")
            .to_lowercase()
            .trim()
            .to_string();
        let encoded = !encoding.is_empty() && encoding != "identity";
        let verify_prefix = self.lock().should_verify_resume_prefix();
        if encoded && start_byte > 0 {
            if verify_prefix || options.require_range_resume {
                return Err(Fail::other(
                    "The server encoded the resumed archive response; keeping the saved partial file.",
                ));
            }
            eprintln!(
                "[JsHttpDownloader] Response is \"{encoding}\"-encoded; byte-offset resume is unreliable, restarting from byte 0"
            );
            append = false;
            skip_bytes = 0;
            restart = true;
        }
        if verify_prefix && start_byte > 0 {
            let range_start = content_range_start(&response);
            if restart || (status == 206 && range_start.is_none_or(|r| r >= start_byte)) {
                return Err(Fail::other(
                    "The archive server returned an unsafe byte range; keeping the saved partial file.",
                ));
            }
        }
        if restart {
            let mut s = self.lock();
            s.restart_count += 1;
            if s.restart_count > MAX_RESTARTS_FROM_ZERO {
                return Err(Fail::other(
                    "The server keeps refusing to resume and the download cannot make progress; aborting to avoid endless re-downloads.",
                ));
            }
            s.bytes_downloaded = 0;
            s.reset_speed_tracking();
            eprintln!(
                "[JsHttpDownloader] Restarting the file from byte 0 (restart {}/{MAX_RESTARTS_FROM_ZERO}).",
                s.restart_count
            );
        } else if action.range_ignored {
            if options.require_range_resume {
                return Err(Fail::other(
                    "The server ignored the resume request. Keeping the partial file instead of downloading it again.",
                ));
            }
            self.lock().begin_recovery(skip_bytes);
            eprintln!(
                "[JsHttpDownloader] Server ignored the Range header (HTTP 200). Re-downloading {skip_bytes} bytes to preserve the existing partial."
            );
        } else if skip_bytes > RESUME_OVERLAP_BYTES {
            self.lock().begin_recovery(skip_bytes);
            eprintln!(
                "[JsHttpDownloader] Server sent {skip_bytes} saved bytes before the resume offset; verifying them before appending."
            );
        } else if skip_bytes > 0 {
            eprintln!(
                "[JsHttpDownloader] Partial response started before the resume offset; discarding {skip_bytes} overlapping body bytes."
            );
        }

        // parseFileSize
        {
            let mut s = self.lock();
            if encoded {
                s.file_size = options.expected_size.unwrap_or(0);
            } else if let Some(size) = compute_file_size(
                status,
                header(&response, "content-range"),
                header(&response, "content-length"),
                start_byte,
            ) {
                s.file_size = size;
            }
            if options.expected_size.is_some_and(|e| e != s.file_size) {
                return Err(Fail::other(
                    "The download server returned a different file size. Keeping the partial file.",
                ));
            }
        }

        let actual = self.resolve_output_path(
            &response,
            &file,
            &save_path,
            used_fallback,
            !append,
            &options,
        );
        let mut saved_prefix = if verify_prefix && skip_bytes > 0 {
            Some(File::open(&actual).map_err(|e| Fail::Other(e.to_string()))?)
        } else {
            self.persist_resource_identity(&actual)?;
            None
        };
        let mut prefix_offset = if status == 200 {
            0
        } else {
            content_range_start(&response).unwrap_or(0)
        };
        let mut out = OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(&actual)
            .map_err(|e| Fail::Other(e.to_string()))?;
        let throttle = options
            .throttle
            .clone()
            .unwrap_or_else(|| self.inner.throttle.clone());
        let mut remaining_to_skip = skip_bytes;
        let mut prefix_pending = saved_prefix.is_some();
        loop {
            self.lock().pending_read_since = Some(Instant::now());
            let chunk = tokio::select! {
                c = response.chunk() => c.map_err(network),
                _ = token.cancelled() => Err(Fail::Aborted),
            };
            self.lock().pending_read_since = None;
            let Some(chunk) = chunk? else { break };
            let len = chunk.len() as u64;
            self.lock().attempt_bytes_received += len;
            // applySkip
            let (write_offset, should_write) = if remaining_to_skip == 0 {
                (0, true)
            } else if len <= remaining_to_skip {
                remaining_to_skip -= len;
                (0, false)
            } else {
                let offset = remaining_to_skip;
                remaining_to_skip = 0;
                (offset, true)
            };
            let skipped = if should_write { write_offset } else { len };
            if let Some(prefix) = saved_prefix.as_mut()
                && skipped > 0
            {
                verify_prefix_chunk(prefix, &chunk[..skipped as usize], prefix_offset)?;
                prefix_offset += skipped;
                if remaining_to_skip == 0 && prefix_pending {
                    self.persist_resource_identity(&actual)?;
                    prefix_pending = false;
                }
            }
            {
                let mut s = self.lock();
                if skipped > 0 {
                    s.track_recovered(skipped);
                }
                if remaining_to_skip == 0 {
                    s.finish_recovery();
                }
            }
            if !should_write {
                continue;
            }
            let data = &chunk[write_offset as usize..];
            if !self.lock().is_paused {
                throttle.wait(data.len(), &token).await;
            }
            if token.is_cancelled() {
                return Err(Fail::Aborted);
            }
            out.write_all(data)
                .map_err(|e| Fail::Other(e.to_string()))?;
            let mut s = self.lock();
            s.is_reconnecting = false;
            s.url_refresh_attempted = false;
            s.bytes_downloaded += data.len() as u64;
            s.update_speed();
        }
        if remaining_to_skip > 0 {
            return Err(Fail::other(format!(
                "[JsHttpDownloader] Server body shorter than the existing partial (missing {remaining_to_skip} bytes); refusing to append a truncated file."
            )));
        }
        out.flush().map_err(|e| Fail::Other(e.to_string()))?;
        drop(out);
        drop(saved_prefix.take());
        let completed = std::fs::metadata(&actual).map(|m| m.len()).unwrap_or(0);
        {
            let mut s = self.lock();
            if encoded && options.expected_size.is_none() {
                s.file_size = completed;
            }
            if s.file_size > 0 && completed != s.file_size {
                return Err(Fail::other(
                    "The archive download ended before its expected size; keeping the partial file.",
                ));
            }
        }
        self.complete_download(&actual).map_err(Fail::Other)
    }

    fn track_resume_capability(
        &self,
        response: &Response,
        requested: Option<&str>,
        if_range: Option<&str>,
    ) {
        let capability = resume_capability(response, requested, if_range);
        if capability != ResumeCapability::Unknown {
            self.lock().resume_capability = capability;
        }
    }

    /// resolveOutputPath: a fresh file may take its name from Content-Disposition.
    fn resolve_output_path(
        &self,
        response: &Response,
        file: &Path,
        save_path: &Path,
        used_fallback: bool,
        fresh: bool,
        options: &Options,
    ) -> PathBuf {
        let mut s = self.lock();
        if !fresh || s.resolved_filename.is_some() {
            return file.to_path_buf();
        }
        let url_name = file
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let header_name =
            filename::content_disposition_filename(header(response, "content-disposition"));
        let preserve = options.preserve_filename && options.filename.is_some();
        // chooseDownloadOutputPath
        let (path, name) = match (&header_name, preserve) {
            (Some(name), false) => (save_path.join(name), name.clone()),
            _ => (
                file.to_path_buf(),
                file.strip_prefix(save_path)
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or(url_name.clone()),
            ),
        };
        s.output_file = Some(path.clone());
        if preserve {
            s.resolved_filename = Some(name);
            return path;
        }
        if let Some(header_name) = header_name {
            if header_name != url_name {
                eprintln!(
                    "[JsHttpDownloader] Filename mismatch detected. URL-derived=\"{url_name}\" header-derived=\"{header_name}\""
                );
            }
            s.folder_name = name.clone();
            s.resolved_filename = Some(name);
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            eprintln!("[JsHttpDownloader] Using filename from Content-Disposition: {header_name}");
            return path;
        }
        s.resolved_filename = Some(url_name);
        if used_fallback {
            eprintln!(
                "[JsHttpDownloader] Content-Disposition filename not found, using fallback filename"
            );
        }
        file.to_path_buf()
    }

    fn complete_download(&self, file: &Path) -> Result<(), String> {
        let hook = self
            .lock()
            .options
            .as_ref()
            .and_then(|o| o.before_complete.clone());
        if let Some(hook) = hook {
            hook(file)?;
        }
        self.lock().mark_complete();
        Ok(())
    }

    // ---- parallel-range-download.ts

    async fn download_parallel_ranges(&self, job: ParallelRanges) -> Result<bool, Fail> {
        let ParallelRanges {
            url,
            headers,
            first,
            file,
            start_byte,
            total,
            range_size,
            resource_id,
            connections,
            max_ranges,
            token,
            throttle,
            before_complete,
        } = job;
        let Some(validator) = strong_validator(&first) else {
            return Err(Fail::RangeUnsupported(
                "The download server did not provide a byte-range validator".into(),
            ));
        };
        let saved = range_state::read(&file).map_err(Fail::Other)?;
        let resource = range_state::resource_id(resource_id.as_deref());
        if let Some(saved) = saved.as_ref()
            && (saved.total != total
                || saved.validator != validator
                || saved.resource_id != resource)
        {
            return Err(Fail::other(
                "The download resource changed. Keeping the saved partial file.",
            ));
        }
        if range_size == 0
            || range_size > MAX_SAFE_INTEGER
            || connections == 0
            || connections > MAX_PARALLEL_CONNECTIONS
            || max_ranges == 0
        {
            return Err(Fail::other("Invalid parallel download limits"));
        }
        let state = saved.unwrap_or(RangeState {
            version: 1,
            total,
            validator: validator.clone(),
            resource_id: resource,
            ranges: if start_byte > 0 {
                vec![[0, start_byte]]
            } else {
                Vec::new()
            },
        });
        let mut jobs: Vec<(u64, u64)> = Vec::new();
        'gaps: for [start, end] in range_state::missing(&state) {
            let mut offset = start;
            while offset < end {
                if jobs.len() >= max_ranges {
                    break 'gaps;
                }
                let next = (offset + range_size).min(end);
                jobs.push((offset, next - 1));
                offset = next;
            }
        }
        let handle = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&file)
            .map_err(|e| Fail::Other(e.to_string()))?;
        let shared = Arc::new(RangeShared {
            state: Mutex::new(state),
            file: Mutex::new(handle),
            path: file.clone(),
            last_checkpoint: Mutex::new(Instant::now()),
            checkpoint: tokio::sync::Mutex::new(()),
            first: Mutex::new(Some(first)),
            next_job: AtomicUsize::new(0),
            jobs,
            url,
            headers,
            validator,
            total,
        });
        let result = async {
            shared.persist().await?;
            let workers = connections.min(shared.jobs.len());
            let mut set = tokio::task::JoinSet::new();
            for _ in 0..workers {
                let shared = shared.clone();
                let this = self.clone();
                let token = token.clone();
                let throttle = throttle.clone();
                set.spawn(async move {
                    loop {
                        if token.is_cancelled() {
                            return Err(Fail::Aborted);
                        }
                        let index = shared.next_job.fetch_add(1, Ordering::SeqCst);
                        let Some(&(start, end)) = shared.jobs.get(index) else {
                            return Ok(());
                        };
                        this.run_range(&shared, start, end, &token, &throttle)
                            .await?;
                    }
                });
            }
            let mut first_error = None;
            while let Some(joined) = set.join_next().await {
                let outcome = joined.unwrap_or_else(|e| Err(Fail::Other(e.to_string())));
                if let Err(error) = outcome
                    && first_error.is_none()
                {
                    // abort(): the other ranges stop too.
                    token.cancel();
                    first_error = Some(error);
                }
            }
            match first_error {
                Some(error) => Err(error),
                None => Ok(range_state::missing(&shared.state.lock().unwrap()).is_empty()),
            }
        }
        .await;
        let persisted = shared.persist().await;
        let done = range_state::missing(&shared.state.lock().unwrap()).is_empty();
        let complete = match (result, persisted) {
            (Err(error), _) => return Err(error),
            (Ok(_), Err(error)) => return Err(error),
            (Ok(complete), Ok(())) => complete,
        };
        if done {
            if let Some(hook) = before_complete {
                hook(&file).map_err(Fail::Other)?;
            }
            range_state::remove(&file);
        }
        Ok(complete)
    }

    async fn run_range(
        &self,
        shared: &RangeShared,
        start: u64,
        end: u64,
        token: &CancellationToken,
        throttle: &Throttle,
    ) -> Result<(), Fail> {
        if token.is_cancelled() {
            return Err(Fail::Aborted);
        }
        let first = {
            let mut first = shared.first.lock().unwrap();
            let matches = first
                .as_ref()
                .is_some_and(|f| range_total(f, start, end) == Some(shared.total));
            if matches { first.take() } else { None }
        };
        let mut response = match first {
            Some(response) => response,
            None => {
                let mut headers = shared.headers.clone();
                headers.insert(
                    "range",
                    HeaderValue::from_str(&format!("bytes={start}-{end}")).unwrap(),
                );
                headers.insert(
                    "if-range",
                    HeaderValue::from_str(&shared.validator)
                        .map_err(|e| Fail::Other(e.to_string()))?,
                );
                self.lock()
                    .pending_range_reads
                    .insert(start, Instant::now());
                let sent = tokio::select! {
                    r = self.inner.client.get(&shared.url).headers(headers).send() => r.map_err(network),
                    _ = token.cancelled() => Err(Fail::Aborted),
                };
                self.lock().pending_range_reads.remove(&start);
                sent?
            }
        };
        if range_total(&response, start, end) != Some(shared.total)
            || strong_validator(&response).as_deref() != Some(shared.validator.as_str())
        {
            if response.status().as_u16() >= 400 {
                return Err(Fail::RangeStatus {
                    code: response.status().as_u16(),
                    retry_after: header(&response, "retry-after").map(str::to_string),
                });
            }
            return Err(Fail::RangeUnsupported(
                "The download server stopped serving matching byte ranges".into(),
            ));
        }
        let expected = end - start + 1;
        let mut received: u64 = 0;
        loop {
            self.lock()
                .pending_range_reads
                .insert(start, Instant::now());
            let chunk = tokio::select! {
                c = response.chunk() => c.map_err(network),
                _ = token.cancelled() => Err(Fail::Aborted),
            };
            self.lock().pending_range_reads.remove(&start);
            let Some(chunk) = chunk? else { break };
            if received + chunk.len() as u64 > expected {
                return Err(Fail::RangeUnsupported(
                    "The server sent more data than the requested byte range".into(),
                ));
            }
            if !self.lock().is_paused {
                throttle.wait(chunk.len(), token).await;
            }
            if token.is_cancelled() {
                return Err(Fail::Aborted);
            }
            let offset = start + received;
            {
                let mut file = shared.file.lock().unwrap();
                file.seek(SeekFrom::Start(offset))
                    .map_err(|e| Fail::Other(e.to_string()))?;
                file.write_all(&chunk)
                    .map_err(|_| Fail::other("Could not write the downloaded byte range"))?;
            }
            range_state::mark_saved(
                &mut shared.state.lock().unwrap(),
                offset,
                offset + chunk.len() as u64,
            );
            received += chunk.len() as u64;
            {
                let mut s = self.lock();
                s.url_refresh_attempted = false;
                s.attempt_bytes_received += chunk.len() as u64;
                s.bytes_downloaded += chunk.len() as u64;
                s.is_reconnecting = false;
                s.update_speed();
            }
            let due = {
                let mut last = shared.last_checkpoint.lock().unwrap();
                if last.elapsed() >= RANGE_CHECKPOINT_INTERVAL {
                    *last = Instant::now();
                    true
                } else {
                    false
                }
            };
            if due {
                shared.persist().await?;
            }
            if token.is_cancelled() {
                return Err(Fail::Aborted);
            }
        }
        if received != expected {
            return Err(Fail::Retryable(
                "Byte range ended before its expected size".into(),
            ));
        }
        Ok(())
    }

    // ---- control

    /// setReconnecting
    pub fn set_reconnecting(&self, value: bool) {
        let mut s = self.lock();
        s.is_reconnecting = value;
        if value {
            s.download_speed = 0.0;
        }
    }

    /// reconnect: a network change; abort the attempt and resume at once.
    pub fn reconnect(&self) {
        let mut s = self.lock();
        if !s.is_downloading || s.is_paused {
            return;
        }
        eprintln!("[JsHttpDownloader] Network change detected; reconnecting and resuming");
        s.is_reconnecting = true;
        s.is_reconnect_retry = true;
        s.download_speed = 0.0;
        s.pending_read_since = None;
        if let Some(token) = s.attempt.as_ref() {
            token.cancel();
        }
    }

    /// stopForNoNetwork
    pub fn stop_for_no_network(&self) {
        eprintln!(
            "[JsHttpDownloader] No internet connection; pausing download and keeping the partial file"
        );
        self.lock().is_reconnecting = false;
        self.pause();
    }

    /// pauseDownload
    pub fn pause(&self) {
        eprintln!("[JsHttpDownloader] Pausing download");
        let mut s = self.lock();
        s.is_paused = true;
        s.pending_read_since = None;
        if let Some(token) = s.attempt.as_ref() {
            token.cancel();
        }
        s.phase = Phase::Paused;
        s.download_speed = 0.0;
    }

    /// cancelDownload: stop and (by default) delete the partial file.
    pub fn cancel(&self, delete_file: bool) {
        eprintln!("[JsHttpDownloader] Cancelling download");
        let mut s = self.lock();
        s.is_paused = true;
        s.pending_read_since = None;
        if let Some(token) = s.attempt.take() {
            token.cancel();
        }
        if delete_file
            && s.phase != Phase::Complete
            && let Some(options) = s.options.as_ref()
        {
            let file = options.save_path.join(&s.folder_name);
            if file.exists() {
                match std::fs::remove_file(&file) {
                    Ok(()) => {
                        range_state::remove(&file);
                        range_state::remove_identity(&file);
                        eprintln!("[JsHttpDownloader] Deleted partial file");
                    }
                    Err(error) => {
                        eprintln!("[JsHttpDownloader] Failed to delete partial file: {error}")
                    }
                }
            }
        }
        *s = State::default();
        drop(s);
        self.inner.throttle.reset();
    }

    /// getDownloadStatus
    pub fn status(&self) -> Option<Status> {
        let s = self.lock();
        if s.options.is_none() && s.phase != Phase::Active {
            return None;
        }
        let progress = if s.phase == Phase::Complete {
            1.0
        } else if s.file_size > 0 {
            clamp_progress(s.bytes_downloaded as f64 / s.file_size as f64)
        } else {
            0.0
        };
        Some(Status {
            folder_name: s.folder_name.clone(),
            file_size: s.file_size,
            progress,
            download_speed: s.download_speed,
            phase: s.phase,
            bytes_downloaded: s.bytes_downloaded,
            is_reconnecting: s.is_reconnecting,
            is_recovering: s.is_recovering,
            recovery_progress: if s.recover_bytes_total > 0 {
                clamp_progress(s.recover_bytes_done as f64 / s.recover_bytes_total as f64)
            } else {
                0.0
            },
            resume_capability: s.resume_capability,
        })
    }
}

enum Refresh {
    Refreshed,
    Paused,
    Failed,
}

struct ParallelRanges {
    url: String,
    headers: HeaderMap,
    first: Response,
    file: PathBuf,
    start_byte: u64,
    total: u64,
    range_size: u64,
    resource_id: Option<String>,
    connections: usize,
    max_ranges: usize,
    token: CancellationToken,
    throttle: Arc<Throttle>,
    before_complete: Option<BeforeComplete>,
}

struct RangeShared {
    state: Mutex<RangeState>,
    file: Mutex<File>,
    path: PathBuf,
    last_checkpoint: Mutex<Instant>,
    /// Checkpoints run one at a time (the `checkpoint` promise chain).
    checkpoint: tokio::sync::Mutex<()>,
    first: Mutex<Option<Response>>,
    next_job: AtomicUsize,
    jobs: Vec<(u64, u64)>,
    url: String,
    headers: HeaderMap,
    validator: String,
    total: u64,
}

impl RangeShared {
    /// fsync the file, then save the ranges written so far.
    async fn persist(&self) -> Result<(), Fail> {
        let _serial = self.checkpoint.lock().await;
        let snapshot = self.state.lock().unwrap().clone();
        self.file
            .lock()
            .unwrap()
            .sync_data()
            .map_err(|e| Fail::Other(e.to_string()))?;
        range_state::save(&self.path, &snapshot).map_err(Fail::Other)
    }
}

/// buildRequestHeaders
fn build_request_headers(s: &State, headers: &[(String, String)], start_byte: u64) -> HeaderMap {
    let mut map = HeaderMap::new();
    for (name, value) in headers {
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            map.insert(name, value);
        }
    }
    if !map.contains_key("user-agent") {
        map.insert(
            "user-agent",
            HeaderValue::from_static(DEFAULT_DOWNLOAD_USER_AGENT),
        );
    }
    if !map.contains_key("accept-encoding") {
        map.insert("accept-encoding", HeaderValue::from_static("identity"));
    }
    let verify = s.options.as_ref().is_some_and(|o| o.verify_resume_prefix);
    if start_byte > 0 || verify || s.verify_unvalidated_resume_overlap {
        map.insert(
            "range",
            HeaderValue::from_str(&format!("bytes={start_byte}-")).unwrap(),
        );
    }
    if start_byte > 0
        && let Some(validator) = s.resource_validator.as_deref()
        && let Ok(value) = HeaderValue::from_str(validator)
    {
        map.insert("if-range", value);
    }
    map
}

fn header_pairs(map: &HeaderMap) -> Vec<(String, String)> {
    map.iter()
        .filter(|(name, _)| *name != "range" && *name != "if-range")
        .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_string())))
        .collect()
}

/// verifyResumePrefixChunk: the overlap the server re-sent must match the saved bytes.
fn verify_prefix_chunk(file: &mut File, remote: &[u8], offset: u64) -> Result<(), Fail> {
    let mismatch =
        || Fail::other("The remote archive changed since the partial download was saved.");
    let mut local = vec![0u8; remote.len()];
    file.seek(SeekFrom::Start(offset)).map_err(|_| mismatch())?;
    file.read_exact(&mut local).map_err(|_| mismatch())?;
    if local != remote {
        return Err(mismatch());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resume_actions() {
        let a = resume_action(0, 200, None);
        assert!(!a.append && a.skip_bytes == 0);
        let a = resume_action(100, 200, None);
        assert!(a.append && a.skip_bytes == 100 && a.range_ignored);
        let a = resume_action(100, 206, Some(150));
        assert!(a.restart);
        let a = resume_action(100, 206, Some(40));
        assert_eq!(a.skip_bytes, 60);
    }

    #[test]
    fn retry_after() {
        assert_eq!(parse_retry_after(Some("3")), Some(Duration::from_secs(3)));
        assert_eq!(parse_retry_after(Some("")), None);
        assert_eq!(
            parse_retry_after(Some("Wed, 21 Oct 2015 07:28:00 GMT")),
            Some(Duration::ZERO)
        );
    }

    #[test]
    fn file_sizes() {
        assert_eq!(
            compute_file_size(206, Some("bytes 0-99/1000"), None, 0),
            Some(1000)
        );
        assert_eq!(compute_file_size(206, None, Some("100"), 50), Some(150));
        assert_eq!(compute_file_size(200, None, Some("100"), 0), Some(100));
    }

    #[test]
    fn request_budget() {
        assert_eq!(range_size_for_request_budget(1, 10), PARALLEL_RANGE_SIZE);
        assert_eq!(
            range_size_for_request_budget(100 * PARALLEL_RANGE_SIZE, 10),
            10 * PARALLEL_RANGE_SIZE
        );
    }
}
