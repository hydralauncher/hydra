//! Local data in the Electron app's own LevelDB layout, so the rewrite reads
//! what users already have.
//!
//! The Electron main process uses `classic-level` (C++ LevelDB) with JSON
//! values (`src/main/level/level.ts`). Top-level keys are plain strings
//! (`userPreferences`, `auth`, …) and sublevels prefix their keys the way
//! `abstract-level` does: `!<sublevel>!<key>` (`!games!steam:1030300`).
//! Key names are in [`keys`], ported from `src/main/level/sublevels/keys.ts`.
//!
//! The rewrite never writes the Electron database. On first run [`import`]
//! copies it (and the renderer's `localStorage`) into the rewrite's own
//! folder; from then on the copy is the rewrite's database.

pub mod import;
pub mod keys;
pub mod local_storage;
pub mod paths;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusty_leveldb::{DB, LdbIterator, Options};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

#[derive(Debug)]
pub struct Error(pub String);

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

impl From<rusty_leveldb::Status> for Error {
    fn from(status: rusty_leveldb::Status) -> Self {
        Error(format!("leveldb: {status}"))
    }
}

impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Error(format!("json: {error}"))
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// `abstract-level`'s sublevel key: `!name!key`.
pub fn sublevel_key(sublevel: &str, key: &str) -> String {
    format!("!{sublevel}!{key}")
}

fn sublevel_prefix(sublevel: &str) -> String {
    format!("!{sublevel}!")
}

/// One LevelDB, shared by every worker. LevelDB itself is single-writer, so
/// calls are serialized; each is a few microseconds.
pub struct Db {
    inner: Mutex<DB>,
    path: PathBuf,
}

impl Db {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        std::fs::create_dir_all(&path).map_err(|e| Error(format!("{}: {e}", path.display())))?;
        let options = Options {
            create_if_missing: true,
            ..Options::default()
        };
        let db = DB::open(&path, options)?;
        Ok(Db {
            inner: Mutex::new(db),
            path,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn get_raw(&self, key: &str) -> Option<Vec<u8>> {
        let mut db = self.inner.lock().ok()?;
        db.get(key.as_bytes()).map(|bytes| bytes.to_vec())
    }

    fn put_raw(&self, key: &str, value: &[u8]) -> Result<()> {
        let mut db = self.inner.lock().map_err(|_| Error("poisoned".into()))?;
        db.put(key.as_bytes(), value)?;
        db.flush()?;
        Ok(())
    }

    /// `db.get(key, { valueEncoding: "json" })` on the root level.
    pub fn get<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let bytes = self.get_raw(key)?;
        serde_json::from_slice(&bytes).ok()
    }

    /// `db.get(key, { valueEncoding: "utf8" })`: values stored as plain text.
    pub fn get_utf8(&self, key: &str) -> Option<String> {
        self.get_raw(key)
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
    }

    /// `db.put(key, value, { valueEncoding: "utf8" })`
    pub fn put_utf8(&self, key: &str, value: &str) -> Result<()> {
        self.put_raw(key, value.as_bytes())
    }

    pub fn get_value(&self, key: &str) -> Option<Value> {
        self.get(key)
    }

    pub fn put<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        self.put_raw(key, &serde_json::to_vec(value)?)
    }

    pub fn delete(&self, key: &str) -> Result<()> {
        let mut db = self.inner.lock().map_err(|_| Error("poisoned".into()))?;
        db.delete(key.as_bytes())?;
        db.flush()?;
        Ok(())
    }

    /// `sublevel.get(key)`.
    pub fn get_in<T: DeserializeOwned>(&self, sublevel: &str, key: &str) -> Option<T> {
        self.get(&sublevel_key(sublevel, key))
    }

    pub fn put_in<T: Serialize>(&self, sublevel: &str, key: &str, value: &T) -> Result<()> {
        self.put(&sublevel_key(sublevel, key), value)
    }

    pub fn delete_in(&self, sublevel: &str, key: &str) -> Result<()> {
        self.delete(&sublevel_key(sublevel, key))
    }

    /// `sublevel.iterator()`: every `(key, value)` in key order. Values that
    /// aren't valid JSON for `T` are skipped (logged), like a failed parse
    /// would skip an entry in the renderer.
    pub fn entries<T: DeserializeOwned>(&self, sublevel: &str) -> Result<Vec<(String, T)>> {
        let prefix = sublevel_prefix(sublevel);
        let raw = self.scan_prefix(prefix.as_bytes())?;
        let mut out = Vec::with_capacity(raw.len());
        for (key, value) in raw {
            let key = String::from_utf8_lossy(&key[prefix.len()..]).into_owned();
            match serde_json::from_slice::<T>(&value) {
                Ok(value) => out.push((key, value)),
                Err(err) => eprintln!("hydra-db: skipping {sublevel}/{key}: {err}"),
            }
        }
        Ok(out)
    }

