//! screenshots/screenshots-root-marker.ts: a hidden `.hydra-screenshots` file
//! with a UUID in the screenshots folder. A missing screenshot only counts as
//! deleted when the folder it was saved to (same marker) is still there, so
//! an unplugged drive doesn't wipe the list.

use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const ROOT_MARKER_FILE_NAME: &str = ".hydra-screenshots";

static HIDDEN: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);
/// pendingMarkerIds: one resolution per folder at a time
static RESOLVING: Mutex<()> = Mutex::new(());

fn marker_path(root: &Path) -> PathBuf {
    root.join(ROOT_MARKER_FILE_NAME)
}

fn parse_marker_id(content: &str) -> Option<String> {
    let id = content.trim();
    let bytes = id.as_bytes();
    let valid = bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        });
    valid.then(|| id.to_string())
}

/// readRootMarkerId
pub fn read_root_marker_id(root: &Path) -> Option<String> {
    let content = std::fs::read_to_string(marker_path(root)).ok()?;
    parse_marker_id(&content)
}

fn write_marker_id(file: &mut File) -> std::io::Result<()> {
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(uuid::Uuid::new_v4().to_string().as_bytes())?;
    file.sync_all()
}

/// hideMarkerFile: `attrib +h` once per run (Windows).
fn hide_marker(path: &Path) {
    #[cfg(windows)]
    {
        let mut hidden = HIDDEN.lock().unwrap_or_else(|e| e.into_inner());
        let set = hidden.get_or_insert_with(HashSet::new);
        if !set.insert(path.to_path_buf()) {
            return;
        }
        let Some(system_root) =
            std::env::var_os("SystemRoot").or_else(|| std::env::var_os("windir"))
        else {
            return;
        };
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let attrib = PathBuf::from(system_root)
            .join("System32")
            .join("attrib.exe");
        let result = std::process::Command::new(attrib)
            .arg("+h")
            .arg(path)
            .creation_flags(CREATE_NO_WINDOW)
            .status();
        if let Err(error) = result {
            eprintln!(
                "Failed to hide the screenshots root marker {}: {error}",
                path.display()
            );
        }
    }
    #[cfg(not(windows))]
    let _ = (path, &HIDDEN);
}

enum Creation {
    Created,
    Exists,
    Failed,
}

fn create_marker(path: &Path) -> Creation {
    let mut file = match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => return Creation::Exists,
        Err(_) => return Creation::Failed,
    };
    if write_marker_id(&mut file).is_err() {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Creation::Failed;
    }
    Creation::Created
}

/// repairMarkerFile: a marker without a valid id gets a new one.
fn repair_marker(path: &Path) -> std::io::Result<()> {
    let mut file = OpenOptions::new().read(true).write(true).open(path)?;
    let mut content = String::new();
    let _ = file.read_to_string(&mut content);
    if parse_marker_id(&content).is_none() {
        write_marker_id(&mut file)?;
    }
    Ok(())
}

fn has_usable_marker(root: &Path, path: &Path) -> bool {
    if !path.metadata().is_ok_and(|m| m.is_file()) {
        return false;
    }
    read_root_marker_id(root).is_some() || repair_marker(path).is_ok()
}

/// ensureRootMarkerId: the folder's marker id, created when missing.
pub fn ensure_root_marker_id(root: &Path) -> Option<String> {
    let _resolving = RESOLVING.lock().unwrap_or_else(|e| e.into_inner());
    let path = marker_path(root);
    match create_marker(&path) {
        Creation::Failed => return None,
        Creation::Created => {
            if let Some(set) = HIDDEN.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                set.remove(&path);
            }
        }
        Creation::Exists => {
            if !has_usable_marker(root, &path) {
                return None;
            }
        }
    }
    hide_marker(&path);
    read_root_marker_id(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_reads_and_repairs_markers() {
        let dir = tempfile::tempdir().unwrap();
        let id = ensure_root_marker_id(dir.path()).unwrap();
        assert_eq!(
            read_root_marker_id(dir.path()).as_deref(),
            Some(id.as_str())
        );
        // stable across calls
        assert_eq!(
            ensure_root_marker_id(dir.path()).as_deref(),
            Some(id.as_str())
        );
        // a corrupt marker is repaired with a new id
        // (Windows refuses to truncate hidden files with CREATE_ALWAYS)
        let mut file = OpenOptions::new()
            .write(true)
            .open(marker_path(dir.path()))
            .unwrap();
        file.set_len(0).unwrap();
        file.write_all(b"garbage").unwrap();
        drop(file);
        let repaired = ensure_root_marker_id(dir.path()).unwrap();
        assert_ne!(repaired, id);
        assert!(parse_marker_id(&repaired).is_some());
        // a missing folder has no marker
        assert_eq!(ensure_root_marker_id(&dir.path().join("missing")), None);
    }
}
