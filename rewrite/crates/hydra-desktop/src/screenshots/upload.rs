//! screenshots/screenshot-upload-worker.ts: one upload at a time, in capture
//! order, for the signed-in owner.
//!
//! Each upload: compress (STANDARD 1280x720 / CLOUD 1920x1080 + a 480px
//! thumbnail), POST /presigned-urls/screenshot, PUT the image and the
//! thumbnail to the presigned URLs, POST /profile/screenshots/:id/complete.
//! Failures follow hydra_core::screenshots::retry (Electron's policy).

use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use hydra_core::api::Options;
use hydra_core::screenshots::compression;
use hydra_core::screenshots::local::{LocalScreenshot, state};
use hydra_core::screenshots::preferences::{normalize_description, upload_quality};
use hydra_core::screenshots::retry::{
    self, Action, FEATURE_DISABLED_CODE, Failure, GAME_NOT_FOUND_CODE, MISSING_FILE_CODE, NextStep,
    RetryState, UploadError,
};
use hydra_db::keys;
use serde_json::{Map, Value, json};

use super::{Service, emit_progress, notifier, now_ms, service};

const PROGRESS_THROTTLE: Duration = Duration::from_millis(150);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const COMPLETE_TIMEOUT: Duration = Duration::from_secs(45);
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const IMAGE_PROGRESS_SHARE: f64 = 0.9;
const THUMBNAIL_PROGRESS_SHARE: f64 = 0.07;
const MIN_SCHEDULED_RUN_DELAY: Duration = Duration::from_millis(1_000);

/// ScreenshotUploadProgress
#[derive(Clone, Debug, PartialEq)]
pub struct UploadProgress {
    pub client_id: String,
    pub state: String,
    pub progress: Option<f64>,
}

/// LocalScreenshotUploadOptions
#[derive(Clone, Debug, Default, PartialEq)]
pub struct UploadOptions {
    pub is_spoiler: bool,
    /// PUBLIC | FRIENDS | PRIVATE
    pub visibility: String,
    pub comments_enabled: Option<bool>,
    pub custom_game_title: Option<String>,
    /// None: keep the draft's description; Some(None): clear it
    pub description: Option<Option<String>>,
}

enum Wake {
    Run,
}

static WAKE: OnceLock<Mutex<Sender<Wake>>> = OnceLock::new();
/// activeUpload: (clientId, abort flag)
static ACTIVE: Mutex<Option<(String, Arc<AtomicBool>)>> = Mutex::new(None);
static LAST_OWNER: Mutex<Option<String>> = Mutex::new(None);
/// uploadsDisabledThisRun
static UPLOADS_DISABLED: AtomicBool = AtomicBool::new(false);
static RERUN: AtomicBool = AtomicBool::new(false);

fn progress(client_id: &str, state: &str, progress: Option<f64>) {
    emit_progress(UploadProgress {
        client_id: client_id.to_string(),
        state: state.to_string(),
        progress,
    });
}

/// start: reset uploads a quit interrupted, then run.
pub fn start() {
    let Some(service) = service() else { return };
    *LAST_OWNER.lock().unwrap_or_else(|e| e.into_inner()) = service.owner_id();
    // resetInterruptedUploads
    for screenshot in service.store.list() {
        if screenshot.state == state::UPLOADING {
            service.store.update(&screenshot.client_id, |current| {
                current.state = state::QUEUED.into();
                current.upload_progress = Some(0.0);
                true
            });
        }
    }
    trigger();
}

/// trigger: run now (or right after the current run).
pub fn trigger() {
    let sender = WAKE
        .get_or_init(|| {
            let (sender, receiver) = mpsc::channel::<Wake>();
            std::thread::Builder::new()
                .name("screenshot-upload".into())
                .spawn(move || worker_loop(receiver))
                .expect("screenshot upload worker");
            Mutex::new(sender)
        })
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let _ = sender.send(Wake::Run);
}

