use std::io::{self, Read};
use std::path::PathBuf;
use std::sync::Arc;

/// Files bigger than this are never read whole; parsers that need them must ask for a prefix.
pub const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone)]
pub enum FileContent {
    Path(PathBuf),
    Bytes(Arc<[u8]>),
}

/// One file of a cloud save snapshot, named the way the snapshot names it.
#[derive(Debug, Clone)]
pub struct SaveFile {
    pub raw_path: String,
    pub relative_path: String,
    pub size: u64,
    pub modified_at_ms: Option<i64>,
    pub content: FileContent,
}

impl SaveFile {
    pub fn from_bytes(raw_path: &str, relative_path: &str, bytes: impl Into<Arc<[u8]>>) -> Self {
        let bytes = bytes.into();
        Self {
            raw_path: raw_path.to_owned(),
            relative_path: relative_path.to_owned(),
            size: bytes.len() as u64,
            modified_at_ms: None,
            content: FileContent::Bytes(bytes),
        }
    }

    pub fn file_name(&self) -> &str {
        self.relative_path
            .rsplit('/')
            .next()
            .unwrap_or(&self.relative_path)
    }

    pub fn parent_dir(&self) -> &str {
        self.relative_path
            .rsplit_once('/')
            .map_or("", |(dir, _)| dir)
    }

    pub fn read(&self) -> io::Result<Vec<u8>> {
        self.read_prefix(MAX_READ_BYTES)
    }

    pub fn read_prefix(&self, limit: u64) -> io::Result<Vec<u8>> {
        match &self.content {
            FileContent::Bytes(bytes) => {
                let end = bytes
                    .len()
                    .min(usize::try_from(limit).unwrap_or(usize::MAX));
                Ok(bytes[..end].to_vec())
            }
            FileContent::Path(path) => {
                let mut buffer = Vec::new();
                std::fs::File::open(path)?
                    .take(limit)
                    .read_to_end(&mut buffer)?;
                Ok(buffer)
            }
        }
    }
}
