use std::env;
use std::fs;
use std::io;
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::Serialize;

#[derive(Clone)]
pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn load() -> io::Result<Store> {
        let base = env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        Store::at(base.join("hydralauncher").join("stream"))
    }

    pub fn at(dir: PathBuf) -> io::Result<Store> {
        fs::create_dir_all(&dir)?;
        Ok(Store { dir })
    }

    pub fn path(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    pub fn uuid(&self) -> io::Result<String> {
        let path = self.path("uuid");
        if let Ok(existing) = fs::read_to_string(&path) {
            let trimmed = existing.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }

        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes)
            .map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?;
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        let uuid = bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
        fs::write(&path, &uuid)?;
        Ok(uuid)
    }

    pub fn read_json<T: DeserializeOwned>(&self, name: &str) -> Option<T> {
        let contents = fs::read_to_string(self.path(name)).ok()?;
        serde_json::from_str(&contents).ok()
    }

    pub fn write_json<T: Serialize>(&self, name: &str, value: &T) -> io::Result<()> {
        let contents = serde_json::to_string_pretty(value).map_err(io::Error::other)?;
        // atomic: temp file + rename so a crash mid-write cannot leave a
        // truncated clients.json behind
        let target = self.path(name);
        let temp = self.path(&format!("{name}.tmp"));
        fs::write(&temp, contents)?;
        fs::rename(&temp, &target)
    }
}