fn worker_loop(receiver: mpsc::Receiver<Wake>) {
    let mut next: Option<Duration> = None;
    loop {
        let woke = match next {
            Some(delay) => receiver.recv_timeout(delay),
            None => receiver.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match woke {
            Ok(Wake::Run) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        // several wake-ups while idle are one run
        while receiver.try_recv().is_ok() {}
        let Some(service) = service() else { return };
        loop {
            RERUN.store(false, Ordering::SeqCst);
            run(&service);
            // trigger() during the run, or a retry_now step
            let woken = receiver.try_recv().is_ok();
            while receiver.try_recv().is_ok() {}
            if !(woken || RERUN.load(Ordering::SeqCst)) {
                break;
            }
        }
        next = next_run_delay(&service);
    }
}

/// cancel: abort the upload of this screenshot if it is the active one.
pub fn cancel(client_id: &str) {
    if let Some((active, abort)) = ACTIVE.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        if active == client_id {
            abort.store(true, Ordering::SeqCst);
        }
    }
}

fn stop() {
    if let Some((_, abort)) = ACTIVE.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        abort.store(true, Ordering::SeqCst);
    }
}

/// handleAuthContextChange: another account stops the current upload.
pub fn on_auth_changed() {
    let Some(service) = service() else { return };
    std::thread::spawn(move || {
        let owner = service.owner_id();
        let mut last = LAST_OWNER.lock().unwrap_or_else(|e| e.into_inner());
        if *last == owner {
            return;
        }
        *last = owner.clone();
        drop(last);
        stop();
        if owner.is_some() {
            trigger();
        }
    });
}

/// enqueue (uploadLocalScreenshot)
pub fn enqueue(
    service: &Service,
    client_id: &str,
    options: UploadOptions,
) -> Result<LocalScreenshot, String> {
    let owner = service
        .owner_id()
        .filter(|_| service.api.is_logged_in())
        .ok_or("user not logged in")?;
    let screenshot = service.store.get(client_id).ok_or("screenshot_missing")?;
    if screenshot.owner_id.as_deref().is_some_and(|o| o != owner) {
        return Err("screenshot_owner_mismatch".into());
    }
    if screenshot.is_active_upload()
        || screenshot.state == state::UPLOADED
        || screenshot.state == state::DELETED
    {
        return Ok(screenshot);
    }
    let retrying_standard = screenshot.state == state::FAILED
        && screenshot.upload_quality_fallback == Some(true)
        && screenshot.upload_quality.as_deref() == Some("STANDARD");
    let quality = if retrying_standard {
        "STANDARD"
    } else {
        upload_quality(service.has_active_subscription())
    };
    let quality_change = screenshot
        .upload_quality
        .as_deref()
        .is_some_and(|q| q != quality);
    let updated = service.store.update(client_id, |current| {
        current.owner_id = Some(owner.clone());
        current.state = state::QUEUED.into();
        current.is_spoiler = options.is_spoiler;
        current.visibility = options.visibility.clone();
        current.comments_enabled = Some(
            options
                .comments_enabled
                .or(current.comments_enabled)
                .unwrap_or(true),
        );
        if current.shop == "custom" {
            current.custom_game_title = options
                .custom_game_title
                .as_deref()
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .map(str::to_string);
        }
        if let Some(description) = &options.description {
            current.description = normalize_description(description.as_deref());
        }
        current.upload_progress = Some(0.0);
        current.upload_attempts = Some(0);
        current.upload_game_waits = Some(0);
        current.upload_moderation_waits = Some(0);
        current.upload_capacity_waits = Some(0);
        current.upload_rate_limit_waits = Some(0);
        current.next_upload_attempt_at = None;
        current.last_error = None;
        current.upload_quality = Some(quality.to_string());
        current.upload_quality_fallback = Some(retrying_standard);
        if quality_change {
            current.upload_client_id = Some(uuid::Uuid::new_v4().to_string());
        }
        true
    });
    progress(client_id, state::QUEUED, Some(0.0));
    service.record("review", "upload", None);
    notifier::refresh(service);
    trigger();
    updated.ok_or_else(|| "screenshot_missing".to_string())
}

/// handleModerationResult (screenshotModerated)
pub fn handle_moderation_result(screenshot_id: &str, status: &str, reason: Option<String>) {
    let Some(service) = service() else { return };
    let Some(screenshot) = service.store.find_by_screenshot_id(screenshot_id) else {
        return;
    };
    service.store.update(&screenshot.client_id, |current| {
        current.moderation_status = Some(status.to_string());
        current.moderation_reason = reason.clone();
        true
    });
}

