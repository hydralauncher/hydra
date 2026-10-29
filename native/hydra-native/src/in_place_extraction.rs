//! In-place archive extraction through hatchzip-core. The archive is cut back
//! as its files come out, so extracting a download needs room for the output
//! only, not for the output and the archive side by side.
//!
//! Anything that stops a fresh extraction before its journal is written
//! leaves the archive untouched and reports `unavailable`, so the caller can
//! fall back to 7-Zip. Once the journal exists the archive is partly consumed:
//! errors report `failed`, and only another call (which resumes) can finish it.
//!
//! A journal lies next to the archive, where a download could have brought
//! one, so it is only followed when Hydra says it started that extraction.

use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use hatchzip_core::engine::{self, Outcome, Progress, Run};
use hatchzip_core::session::{self, State};
use napi::bindgen_prelude::Error;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::Status;
use napi_derive::napi;

/// Free space the extraction never eats into, so the rest of the system keeps
/// working while a large archive unpacks.
const KEEP_FREE_BYTES: u64 = 1 << 30;

/// Most progress updates one extraction sends across the bridge.
const PROGRESS_UPDATE_STEPS: u64 = 1000;

// Hydra never pauses an extraction; a quit mid-way is resumed from the journal.
static STOP: AtomicBool = AtomicBool::new(false);

// UnRAR keeps state in globals and is not safe to drive from several threads,
// and two games can finish downloading at once, so extractions take turns.
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

#[napi(object)]
pub struct InPlaceExtractionOptions {
    pub archive_path: String,
    pub output_path: String,
    /// Tried in order when the archive is encrypted.
    pub passwords: Vec<String>,
    /// Allows starting a new in-place extraction.
    pub allow_fresh: bool,
    /// Hydra recorded starting an in-place extraction of this archive, so a
    /// journal next to it is Hydra's own and what is left gets finished.
    pub resume: bool,
}

#[napi(object)]
pub struct InPlaceExtractionResult {
    /// `finished`, `unavailable` (archive untouched) or `failed` (archive
    /// partly consumed, progress saved).
    pub status: String,
    pub message: Option<String>,
}

impl InPlaceExtractionResult {
    fn finished() -> Self {
        Self {
            status: "finished".into(),
            message: None,
        }
    }

    fn unavailable(message: impl ToString) -> Self {
        Self {
            status: "unavailable".into(),
            message: Some(message.to_string()),
        }
    }

    fn failed(message: impl ToString) -> Self {
        Self {
            status: "failed".into(),
            message: Some(message.to_string()),
        }
    }
}

/// Whether an in-place extraction journal lies next to the archive.
#[napi]
pub fn in_place_journal_exists(archive_path: String) -> bool {
    journal_exists(Path::new(&archive_path))
}

fn journal_exists(archive_path: &Path) -> bool {
    session::locate(archive_path).is_ok_and(|(_, paths)| paths.exists())
}

/// `on_progress` receives the extracted fraction, from 0 to 1.
#[napi]
pub async fn extract_archive_in_place(
    options: InPlaceExtractionOptions,
    on_progress: ThreadsafeFunction<f64, (), f64, Status, false>,
) -> napi::Result<InPlaceExtractionResult> {
    tokio::task::spawn_blocking(move || {
        let archive_path = PathBuf::from(&options.archive_path);
        let on_progress = move |fraction| {
            on_progress.call(fraction, ThreadsafeFunctionCallMode::NonBlocking);
        };
        // A panic still says whether the archive was touched, so the caller
        // never hands a partly consumed one to 7-Zip.
        panic::catch_unwind(AssertUnwindSafe(|| extract(options, on_progress))).unwrap_or_else(
            |_| {
                if journal_exists(&archive_path) {
                    InPlaceExtractionResult::failed("in-place extraction crashed")
                } else {
                    InPlaceExtractionResult::unavailable("in-place extraction crashed")
                }
            },
        )
    })
    .await
    .map_err(|err| Error::from_reason(err.to_string()))
}

