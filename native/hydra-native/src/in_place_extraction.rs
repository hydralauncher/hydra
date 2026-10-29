//! In-place archive extraction through hatchzip-core. The archive is cut back
//! as its files come out, so extracting a download needs room for the output
//! only, not for the output and the archive side by side.
//!
//! Anything that stops a fresh extraction before its journal is written
//! leaves the archive untouched and reports `unavailable`, so the caller can
//! fall back to 7-Zip. Once the journal exists the archive is partly consumed:
//! errors report `failed`, and only another call (which resumes) can finish it.

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
    /// Allows starting a new in-place extraction. Without it, only an
    /// extraction that is already partly done is resumed.
    pub allow_fresh: bool,
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

/// `on_progress` receives the extracted fraction, from 0 to 1.
#[napi]
pub async fn extract_archive_in_place(
    options: InPlaceExtractionOptions,
    on_progress: ThreadsafeFunction<f64, (), f64, Status, false>,
) -> napi::Result<InPlaceExtractionResult> {
    tokio::task::spawn_blocking(move || {
        extract(options, move |fraction| {
            on_progress.call(fraction, ThreadsafeFunctionCallMode::NonBlocking);
        })
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
    let resuming = paths.exists();
    if !resuming && !options.allow_fresh {
        return InPlaceExtractionResult::unavailable("in-place extraction was not requested");
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
            match session::begin(&job, &paths, output, false) {
                Ok(journal) => (job, journal),
                Err(err) => return not_started(format!("{err:#}")),
            }
        }
    };

    let total = journal.total_size.max(1);
    let extracted = Arc::new(AtomicU64::new(
        journal.total_size.saturating_sub(job.remaining_size()),
    ));
    // Thousandths already reported, so a large archive sends at most a
    // thousand updates across the bridge.
    let reported = Arc::new(AtomicU64::new(0));
    on_progress(extracted.load(Ordering::Relaxed) as f64 / total as f64);

    let run = Run {
        job,
        journal,
        paths,
        stop: &STOP,
        progress: Progress {
            on_bytes: Box::new(move |bytes| {
                let done = extracted.fetch_add(bytes, Ordering::Relaxed) + bytes;
                let thousandths = done.saturating_mul(1000) / total;
                if thousandths > reported.fetch_max(thousandths, Ordering::Relaxed) {
                    on_progress(thousandths.min(1000) as f64 / 1000.0);
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::Write;

    use super::*;

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, data) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
    }

    fn options(archive: &Path, output: &Path, allow_fresh: bool) -> InPlaceExtractionOptions {
        InPlaceExtractionOptions {
            archive_path: archive.to_string_lossy().into_owned(),
            output_path: output.to_string_lossy().into_owned(),
            passwords: vec![],
            allow_fresh,
        }
    }

    #[test]
    fn extracts_into_the_archive_folder_and_removes_the_archive() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("game.zip");
        write_zip(
            &archive,
            &[
                ("game.exe", &[1; 300_000]),
                ("data/level.pak", &[2; 500_000]),
            ],
        );

        let result = extract(options(&archive, dir.path(), true), |_| {});

        assert_eq!(result.status, "finished", "{:?}", result.message);
        assert!(!archive.exists());
        assert_eq!(
            fs::read(dir.path().join("game.exe")).unwrap(),
            vec![1; 300_000]
        );
        assert_eq!(
            fs::read(dir.path().join("data/level.pak")).unwrap(),
            vec![2; 500_000]
        );
        assert!(!dir.path().join("game.zip.hatchzip").exists());
    }

    #[test]
    fn reports_progress_up_to_the_whole_archive() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("game.zip");
        write_zip(
            &archive,
            &[("a.bin", &[1; 400_000]), ("b.bin", &[2; 400_000])],
        );
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = seen.clone();

        let result = extract(options(&archive, dir.path(), true), move |fraction| {
            sink.lock().unwrap().push(fraction)
        });

        assert_eq!(result.status, "finished", "{:?}", result.message);
        let seen = seen.lock().unwrap();
        assert_eq!(seen.first(), Some(&0.0));
        assert_eq!(seen.last(), Some(&1.0));
        assert!(seen.windows(2).all(|pair| pair[0] <= pair[1]));
    }

    #[test]
    fn leaves_the_archive_alone_unless_asked() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("game.zip");
        write_zip(&archive, &[("game.exe", &[1; 1000])]);
        let before = fs::read(&archive).unwrap();

        let result = extract(options(&archive, dir.path(), false), |_| {});

        assert_eq!(result.status, "unavailable");
        assert_eq!(fs::read(&archive).unwrap(), before);
        assert!(!dir.path().join("game.exe").exists());
    }

    #[test]
    fn existing_files_leave_the_archive_for_another_extractor() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("game.zip");
        write_zip(&archive, &[("game.exe", &[1; 1000])]);
        fs::write(dir.path().join("game.exe"), b"already here").unwrap();
        let before = fs::read(&archive).unwrap();

        let result = extract(options(&archive, dir.path(), true), |_| {});

        assert_eq!(result.status, "unavailable");
        assert_eq!(fs::read(&archive).unwrap(), before);
        assert!(!dir.path().join("game.zip.hatchzip").exists());
    }

    /// A RAR 5 volume set made by RAR 6.24 with the password `secret`, taken
    /// from hatchzip's test fixtures.
    #[test]
    fn tries_each_password_on_a_rar_volume_set() {
        let dir = tempfile::tempdir().unwrap();
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/rar5-pw");
        for entry in fs::read_dir(&fixtures).unwrap() {
            let entry = entry.unwrap();
            fs::copy(entry.path(), dir.path().join(entry.file_name())).unwrap();
        }
        let mut opts = options(&dir.path().join("set.part1.rar"), dir.path(), true);
        opts.passwords = vec!["online-fix.me".into(), "secret".into()];

        let result = extract(opts, |_| {});

        assert_eq!(result.status, "finished", "{:?}", result.message);
        for part in ["set.part1.rar", "set.part2.rar", "set.part3.rar"] {
            assert!(!dir.path().join(part).exists(), "{part} was not removed");
        }
        assert_eq!(
            fs::read(dir.path().join("game/config/settings.ini")).unwrap(),
            b"volume=7\n".repeat(2_000)
        );
    }

    #[test]
    fn a_wrong_password_leaves_the_rar_set_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/rar5-pw");
        for entry in fs::read_dir(&fixtures).unwrap() {
            let entry = entry.unwrap();
            fs::copy(entry.path(), dir.path().join(entry.file_name())).unwrap();
        }
        let first = dir.path().join("set.part1.rar");
        let before = fs::read(&first).unwrap();
        let mut opts = options(&first, dir.path(), true);
        opts.passwords = vec!["online-fix.me".into()];

        let result = extract(opts, |_| {});

        assert_eq!(result.status, "unavailable");
        assert_eq!(fs::read(&first).unwrap(), before);
        assert!(!dir.path().join("game").exists());
    }

    #[test]
    fn files_that_are_not_archives_are_unavailable() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("game.zip");
        fs::write(&archive, b"not an archive").unwrap();

        let result = extract(options(&archive, dir.path(), true), |_| {});

        assert_eq!(result.status, "unavailable");
        assert_eq!(fs::read(&archive).unwrap(), b"not an archive");
    }
}