/// run: the owner's queued screenshots, oldest first.
fn run(service: &Service) {
    UPLOADS_DISABLED.store(false, Ordering::SeqCst);
    let Some(owner) = service.owner_id().filter(|_| service.api.is_logged_in()) else {
        return;
    };
    let mut queued: Vec<LocalScreenshot> = service
        .store
        .list()
        .into_iter()
        .filter(|s| s.owner_id.as_deref() == Some(owner.as_str()) && s.state == state::QUEUED)
        .collect();
    queued.sort_by_key(|s| s.captured_at);
    for (index, screenshot) in queued.iter().enumerate() {
        // isAuthContextCurrent
        if service.owner_id().as_deref() != Some(owner.as_str()) {
            return;
        }
        if UPLOADS_DISABLED.load(Ordering::SeqCst) {
            fail_uploads_disabled(service, &queued[index..]);
            break;
        }
        if screenshot.next_upload_attempt_at.unwrap_or(0) <= now_ms() {
            if let Some(current) = service.store.get(&screenshot.client_id) {
                if current.state == state::QUEUED
                    && current.owner_id.as_deref() == Some(owner.as_str())
                {
                    process(service, current, &owner);
                    notifier::refresh(service);
                }
            }
        }
    }
    if service.owner_id().as_deref() == Some(owner.as_str()) {
        notifier::refresh(service);
    }
}

fn fail_uploads_disabled(service: &Service, queue: &[LocalScreenshot]) {
    let failure = Failure {
        code: FEATURE_DISABLED_CODE.into(),
        action: Action::Terminal,
        retry_after_ms: None,
    };
    for screenshot in queue {
        if service
            .store
            .get(&screenshot.client_id)
            .is_some_and(|s| s.state == state::QUEUED)
        {
            mark_failed(service, &screenshot.client_id, &failure, state::QUEUED);
        }
    }
}

/// scheduleNextRun: the earliest queued retry, at least 1s away.
fn next_run_delay(service: &Service) -> Option<Duration> {
    let owner = service.owner_id()?;
    let now = now_ms();
    let next = service
        .store
        .list()
        .into_iter()
        .filter(|s| s.owner_id.as_deref() == Some(owner.as_str()) && s.state == state::QUEUED)
        .map(|s| s.next_upload_attempt_at.unwrap_or(now))
        .min()?;
    Some(Duration::from_millis((next - now).max(0) as u64).max(MIN_SCHEDULED_RUN_DELAY))
}

/// hasSyncedGame: the game has a remoteId (uploaded to the account).
fn has_synced_game(service: &Service, screenshot: &LocalScreenshot) -> bool {
    let Some(object_id) = screenshot
        .object_id
        .as_deref()
        .filter(|_| screenshot.shop != "custom")
    else {
        return true;
    };
    service
        .db
        .get_in::<Value>(keys::GAMES, &keys::game(&screenshot.shop, object_id))
        .and_then(|game| game.get("remoteId").cloned())
        .is_some_and(|id| !id.is_null() && id != Value::String(String::new()))
}

/// buildPresignRequest
fn presign_request(
    screenshot: &LocalScreenshot,
    upload_client_id: &str,
    quality: &str,
    compressed: &compression::CompressedScreenshot,
) -> Value {
    let custom = screenshot.shop == "custom";
    let mut body = Map::new();
    body.insert("clientId".into(), json!(upload_client_id));
    body.insert("quality".into(), json!(quality));
    body.insert("imageLength".into(), json!(compressed.image.len()));
    body.insert("thumbnailLength".into(), json!(compressed.thumbnail.len()));
    body.insert("width".into(), json!(compressed.width));
    body.insert("height".into(), json!(compressed.height));
    body.insert("shop".into(), json!(screenshot.shop));
    if !custom {
        if let Some(object_id) = &screenshot.object_id {
            body.insert("objectId".into(), json!(object_id));
        }
    }
    if custom {
        if let Some(title) = screenshot
            .custom_game_title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
        {
            body.insert("customGameTitle".into(), json!(title));
        }
    }
    if let Some(description) = normalize_description(screenshot.description.as_deref()) {
        body.insert("description".into(), json!(description));
    }
    body.insert("capturedAt".into(), json!(screenshot.captured_at));
    body.insert("isSpoiler".into(), json!(screenshot.is_spoiler));
    body.insert("visibility".into(), json!(screenshot.visibility));
    if screenshot.comments_enabled == Some(false) {
        body.insert("commentsEnabled".into(), json!(false));
    }
    Value::Object(body)
}

