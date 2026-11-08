//! Reads the Electron renderer's `localStorage` (Chromium keeps it in
//! `<userData>/Local Storage/leveldb`). The renderer stores UI state there:
//! `sidebarWidth`, sidebar and library filters, cached `userDetails`, …
//!
//! Chromium's encoding: keys are `_<origin>\0<string>` and values are
//! `<string>`, where `<string>` is `\x01` + Latin-1 bytes or `\x00` + UTF-16LE.

use std::collections::BTreeMap;
use std::path::Path;

use rusty_leveldb::{DB, LdbIterator, Options};

use crate::{Error, Result};

fn decode(bytes: &[u8]) -> Option<String> {
    let (&tag, rest) = bytes.split_first()?;
    match tag {
        1 => Some(rest.iter().map(|&b| b as char).collect()),
        0 => {
            let units: Vec<u16> = rest
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect();
            String::from_utf16(&units).ok()
        }
        _ => None,
    }
}

/// Every `localStorage` entry for `origin` (`file://` for packaged builds,
/// `http://localhost:5173` for `yarn dev`). The folder is copied first,
/// because Chromium holds the database lock while Electron runs.
pub fn read(leveldb_dir: &Path, origin: &str) -> Result<BTreeMap<String, String>> {
    let scratch = std::env::temp_dir().join(format!(
        "hydra-local-storage-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&scratch);
    copy_dir_without_lock(leveldb_dir, &scratch)?;
    let result = read_unlocked(&scratch, origin);
    let _ = std::fs::remove_dir_all(&scratch);
    result
}

fn read_unlocked(dir: &Path, origin: &str) -> Result<BTreeMap<String, String>> {
    let options = Options {
        create_if_missing: false,
        ..Options::default()
    };
    let mut db = DB::open(dir, options)?;
    let mut iter = db.new_iter()?;
    let prefix = format!("_{origin}\0").into_bytes();
    iter.seek(&prefix);
    let mut out = BTreeMap::new();
    while iter.valid() {
        let Some((key, value)) = iter.current() else { break };
        if !key.starts_with(&prefix) {
            break;
        }
        if let (Some(k), Some(v)) = (decode(&key[prefix.len()..]), decode(&value)) {
            out.insert(k, v);
        }
        if !iter.advance() {
            break;
        }
    }
    Ok(out)
}

pub(crate) fn copy_dir_without_lock(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to).map_err(|e| Error(format!("{}: {e}", to.display())))?;
    let entries = std::fs::read_dir(from).map_err(|e| Error(format!("{}: {e}", from.display())))?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name == "LOCK" {
            continue;
        }
        let path = entry.path();
        if path.is_file() {
            std::fs::copy(&path, to.join(&name))
                .map_err(|e| Error(format!("{}: {e}", path.display())))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_both_string_forms() {
        assert_eq!(decode(b"\x01250").as_deref(), Some("250"));
        let utf16: Vec<u8> = std::iter::once(0u8)
            .chain("ção".encode_utf16().flat_map(|u| u.to_le_bytes()))
            .collect();
        assert_eq!(decode(&utf16).as_deref(), Some("ção"));
    }
}
