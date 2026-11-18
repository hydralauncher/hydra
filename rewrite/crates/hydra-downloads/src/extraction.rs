//! game-files-manager.ts (extraction): unpack a finished download, then any
//! archives at the root of what came out (two passes), delete or keep the
//! archives as the download says, and mark the game extracted.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use hydra_db::{Db, keys};
use serde_json::{Value, json};

use crate::layout::{self, Download};
use crate::manager::{Event, Manager};

const PROGRESS_THROTTLE: Duration = Duration::from_millis(1000);
const MAX_ARCHIVE_EXTRACTION_PASSES: usize = 2;
const IN_PLACE_EXTRACTION_FEATURE: &str = "IN_PLACE_ARCHIVE_EXTRACTION";

/// Why an extraction stopped ("on-extraction-failed" ExtractionFailure).
#[derive(Clone, Debug)]
pub enum Failure {
    FileNotFound,
    UnsupportedFormat(String),
    Other,
}

pub(crate) struct Extraction {
    manager: Arc<Manager>,
    db: Arc<Db>,
    id: String,
    last_update: std::cell::Cell<Option<Instant>>,
    last_value: std::cell::Cell<f64>,
    in_place_enabled: std::cell::OnceCell<bool>,
}

fn text(download: &Download, key: &str) -> Option<String> {
    download
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

impl Extraction {
    pub(crate) fn new(manager: Arc<Manager>, db: Arc<Db>, id: String) -> Extraction {
        Extraction {
            manager,
            db,
            id,
            last_update: std::cell::Cell::new(None),
            last_value: std::cell::Cell::new(0.0),
            in_place_enabled: std::cell::OnceCell::new(),
        }
    }

    fn download(&self) -> Option<Download> {
        layout::get(&self.db, &self.id)
    }

    /// updateExtractionProgress: at most once a second, never backwards (unless forced).
    fn progress(&self, value: f64, force: bool) {
        let now = Instant::now();
        if !force {
            if self
                .last_update
                .get()
                .is_some_and(|t| now.duration_since(t) < PROGRESS_THROTTLE)
            {
                return;
            }
            if value < self.last_value.get() {
                return;
            }
        }
        self.last_value.set(value);
        self.last_update.set(Some(now));
        self.manager.emit_event(Event::ExtractionProgress {
            game_id: self.id.clone(),
            progress: value,
        });
    }

    /// isInPlaceExtractionEnabled: the API feature flag, asked once per extraction.
    fn in_place_enabled(&self) -> bool {
        *self.in_place_enabled.get_or_init(|| {
            let Some(api) = self.manager.api() else {
                return false;
            };
            let options = hydra_core::api::Options {
                needs_auth: false,
                timeout: Some(Duration::from_secs(10)),
            };
            match api.get("/features", &[], options) {
                Ok(Value::Array(features)) => features
                    .iter()
                    .any(|f| f.as_str() == Some(IN_PLACE_EXTRACTION_FEATURE)),
                Ok(_) => false,
                Err(error) => {
                    eprintln!("[GameFilesManager] Could not load feature flags: {error}");
                    false
                }
            }
        })
    }

    /// shouldDeleteArchives
    fn should_delete_archives(&self, download: Option<&Download>) -> bool {
        if let Some(value) = download
            .and_then(|d| d.get("automaticallyDeleteArchiveFiles"))
            .and_then(Value::as_bool)
        {
            return value;
        }
        let prefs: Option<Value> = self.db.get(keys::USER_PREFERENCES);
        prefs
            .as_ref()
            .and_then(|p| p.get("deleteArchiveFilesAfterExtractionByDefault"))
            .and_then(Value::as_bool)
            .unwrap_or(true)
    }

    fn in_place_archives(download: &Download) -> Vec<String> {
        download
            .get("inPlaceArchives")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// recordInPlaceStart
    fn record_in_place_start(&self, archive: &Path) {
        let Some(mut download) = self.download() else {
            return;
        };
        let path = archive.to_string_lossy().into_owned();
        let mut list = Self::in_place_archives(&download);
        if list.contains(&path) {
            return;
        }
        list.push(path);
        download.insert("inPlaceArchives".into(), json!(list));
        layout::put(&self.db, &download);
    }

    /// forgetInPlaceStart
    fn forget_in_place_start(&self, archive: &Path) {
        let Some(mut download) = self.download() else {
            return;
        };
        let path = archive.to_string_lossy().into_owned();
        let list: Vec<String> = Self::in_place_archives(&download)
            .into_iter()
            .filter(|p| *p != path)
            .collect();
        if list.is_empty() {
            download.remove("inPlaceArchives");
        } else {
            download.insert("inPlaceArchives".into(), json!(list));
        }
        layout::put(&self.db, &download);
    }

    fn clear_in_place_archives(&self) {
        if let Some(mut download) = self.download()
            && download.remove("inPlaceArchives").is_some()
        {
            layout::put(&self.db, &download);
        }
    }

    /// resetExtractingState
    fn reset_extracting_state(&self) {
        let Some(mut download) = self.download() else {
            return;
        };
        let progress = download
            .get("progress")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        if progress == 1.0 {
            let seeding = download.get("shouldSeed").and_then(Value::as_bool) == Some(true)
                && download.get("downloader").and_then(Value::as_i64) == Some(1);
            download.insert(
                "status".into(),
                json!(if seeding { "seeding" } else { "complete" }),
            );
        }
        download.insert("queued".into(), json!(false));
        download.insert("extracting".into(), json!(false));
        // TODO(downloads): hasInstaller (findDownloadInstaller).
        layout::put(&self.db, &download);
        self.manager.emit_event(Event::Updated);
    }

    /// setExtractionFailedState
    fn fail(&self, error: &str, target: Option<&Path>, failure: Failure) {
        eprintln!(
            "[GameFilesManager] Extraction failed for {}{}: {error}",
            self.id,
            target
                .map(|t| format!(" at {}", t.display()))
                .unwrap_or_default()
        );
        self.reset_extracting_state();
        self.manager.emit_event(Event::ExtractionFailed {
            game_id: self.id.clone(),
            failure,
        });
        self.last_update.set(None);
        self.last_value.set(0.0);
    }

    fn extract_one(
        &self,
        file: &Path,
        output: &Path,
        in_place: bool,
        resume: bool,
        on_progress: &dyn Fn(f64),
    ) -> Result<bool, String> {
        let enabled = in_place && !resume && self.in_place_enabled();
        hydra_archive::extract_archive(
            hydra_archive::Request {
                file,
                output,
                in_place,
                resume,
                in_place_enabled: enabled,
            },
            &|| self.record_in_place_start(file),
            &|| self.forget_in_place_start(file),
            on_progress,
        )
    }

    /// extractDownloadedFile: the downloaded archive into a folder of its name.
    pub(crate) fn extract_downloaded_file(&self) -> bool {
        let Some(download) = self.download() else {
            return false;
        };
        let Some(folder) = text(&download, "folderName") else {
            self.fail(
                "No downloaded file was found to extract",
                None,
                Failure::FileNotFound,
            );
            return false;
        };
        let base = PathBuf::from(text(&download, "downloadPath").unwrap_or_default());
        let file = base.join(&folder);
        let folder_path = Path::new(&folder);
        let extracted_name = folder_path.with_extension("");
        let extracted_folder = extracted_name.to_string_lossy().into_owned();
        let output = base.join(&extracted_name);
        let resume =
            Self::in_place_archives(&download).contains(&file.to_string_lossy().into_owned());
        if !resume && !file.exists() {
            self.fail(
                "No downloaded file was found to extract",
                Some(&file),
                Failure::FileNotFound,
            );
            return false;
        }
        self.progress(0.0, true);
        let should_delete = self.should_delete_archives(Some(&download));
        let result = self.extract_one(&file, &output, should_delete, resume, &|fraction| {
            self.progress(fraction, false)
        });
        match result {
            Ok(true) => {
                if !self.extract_files_in_directory(&output, Some(&file)) {
                    return false;
                }
                if output.exists() {
                    if should_delete {
                        delete_archive_file(&self.db, &file);
                    } else if file.exists() {
                        // TODO(downloads): on-archive-deletion-prompt
                        eprintln!("[GameFilesManager] Keeping {}", file.display());
                    }
                }
                if let Some(mut latest) = self.download() {
                    latest.insert("folderName".into(), json!(extracted_folder));
                    latest.insert("sourceArchiveName".into(), json!(folder));
                    latest.remove("inPlaceArchives");
                    layout::put(&self.db, &latest);
                }
                self.set_extraction_complete();
                true
            }
            Ok(false) => {
                self.fail(
                    "7zip returned unsuccessful extraction",
                    Some(&file),
                    Failure::Other,
                );
                false
            }
            Err(error) => {
                self.fail(&error, Some(&file), Failure::Other);
                false
            }
        }
    }

    /// extractFilesInDirectory: archives at the root of `directory` (not in
    /// subfolders, which may hold the game's own assets), in up to two passes.
    pub(crate) fn extract_files_in_directory(
        &self,
        directory: &Path,
        outer_archive: Option<&Path>,
    ) -> bool {
        match std::fs::metadata(directory) {
            Err(_) => {
                self.fail(
                    "No downloaded file was found to extract",
                    Some(directory),
                    Failure::FileNotFound,
                );
                return false;
            }
            Ok(meta) if !meta.is_dir() => {
                self.fail(
                    &format!("Expected extraction directory for {}", directory.display()),
                    Some(directory),
                    Failure::Other,
                );
                return false;
            }
            Ok(_) => {}
        }
        let download = self.download();
        let multipart = download.as_ref().is_some_and(|d| d.contains_key("parts"));
        let in_place = outer_archive.is_none() && self.should_delete_archives(download.as_ref());
        let started: HashSet<String> = download
            .as_ref()
            .map(Self::in_place_archives)
            .unwrap_or_default()
            .into_iter()
            .collect();
        let unlisted: Vec<String> = started
            .iter()
            .filter_map(|p| {
                let path = Path::new(p);
                (path.parent() == Some(directory))
                    .then(|| path.file_name().map(|n| n.to_string_lossy().into_owned()))
                    .flatten()
            })
            .collect();
        let is_first_volume = |name: &str| {
            let lower = name.to_lowercase();
            if multipart {
                first_part_regex(&lower, true)
            } else {
                first_part_regex(&lower, false)
            }
        };
        let mut compressed: HashSet<String> = HashSet::new();
        let mut extracted: HashSet<String> = HashSet::new();
        for pass in 0..MAX_ARCHIVE_EXTRACTION_PASSES {
            let mut archives = list_archive_files(directory);
            for name in &unlisted {
                if !archives.contains(name) {
                    archives.push(name.clone());
                }
            }
            compressed.extend(archives.iter().cloned());
            let to_extract: Vec<String> = archives
                .into_iter()
                .filter(|name| {
                    !extracted.contains(name)
                        && (is_first_volume(name) || !is_part_rar(&name.to_lowercase()))
                })
                .collect();
            if to_extract.is_empty() {
                continue;
            }
            if pass == 0 {
                self.progress(0.0, true);
            }
            let count = to_extract.len() as f64;
            for (done, name) in to_extract.iter().enumerate() {
                let path = directory.join(name);
                let resume = started.contains(&path.to_string_lossy().into_owned());
                let output = path.parent().unwrap_or(directory).to_path_buf();
                let result = self.extract_one(&path, &output, in_place, resume, &|fraction| {
                    let pass_progress = (done as f64 + fraction) / count;
                    self.progress(
                        (pass as f64 + pass_progress) / MAX_ARCHIVE_EXTRACTION_PASSES as f64,
                        false,
                    );
                });
                match result {
                    Ok(true) => {
                        extracted.insert(name.clone());
                        self.progress(
                            (pass as f64 + (done + 1) as f64 / count)
                                / MAX_ARCHIVE_EXTRACTION_PASSES as f64,
                            true,
                        );
                    }
                    Ok(false) => {
                        self.fail(
                            &format!("7zip returned unsuccessful extraction for {name}"),
                            Some(&path),
                            Failure::Other,
                        );
                        return false;
                    }
                    Err(error) => {
                        self.fail(&error, Some(&path), Failure::Other);
                        return false;
                    }
                }
            }
        }
        // finishArchiveExtraction
        if !extracted.is_empty() {
            self.progress(1.0, true);
            if outer_archive.is_none() {
                let leftovers: Vec<PathBuf> = compressed
                    .iter()
                    .map(|n| directory.join(n))
                    .filter(|p| p.exists())
                    .collect();
                if !leftovers.is_empty() {
                    if self.should_delete_archives(self.download().as_ref()) {
                        for archive in &leftovers {
                            delete_archive_file(&self.db, archive);
                        }
                    } else {
                        // TODO(downloads): on-archive-deletion-prompt
                    }
                }
            }
        }
        if outer_archive.is_none() {
            self.clear_in_place_archives();
        }
        true
    }

    /// setExtractionComplete
    pub(crate) fn set_extraction_complete(&self) {
        let Some(mut download) = self.download() else {
            return;
        };
        // TODO(downloads): hasInstaller, classics disc linking.
        download.insert("extracting".into(), json!(false));
        layout::put(&self.db, &download);
        self.manager.emit_event(Event::Updated);
        // installedSizeInBytes
        if let (Some(base), Some(folder)) = (
            text(&download, "downloadPath"),
            text(&download, "folderName"),
        ) {
            let size = directory_size(&Path::new(&base).join(folder));
            let _ = hydra_core::library_actions::update_game_record(&self.db, &self.id, |game| {
                game.insert("installedSizeInBytes".into(), json!(size));
            });
        }
        self.manager.bind_executable(&self.id);
        self.manager.emit_event(Event::ExtractionComplete {
            game_id: self.id.clone(),
        });
        self.last_update.set(None);
        self.last_value.set(0.0);
    }

    /// handleExtraction (download-manager.ts): what kind of thing came down.
    pub(crate) fn handle(&self) {
        let Some(download) = self.download() else {
            return;
        };
        let Some(folder) = text(&download, "folderName") else {
            self.fail(
                "No downloaded file was found to extract",
                None,
                Failure::FileNotFound,
            );
            return;
        };
        let path = Path::new(&text(&download, "downloadPath").unwrap_or_default()).join(&folder);
        let Ok(meta) = std::fs::metadata(&path) else {
            self.fail(
                "No downloaded file was found to extract",
                Some(&path),
                Failure::FileNotFound,
            );
            return;
        };
        let lower = folder.to_lowercase();
        if meta.is_file()
            && hydra_archive::FILE_EXTENSIONS_TO_EXTRACT
                .iter()
                .any(|ext| lower.ends_with(ext))
        {
            self.extract_downloaded_file();
        } else if meta.is_dir() {
            if self.extract_files_in_directory(&path, None) {
                self.set_extraction_complete();
            }
        } else {
            // handleUnsupportedExtraction({ notify: false })
            self.manager.bind_executable(&self.id);
            eprintln!(
                "[GameFilesManager] Skipped extracting unsupported file {}",
                path.display()
            );
            self.reset_extracting_state();
        }
    }
}

fn is_part_rar(name: &str) -> bool {
    // /part\d+\.rar$/i
    let Some(stem) = name.strip_suffix(".rar") else {
        return false;
    };
    let digits = stem.len() - stem.trim_end_matches(|c: char| c.is_ascii_digit()).len();
    digits > 0 && stem[..stem.len() - digits].ends_with("part")
}

/// /part0*1\.rar$/i (multi-part hoster downloads) or /part1\.rar$/i
fn first_part_regex(name: &str, leading_zeros: bool) -> bool {
    let Some(stem) = name.strip_suffix(".rar") else {
        return false;
    };
    let digits_len = stem.len() - stem.trim_end_matches(|c: char| c.is_ascii_digit()).len();
    if digits_len == 0 || !stem[..stem.len() - digits_len].ends_with("part") {
        return false;
    }
    let digits = &stem[stem.len() - digits_len..];
    if leading_zeros {
        digits.trim_start_matches('0') == "1"
    } else {
        digits == "1"
    }
}

/// listArchiveFiles: files (not folders) at the root with an archive extension.
fn list_archive_files(directory: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| {
            let lower = name.to_lowercase();
            hydra_archive::FILE_EXTENSIONS_TO_EXTRACT
                .iter()
                .any(|ext| lower.ends_with(ext))
        })
        .collect()
}

/// deleteArchiveFile: remove it and clear the installer size of its download.
fn delete_archive_file(db: &Db, file: &Path) {
    if file.exists() {
        match std::fs::remove_file(file) {
            Ok(()) => eprintln!("Deleted archive: {}", file.display()),
            Err(error) => eprintln!("Could not delete {}: {error}", file.display()),
        }
    }
    for download in layout::all(db) {
        let (Some(base), Some(folder)) = (
            text(&download, "downloadPath"),
            text(&download, "folderName"),
        ) else {
            continue;
        };
        if Path::new(&base).join(&folder) == file {
            let id = layout::id(&download);
            let _ = hydra_core::library_actions::update_game_record(db, &id, |game| {
                game.insert("installerSizeInBytes".into(), Value::Null);
            });
        }
    }
}

/// getDirectorySize
pub fn directory_size(path: &Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return 0;
    };
    if meta.is_file() {
        return meta.len();
    }
    if !meta.is_dir() {
        return 0;
    }
    std::fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|e| directory_size(&e.path()))
                .sum()
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rar_volumes() {
        assert!(is_part_rar("game.part2.rar"));
        assert!(!is_part_rar("game.rar"));
        assert!(first_part_regex("game.part1.rar", false));
        assert!(!first_part_regex("game.part01.rar", false));
        assert!(first_part_regex("game.part01.rar", true));
        assert!(!first_part_regex("game.part10.rar", true));
    }
}