fn extract(
    options: InPlaceExtractionOptions,
    on_progress: impl Fn(f64) + Send + Sync + 'static,
) -> InPlaceExtractionResult {
    let (primary, paths) = match session::locate(Path::new(&options.archive_path)) {
        Ok(located) => located,
        Err(err) => return InPlaceExtractionResult::unavailable(format!("{err:#}")),
    };
    if paths.exists() && !options.resume {
        return InPlaceExtractionResult::unavailable(format!(
            "{} was not created by Hydra",
            paths.journal.display()
        ));
    }
    if !paths.exists() {
        // Hydra started this run, and both the archive and its journal are
        // gone, so every file is out.
        if options.resume && !primary.exists() {
            return InPlaceExtractionResult::finished();
        }
        if !options.allow_fresh {
            return InPlaceExtractionResult::unavailable("in-place extraction was not requested");
        }
    }
    let _turn = ONE_AT_A_TIME
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // Before the journal exists nothing has been touched, so any error leaves
    // the archive whole for another extractor.
    let not_started = |message: String| {
        if paths.exists() {
            InPlaceExtractionResult::failed(message)
        } else {
            InPlaceExtractionResult::unavailable(message)
        }
    };

    let mut passwords = options.passwords.into_iter();
    let opened = session::open_encrypted(
        &primary,
        &paths,
        Some(PathBuf::from(&options.output_path)),
        true,
        None,
        &Arc::default(),
        |_| passwords.next(),
    );
    let state = match opened {
        Ok((state, _)) => state,
        Err(err) => return not_started(format!("{err:#}")),
    };

    let (job, journal) = match state {
        State::Orphan(journal) => {
            return match engine::finish_orphaned(&journal, &paths) {
                Ok(()) => InPlaceExtractionResult::finished(),
                Err(err) => InPlaceExtractionResult::failed(format!("{err:#}")),
            };
        }
        State::Resume(job, journal) => {
            let plan =
                match session::plan(&job, &journal.output, true, KEEP_FREE_BYTES, journal.keep) {
                    Ok(plan) => plan,
                    Err(err) => return InPlaceExtractionResult::failed(format!("{err:#}")),
                };
            if !plan.fits {
                return InPlaceExtractionResult::failed(format!(
                    "not enough disk space to resume: {} required, {} available",
                    engine::human(plan.needed + plan.keep_free),
                    engine::human(plan.free)
                ));
            }
            if let Err(err) = session::clear_uncommitted(&job, &journal.output) {
                return InPlaceExtractionResult::failed(format!("{err:#}"));
            }
            (job, journal)
        }
        State::Fresh(job, output) => {
            if let Some(reason) = job.in_place_refusal() {
                return InPlaceExtractionResult::unavailable(reason);
            }
            let plan = match session::plan(&job, &output, false, KEEP_FREE_BYTES, false) {
                Ok(plan) => plan,
                Err(err) => return InPlaceExtractionResult::unavailable(format!("{err:#}")),
            };
            if !plan.fits {
                return InPlaceExtractionResult::unavailable(format!(
                    "not enough disk space: {} required, {} available",
                    engine::human(plan.needed + plan.keep_free),
                    engine::human(plan.free)
                ));
            }
            match session::begin(&job, &paths, output, false, None) {
                Ok(journal) => (job, journal),
                Err(err) => return not_started(format!("{err:#}")),
            }
        }
    };

    let total = journal.total_size.max(1);
    let extracted = Arc::new(AtomicU64::new(
        journal.total_size.saturating_sub(job.remaining_size()),
    ));
    let reported_steps = Arc::new(AtomicU64::new(0));
    on_progress(extracted.load(Ordering::Relaxed) as f64 / total as f64);

    let run = Run {
        job,
        journal,
        paths,
        stop: &STOP,
        progress: Progress {
            on_bytes: Box::new(move |bytes| {
                let done = extracted.fetch_add(bytes, Ordering::Relaxed) + bytes;
                let steps = done.saturating_mul(PROGRESS_UPDATE_STEPS) / total;
                if steps > reported_steps.fetch_max(steps, Ordering::Relaxed) {
                    on_progress(
                        steps.min(PROGRESS_UPDATE_STEPS) as f64 / PROGRESS_UPDATE_STEPS as f64,
                    );
                }
            }),
            on_commit: Box::new(|_| {}),
        },
        keep_free: KEEP_FREE_BYTES,
    };

    match run.execute() {
        Ok(Outcome::Finished) => InPlaceExtractionResult::finished(),
        Ok(Outcome::Paused) => InPlaceExtractionResult::failed("extraction paused"),
        Err(err) => InPlaceExtractionResult::failed(format!("{err:#}")),
    }
}
