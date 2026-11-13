//! First run: copy the Electron app's data into the rewrite's folder.
//!
//! Users who switch keep their library, downloads, preferences, session and
//! UI state without doing anything. The Electron database is only read
//! (copied without its `LOCK`), so the Electron app keeps working.

use std::path::{Path, PathBuf};

use crate::local_storage::{self, copy_dir_without_lock};
use crate::{Db, Error, Result, keys};

/// What [`open_or_import`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Origin {
    /// The rewrite's database already existed.
    Existing,
    /// Copied from the Electron app's `<userData>/<db name>`.
    Imported {
        from: PathBuf,
        local_storage_entries: usize,
    },
    /// No Electron data found: a fresh install.
    Fresh,
}

/// Opens `<native>/<db name>`, importing from `<electron>/<db name>` first
/// when the rewrite has no database yet.
pub fn open_or_import(
    native_dir: &Path,
    electron_dir: Option<&Path>,
    db_name: &str,
) -> Result<(Db, Origin)> {
    let target = native_dir.join(db_name);
    if target.join("CURRENT").exists() {
        return Ok((Db::open(&target)?, Origin::Existing));
    }

    let source = electron_dir.map(|dir| dir.join(db_name));
    let Some(source) = source.filter(|s| s.join("CURRENT").exists()) else {
        return Ok((Db::open(&target)?, Origin::Fresh));
    };

    // Copy into a temporary folder and rename, so a crash mid-copy never
    // leaves a half-imported database that would be taken as "Existing".
    let staging = native_dir.join(format!("{db_name}.importing"));
    let _ = std::fs::remove_dir_all(&staging);
    copy_dir_without_lock(&source, &staging)?;
    std::fs::rename(&staging, &target).map_err(|e| Error(format!("{}: {e}", target.display())))?;
    let db = Db::open(&target)?;

    let mut local_storage_entries = 0;
    if let Some(electron_dir) = electron_dir {
        let dir = electron_dir.join("Local Storage").join("leveldb");
        if dir.exists() {
            // Packaged builds load `file://`; development builds `http://localhost:5173`.
            for origin in ["file://", "http://localhost:5173"] {
                match local_storage::read(&dir, origin) {
                    Ok(entries) if !entries.is_empty() => {
                        for (key, value) in &entries {
                            db.put_in(keys::LOCAL_STORAGE, key, value)?;
                        }
                        local_storage_entries = entries.len();
                        break;
                    }
                    Ok(_) => {}
                    Err(err) => eprintln!("hydra-db: localStorage import ({origin}): {err}"),
                }
            }
        }
    }

    Ok((
        db,
        Origin::Imported {
            from: source,
            local_storage_entries,
        },
    ))
}