/// A body that reports how much was read and stops when aborted.
struct ProgressReader {
    data: Arc<Vec<u8>>,
    position: usize,
    abort: Arc<AtomicBool>,
    report: Box<dyn FnMut(f64) + Send>,
}

impl Read for ProgressReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.abort.load(Ordering::SeqCst) {
            return Err(std::io::Error::other("canceled"));
        }
        let remaining = &self.data[self.position..];
        let count = remaining.len().min(buf.len()).min(64 * 1024);
        buf[..count].copy_from_slice(&remaining[..count]);
        self.position += count;
        if !self.data.is_empty() {
            (self.report)((self.position as f64 / self.data.len() as f64).min(1.0));
        }
        Ok(count)
    }
}

/// putObject: PUT to the presigned URL as image/jpeg.
fn put_object(
    url: &str,
    body: Vec<u8>,
    abort: &Arc<AtomicBool>,
    report: Box<dyn FnMut(f64) + Send>,
) -> Result<(), UploadError> {
    let length = body.len() as u64;
    let reader = ProgressReader {
        data: Arc::new(body),
        position: 0,
        abort: abort.clone(),
        report,
    };
    let result = hydra_store::http_client()
        .put(url)
        .header("Content-Type", "image/jpeg")
        .timeout(UPLOAD_TIMEOUT)
        .body(reqwest::blocking::Body::sized(reader, length))
        .send()
        .and_then(|response| response.error_for_status());
    if abort.load(Ordering::SeqCst) {
        return Err(UploadError::Cancelled);
    }
    result
        .map(|_| ())
        .map_err(|e| UploadError::Put(e.to_string()))
}

fn api_error((error, retry_after_ms): (hydra_core::api::ApiError, Option<u64>)) -> UploadError {
    UploadError::Api {
        error,
        retry_after_ms,
    }
}

/// uploadFiles: compress, presign, PUT both files. Returns the screenshot id.
fn upload_files(
    service: &Service,
    screenshot: &LocalScreenshot,
    upload_client_id: &str,
    quality: &str,
    abort: &Arc<AtomicBool>,
    report: &Arc<Mutex<dyn FnMut(f64, bool) + Send>>,
) -> Result<String, UploadError> {
    if !has_synced_game(service, screenshot) {
        return Err(UploadError::Code(GAME_NOT_FOUND_CODE.into()));
    }
    let original = std::fs::read(&screenshot.path).map_err(|e| UploadError::io(&e))?;
    let compressed =
        compression::compress_for_upload(&original, quality).map_err(UploadError::Code)?;
    drop(original);
    if abort.load(Ordering::SeqCst) {
        return Err(UploadError::Cancelled);
    }
    let presign = service
        .api
        .post_with_retry_after(
            "/presigned-urls/screenshot",
            &presign_request(
                screenshot,
                upload_client_id,
                &compressed.quality,
                &compressed,
            ),
            Options {
                needs_auth: true,
                timeout: Some(REQUEST_TIMEOUT),
            },
        )
        .map_err(api_error)?;
    if abort.load(Ordering::SeqCst) {
        return Err(UploadError::Cancelled);
    }
    let field = |key: &str| {
        presign
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| UploadError::Code("screenshot_presign_invalid".into()))
    };
    let id = field("id")?;
    let image_url = field("presignedUrl")?;
    let thumbnail_url = field("thumbnailPresignedUrl")?;
    apply_text_moderation(
        service,
        &screenshot.client_id,
        presign.get("textModeration"),
    );

    let image_report = report.clone();
    put_object(
        &image_url,
        compressed.image,
        abort,
        Box::new(move |fraction| {
            (image_report.lock().unwrap_or_else(|e| e.into_inner()))(
                fraction * IMAGE_PROGRESS_SHARE,
                false,
            )
        }),
    )?;
    let thumbnail_report = report.clone();
    put_object(
        &thumbnail_url,
        compressed.thumbnail,
        abort,
        Box::new(move |fraction| {
            (thumbnail_report.lock().unwrap_or_else(|e| e.into_inner()))(
                IMAGE_PROGRESS_SHARE + fraction * THUMBNAIL_PROGRESS_SHARE,
                false,
            )
        }),
    )?;

    let quality = compressed.quality.clone();
    let pending_id = id.clone();
    service.store.update(&screenshot.client_id, move |current| {
        current.pending_complete_screenshot_id = Some(pending_id);
        current.moderation_status = None;
        current.moderation_reason = None;
        current.upload_quality = Some(quality);
        true
    });
    Ok(id)
}