    /// `sublevel.values()`.
    pub fn values<T: DeserializeOwned>(&self, sublevel: &str) -> Result<Vec<T>> {
        Ok(self
            .entries(sublevel)?
            .into_iter()
            .map(|(_, v)| v)
            .collect())
    }

    fn scan_prefix(&self, prefix: &[u8]) -> Result<Vec<(Vec<u8>, Vec<u8>)>> {
        let mut db = self.inner.lock().map_err(|_| Error("poisoned".into()))?;
        let mut iter = db.new_iter()?;
        iter.seek(prefix);
        let mut out = Vec::new();
        while iter.valid() {
            let Some((key, value)) = iter.current() else {
                break;
            };
            if !key.starts_with(prefix) {
                break;
            }
            out.push((key.to_vec(), value.to_vec()));
            if !iter.advance() {
                break;
            }
        }
        Ok(out)
    }

    /// Every top-level and sublevel key, for diagnostics.
    pub fn all_keys(&self) -> Result<Vec<String>> {
        Ok(self
            .scan_prefix(b"")?
            .into_iter()
            .map(|(k, _)| String::from_utf8_lossy(&k).into_owned())
            .collect())
    }

    /// `db.batch().write()`: every operation lands at once, or none does.
    pub fn write(&self, batch: Batch) -> Result<()> {
        if batch.len == 0 {
            return Ok(());
        }
        let mut db = self.inner.lock().map_err(|_| Error("poisoned".into()))?;
        db.write(batch.inner, false)?;
        db.flush()?;
        Ok(())
    }
}

/// `db.batch()` with `{ sublevel }` puts and dels.
#[derive(Default)]
pub struct Batch {
    inner: rusty_leveldb::WriteBatch,
    len: usize,
}

impl Batch {
    pub fn put_in<T: Serialize>(&mut self, sublevel: &str, key: &str, value: &T) -> Result<()> {
        let bytes = serde_json::to_vec(value)?;
        self.inner
            .put(sublevel_key(sublevel, key).as_bytes(), &bytes);
        self.len += 1;
        Ok(())
    }

    pub fn delete_in(&mut self, sublevel: &str, key: &str) {
        self.inner.delete(sublevel_key(sublevel, key).as_bytes());
        self.len += 1;
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Serialize, Deserialize, Debug, PartialEq)]
    struct Game {
        title: String,
        #[serde(rename = "objectId")]
        object_id: String,
    }

    #[test]
    fn root_and_sublevels() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("hydra-db")).unwrap();
        db.put(
            "userPreferences",
            &serde_json::json!({ "language": "pt-BR" }),
        )
        .unwrap();
        db.put_in(
            "games",
            "steam:1",
            &Game {
                title: "A".into(),
                object_id: "1".into(),
            },
        )
        .unwrap();
        db.put_in(
            "games",
            "steam:2",
            &Game {
                title: "B".into(),
                object_id: "2".into(),
            },
        )
        .unwrap();
        db.put_in(
            "downloads",
            "steam:1",
            &serde_json::json!({ "status": "paused" }),
        )
        .unwrap();

        let prefs: Value = db.get("userPreferences").unwrap();
        assert_eq!(prefs["language"], "pt-BR");
        let games: Vec<(String, Game)> = db.entries("games").unwrap();
        assert_eq!(games.len(), 2);
        assert_eq!(games[0].0, "steam:1");
        assert_eq!(games[1].1.title, "B");
        // Sublevels don't leak into each other.
        assert_eq!(db.values::<Value>("downloads").unwrap().len(), 1);
        db.delete_in("games", "steam:1").unwrap();
        assert_eq!(db.values::<Game>("games").unwrap().len(), 1);
    }

    #[test]
    fn batches_write_together() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("hydra-db")).unwrap();
        db.put_in("games", "steam:1", &serde_json::json!({ "title": "A" }))
            .unwrap();
        let mut batch = Batch::default();
        batch
            .put_in("games", "steam:2", &serde_json::json!({ "title": "B" }))
            .unwrap();
        batch
            .put_in("gameShopAssets", "steam:2", &serde_json::json!({ "x": 1 }))
            .unwrap();
        batch.delete_in("games", "steam:1");
        assert_eq!(batch.len(), 3);
        db.write(batch).unwrap();
        let games: Vec<(String, Value)> = db.entries("games").unwrap();
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].0, "steam:2");
        assert_eq!(db.values::<Value>("gameShopAssets").unwrap().len(), 1);
    }
}
