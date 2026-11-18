//! Archive extraction (services/archive-extraction.ts, services/7zip.ts and
//! the addon's in-place extraction).
//!
//! In place, hatchzip cuts the archive back as files come out, so the disk
//! never holds the archive and the game in full at once. An archive it
//! refuses (a solid RAR, files already in the way, too little space) is
//! untouched and goes to 7-Zip. One it has started is never handed to 7-Zip,
//! since part of it is gone: hatchzip finishes it.

#[path = "../../../../native/hydra-native/src/in_place_extraction.rs"]
mod in_place_extraction;
pub mod seven_zip;

use std::path::Path;

pub use in_place_extraction::{InPlaceExtractionOptions, InPlaceExtractionResult};

/// ARCHIVE_PASSWORDS
pub const ARCHIVE_PASSWORDS: [&str; 2] = ["online-fix.me", "steamrip.com"];

/// FILE_EXTENSIONS_TO_EXTRACT (shared/constants.ts)
pub const FILE_EXTENSIONS_TO_EXTRACT: [&str; 4] = [".rar", ".zip", ".7z", ".tar"];

/// Whether an in-place journal lies next to the archive.
pub fn has_in_place_journal(archive: &Path) -> bool {
    in_place_extraction::in_place_journal_exists(archive.to_string_lossy().into_owned())
}

/// ArchiveExtractionRequest
pub struct Request<'a> {
    pub file: &'a Path,
    pub output: &'a Path,
    /// The archive is deleted afterwards anyway, so it may be consumed while extracting.
    pub in_place: bool,
    /// Hydra recorded starting an in-place extraction of this archive before.
    pub resume: bool,
    /// The IN_PLACE_ARCHIVE_EXTRACTION feature flag.
    pub in_place_enabled: bool,
}

/// extractArchive: in place when allowed and possible, else 7-Zip.
/// `record_start` runs before hatchzip touches the archive, `forget_start`
/// once it reports the archive untouched. Ok(true) when it extracted.
pub fn extract_archive(
    request: Request,
    record_start: &dyn Fn(),
    forget_start: &dyn Fn(),
    on_progress: &dyn Fn(f64),
) -> Result<bool, String> {
    let passwords: Vec<String> = ARCHIVE_PASSWORDS.iter().map(|p| p.to_string()).collect();
    let seven_zip = || {
        seven_zip::extract(request.file, request.output, &passwords, &|p| {
            on_progress(p / 100.0)
        })
    };
    let allow_fresh = request.in_place && !request.resume && request.in_place_enabled;
    if !request.resume && !allow_fresh {
        return seven_zip();
    }
    if allow_fresh {
        // A journal Hydra did not create may have come with the download.
        if has_in_place_journal(request.file) {
            eprintln!(
                "Extracting {} with 7-Zip, not in place: it has a journal Hydra did not create",
                request.file.display()
            );
            return seven_zip();
        }
        record_start();
    }
    // Progress from the engine thread goes through an mpsc channel drained here.
    let (tx, rx) = std::sync::mpsc::channel::<f64>();
    let options = InPlaceExtractionOptions {
        archive_path: request.file.to_string_lossy().into_owned(),
        output_path: request.output.to_string_lossy().into_owned(),
        passwords: passwords.clone(),
        allow_fresh,
        resume: request.resume,
    };
    let worker = std::thread::spawn(move || {
        in_place_extraction::extract_in_place(options, move |fraction| {
            let _ = tx.send(fraction);
        })
    });
    for fraction in rx {
        on_progress(fraction);
    }
    let result = worker
        .join()
        .map_err(|_| "in-place extraction crashed".to_string())?;
    match result.status.as_str() {
        "finished" => {
            eprintln!("Extracted {} in place", request.file.display());
            Ok(true)
        }
        "failed" => Err(format!(
            "In-place extraction of {} stopped: {}",
            request.file.display(),
            result.message.unwrap_or_default()
        )),
        _ => {
            // Nothing was started, so there is nothing for a retry to resume.
            forget_start();
            eprintln!(
                "Extracting {} with 7-Zip, not in place: {}",
                request.file.display(),
                result.message.unwrap_or_default()
            );
            seven_zip()
        }
    }
}