/// applyTextModeration: a hidden custom title is dropped.
fn apply_text_moderation(service: &Service, client_id: &str, moderation: Option<&Value>) {
    let Some(moderation) = moderation.filter(|m| !m.is_null()).cloned() else {
        return;
    };
    service.store.update(client_id, |current| {
        if moderation.get("title").and_then(Value::as_str) == Some("hidden")
            && current.shop == "custom"
        {
            current.custom_game_title = None;
        }
        current.text_moderation = Some(moderation);
        true
    });
}

/// process: one upload attempt.
fn process(service: &Service, screenshot: LocalScreenshot, _owner: &str) {
    let client_id = screenshot.client_id.clone();
    let abort = Arc::new(AtomicBool::new(false));
    *ACTIVE.lock().unwrap_or_else(|e| e.into_inner()) = Some((client_id.clone(), abort.clone()));

    let quality = screenshot
        .upload_quality
        .clone()
        .unwrap_or_else(|| upload_quality(service.has_active_subscription()).to_string());
    let upload_client_id = screenshot
        .upload_client_id
        .clone()
        .unwrap_or_else(|| client_id.clone());
    let attempt = screenshot.upload_attempts.unwrap_or(0) + 1;

    let claimed = service.store.update(&client_id, |current| {
        if current.state != state::QUEUED {
            return false;
        }
        current.state = state::UPLOADING.into();
        current.upload_attempts = Some(attempt);
        current.upload_progress = Some(0.0);
        current.upload_quality = Some(quality.clone());
        current.upload_client_id = Some(upload_client_id.clone());
        current.last_error = None;
        true
    });
    if claimed.is_none_or(|s| s.state != state::UPLOADING) {
        ACTIVE.lock().unwrap_or_else(|e| e.into_inner()).take();
        return;
    }

    let progress_id = client_id.clone();
    let mut last_report: Option<Instant> = None;
    let report: Arc<Mutex<dyn FnMut(f64, bool) + Send>> =
        Arc::new(Mutex::new(move |value: f64, force: bool| {
            if !force && last_report.is_some_and(|at| at.elapsed() < PROGRESS_THROTTLE) {
                return;
            }
            last_report = Some(Instant::now());
            progress(&progress_id, state::UPLOADING, Some(value));
        }));
    (report.lock().unwrap_or_else(|e| e.into_inner()))(0.0, true);

    let result = (|| {
        let id = match screenshot.pending_complete_screenshot_id.clone() {
            Some(id) => id,
            None => upload_files(
                service,
                &screenshot,
                &upload_client_id,
                &quality,
                &abort,
                &report,
            )?,
        };
        (report.lock().unwrap_or_else(|e| e.into_inner()))(
            IMAGE_PROGRESS_SHARE + THUMBNAIL_PROGRESS_SHARE,
            true,
        );
        if abort.load(Ordering::SeqCst) {
            return Err(UploadError::Cancelled);
        }
        let result = service
            .api
            .post_with_retry_after(
                &format!("/profile/screenshots/{}/complete", urlencoding(&id)),
                &Value::Null,
                Options {
                    needs_auth: true,
                    timeout: Some(COMPLETE_TIMEOUT),
                },
            )
            .map_err(api_error)?;
        Ok((id, result))
    })();

    match result {
        Ok((id, result)) => {
            mark_uploaded(
                service,
                &client_id,
                &id,
                result
                    .get("moderationStatus")
                    .cloned()
                    .unwrap_or(Value::Null),
                result
                    .get("moderationReason")
                    .cloned()
                    .unwrap_or(Value::Null),
            );
            service.record("upload", "uploaded", Some(&quality));
        }
        Err(error) => handle_failure(service, &client_id, &quality, attempt, error, &abort),
    }
    let mut active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
    if active.as_ref().is_some_and(|(_, a)| Arc::ptr_eq(a, &abort)) {
        active.take();
    }
}

/// encodeURIComponent for server ids
fn urlencoding(value: &str) -> String {
    value
        .bytes()
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
            other => format!("%{other:02X}"),
        })
        .collect()
}

fn is_moderation_status(value: &Value) -> bool {
    matches!(value.as_str(), Some("PENDING" | "APPROVED" | "BLOCKED"))
}

/// markUploaded: an earlier realtime verdict wins over a PENDING answer.
fn mark_uploaded(service: &Service, client_id: &str, id: &str, status: Value, reason: Value) {
    let status = if is_moderation_status(&status) {
        status.as_str().unwrap_or("PENDING").to_string()
    } else {
        "PENDING".to_string()
    };
    let reason = reason.as_str().map(str::to_string);
    service.store.update(client_id, |current| {
        let early_verdict = status == "PENDING"
            && current.pending_complete_screenshot_id.as_deref() == Some(id)
            && current
                .moderation_status
                .as_deref()
                .is_some_and(|s| matches!(s, "APPROVED" | "BLOCKED"));
        if current.state != state::DELETED {
            current.state = state::UPLOADED.into();
        }
        current.screenshot_id = Some(id.to_string());
        if !early_verdict {
            current.moderation_status = Some(status.clone());
            current.moderation_reason = reason.clone();
        }
        current.upload_progress = Some(1.0);
        current.upload_game_waits = Some(0);
        current.upload_moderation_waits = Some(0);
        current.upload_capacity_waits = Some(0);
        current.upload_rate_limit_waits = Some(0);
        current.uploaded_at = Some(now_ms());
        current.next_upload_attempt_at = None;
        current.pending_complete_screenshot_id = None;
        current.last_error = None;
        true
    });
    progress(client_id, state::UPLOADED, Some(1.0));
}

/// updateInState: apply only while the record is still in `expected`.
fn update_in_state(
    service: &Service,
    client_id: &str,
    expected: &str,
    change: impl FnOnce(&mut LocalScreenshot),
) -> bool {
    let mut applied = false;
    service.store.update(client_id, |current| {
        if current.state != expected {
            return false;
        }
        change(current);
        applied = true;
        true
    });
    applied
}

/// requeueCancelledUpload
fn requeue_cancelled(service: &Service, client_id: &str, attempt: u32) {
    update_in_state(service, client_id, state::UPLOADING, |current| {
        current.state = state::QUEUED.into();
        current.upload_progress = Some(0.0);
        current.upload_attempts = Some(attempt.saturating_sub(1));
    });
}

/// getIncrementedWaitCount
fn increment_wait(current: &mut LocalScreenshot, action: Action) {
    let bump = |value: &mut Option<u32>| *value = Some(value.unwrap_or(0) + 1);
    match action {
        Action::WaitForGame => bump(&mut current.upload_game_waits),
        Action::ModerationWait => bump(&mut current.upload_moderation_waits),
        Action::Wait => bump(&mut current.upload_capacity_waits),
        Action::RateLimitWait => bump(&mut current.upload_rate_limit_waits),
        _ => {}
    }
}

/// applyRecoveryStep
fn apply_step(service: &Service, client_id: &str, failure: &Failure, step: NextStep, attempt: u32) {
    match step {
        NextStep::Stopped => requeue_cancelled(service, client_id, attempt),
        NextStep::Failed => mark_failed(service, client_id, failure, state::UPLOADING),
        NextStep::RetryNow { quality } => {
            let requeued = update_in_state(service, client_id, state::UPLOADING, |current| {
                current.state = state::QUEUED.into();
                current.upload_progress = Some(0.0);
                current.last_error = Some(failure.code.clone());
                current.next_upload_attempt_at = None;
                current.pending_complete_screenshot_id = None;
                if let Some(quality) = quality {
                    current.upload_quality = Some(quality.into());
                    current.upload_quality_fallback = Some(true);
                }
            });
            if requeued {
                progress(client_id, state::QUEUED, Some(0.0));
                RERUN.store(true, Ordering::SeqCst);
            }
        }
        NextStep::RetryAt {
            delay_ms,
            counts_as_attempt,
            rotate_client_id,
        } => {
            let requeued = update_in_state(service, client_id, state::UPLOADING, |current| {
                current.state = state::QUEUED.into();
                current.upload_progress = Some(0.0);
                current.last_error = Some(failure.code.clone());
                current.next_upload_attempt_at = Some(now_ms() + delay_ms as i64);
                current.upload_attempts = Some(if counts_as_attempt {
                    attempt
                } else {
                    attempt.saturating_sub(1)
                });
                increment_wait(current, failure.action);
                if rotate_client_id {
                    current.upload_client_id = Some(uuid::Uuid::new_v4().to_string());
                    current.pending_complete_screenshot_id = None;
                }
            });
            if requeued {
                progress(client_id, state::QUEUED, Some(0.0));
            }
        }
    }
}

/// handleFailure
fn handle_failure(
    service: &Service,
    client_id: &str,
    quality: &str,
    attempt: u32,
    error: UploadError,
    abort: &Arc<AtomicBool>,
) {
    let Some(current) = service.store.get(client_id) else {
        return;
    };
    if abort.load(Ordering::SeqCst) || matches!(error, UploadError::Cancelled) {
        requeue_cancelled(service, client_id, attempt);
        return;
    }
    let failure = retry::failure(&error);
    if failure.code == MISSING_FILE_CODE {
        eprintln!("Screenshot file was missing at upload time ({client_id})");
        // onMissingFile: removeLocalScreenshotIfMissing
        if super::removal::remove_if_missing(service, client_id) {
            service.record("upload", "failed", Some(&failure.code));
            return;
        }
    }
    if failure.code == FEATURE_DISABLED_CODE {
        UPLOADS_DISABLED.store(true, Ordering::SeqCst);
    }
    if failure.action == Action::AlreadyUploaded {
        if let Some((id, status, reason)) = retry::already_uploaded(&error) {
            mark_uploaded(service, client_id, &id, status, reason);
            service.record("upload", "uploaded", Some("already_uploaded"));
            return;
        }
    }
    let step = retry::plan_recovery(
        &failure,
        &RetryState {
            upload_attempts: attempt,
            game_waits: current.upload_game_waits.unwrap_or(0),
            moderation_waits: current.upload_moderation_waits.unwrap_or(0),
            capacity_waits: current.upload_capacity_waits.unwrap_or(0),
            rate_limit_waits: current.upload_rate_limit_waits.unwrap_or(0),
        },
        quality,
    );
    eprintln!(
        "Screenshot upload failed ({client_id}): {} → {:?} → {step:?}",
        failure.code, failure.action
    );
    apply_step(service, client_id, &failure, step, attempt);
}

/// markFailed
fn mark_failed(service: &Service, client_id: &str, failure: &Failure, expected: &str) {
    let failed = update_in_state(service, client_id, expected, |current| {
        current.state = state::FAILED.into();
        current.upload_progress = None;
        current.last_error = Some(failure.code.clone());
        current.next_upload_attempt_at = None;
        current.pending_complete_screenshot_id = None;
    });
    if !failed {
        return;
    }
    progress(client_id, state::FAILED, None);
    service.record("upload", "failed", Some(&failure.code));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_ids_like_encode_uri_component() {
        assert_eq!(urlencoding("abc-123_x.y"), "abc-123_x.y");
        assert_eq!(urlencoding("a/b c"), "a%2Fb%20c");
    }

    #[test]
    fn presign_body_matches_electron() {
        let screenshot = LocalScreenshot {
            client_id: "c".into(),
            shop: "custom".into(),
            object_id: Some("x".into()),
            custom_game_title: Some(" My Game ".into()),
            description: Some(" hi ".into()),
            captured_at: 5,
            visibility: "FRIENDS".into(),
            comments_enabled: Some(false),
            ..Default::default()
        };
        let compressed = compression::CompressedScreenshot {
            quality: "STANDARD".into(),
            image: vec![0; 10],
            thumbnail: vec![0; 3],
            width: 1280,
            height: 720,
        };
        assert_eq!(
            presign_request(&screenshot, "u", "STANDARD", &compressed),
            json!({
                "clientId": "u", "quality": "STANDARD", "imageLength": 10, "thumbnailLength": 3,
                "width": 1280, "height": 720, "shop": "custom", "customGameTitle": "My Game",
                "description": "hi", "capturedAt": 5, "isSpoiler": false, "visibility": "FRIENDS",
                "commentsEnabled": false
            })
        );
    }
}
