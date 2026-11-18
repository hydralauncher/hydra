//! The batch helpers of js-http-downloader-helpers.ts and the per-file
//! progress records (`Download.files`) batches keep.

use serde_json::{Value, json};

/// INCOMPLETE_BATCH_PROGRESS_LIMIT: 100% only once the last file is banked.
pub const INCOMPLETE_BATCH_PROGRESS_LIMIT: f64 = 0.9999;
const BATCH_SPEED_SAMPLE_INTERVAL_SECONDS: f64 = 1.0;

/// DownloadFile
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DownloadFile {
    pub index: i64,
    pub path: String,
    pub size: u64,
    pub bytes_downloaded: u64,
    pub completed: bool,
}

impl DownloadFile {
    pub fn to_json(&self) -> Value {
        json!({
            "index": self.index,
            "path": self.path,
            "size": self.size,
            "bytesDownloaded": self.bytes_downloaded,
            "completed": self.completed,
        })
    }

    pub fn from_json(value: &Value) -> Option<DownloadFile> {
        Some(DownloadFile {
            index: value.get("index")?.as_f64()? as i64,
            path: value
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            size: value.get("size").and_then(Value::as_f64).unwrap_or(0.0) as u64,
            bytes_downloaded: value
                .get("bytesDownloaded")
                .and_then(Value::as_f64)
                .unwrap_or(0.0) as u64,
            completed: value
                .get("completed")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        })
    }
}

/// `download.files`
pub fn files_of(download: &serde_json::Map<String, Value>) -> Vec<DownloadFile> {
    download
        .get("files")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(DownloadFile::from_json).collect())
        .unwrap_or_default()
}

pub fn files_json(files: &[DownloadFile]) -> Value {
    Value::Array(files.iter().map(DownloadFile::to_json).collect())
}

/// getJsBatchProgress: (currentBytes, progress)
pub fn batch_progress(
    current_index: usize,
    active_index: Option<usize>,
    completed_bytes: u64,
    total_bytes: u64,
    entry_count: usize,
    file_bytes: u64,
    file_progress: f64,
) -> (u64, f64) {
    let active = active_index == Some(current_index);
    let current_bytes = if active { file_bytes } else { 0 };
    let current_progress = if active { file_progress } else { 0.0 };
    let progress = if total_bytes > 0 {
        (completed_bytes + current_bytes) as f64 / total_bytes as f64
    } else {
        (current_index as f64 + current_progress) / entry_count.max(1) as f64
    };
    (
        current_bytes,
        progress.clamp(0.0, INCOMPLETE_BATCH_PROGRESS_LIMIT),
    )
}

/// JsBatchSpeedSample
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpeedSample {
    /// Milliseconds.
    pub last_update: f64,
    pub bytes_at_last_update: Option<u64>,
    pub speed: f64,
}

impl SpeedSample {
    pub fn new(now_ms: f64, bytes: Option<u64>) -> SpeedSample {
        SpeedSample {
            last_update: now_ms,
            bytes_at_last_update: bytes,
            speed: 0.0,
        }
    }
}

/// sampleJsBatchSpeed: the speed over the whole batch, so small files don't
/// reset the reading.
pub fn sample_speed(
    previous: SpeedSample,
    bytes: u64,
    file_speed: f64,
    now_ms: f64,
) -> SpeedSample {
    match previous.bytes_at_last_update {
        Some(at) if bytes >= at => {
            let elapsed = (now_ms - previous.last_update) / 1000.0;
            if elapsed < BATCH_SPEED_SAMPLE_INTERVAL_SECONDS {
                return previous;
            }
            SpeedSample {
                last_update: now_ms,
                bytes_at_last_update: Some(bytes),
                speed: ((bytes - at) as f64 / elapsed).max(0.0),
            }
        }
        _ => SpeedSample {
            last_update: now_ms,
            bytes_at_last_update: Some(bytes),
            speed: file_speed.max(0.0),
        },
    }
}

pub fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_holds_below_one_until_banked() {
        assert_eq!(
            batch_progress(1, Some(1), 50, 100, 2, 50, 1.0),
            (50, 0.9999)
        );
        assert_eq!(batch_progress(1, Some(1), 50, 100, 2, 25, 0.5), (25, 0.75));
        // Before the next file starts, its bytes don't count.
        assert_eq!(batch_progress(1, Some(0), 50, 100, 2, 999, 1.0), (0, 0.5));
        // Unknown totals use the file count.
        assert_eq!(batch_progress(1, Some(1), 0, 0, 4, 0, 0.5).1, 0.375);
    }

    #[test]
    fn speed_samples_once_a_second() {
        let start = SpeedSample::new(0.0, None);
        let first = sample_speed(start, 100, 7.0, 0.0);
        assert_eq!(first.speed, 7.0);
        let same = sample_speed(first, 600, 0.0, 500.0);
        assert_eq!(same, first);
        let next = sample_speed(first, 2100, 0.0, 2000.0);
        assert_eq!(next.speed, 1000.0);
        // Fewer bytes (a restarted file) resets the sample.
        assert_eq!(sample_speed(next, 10, 3.0, 2500.0).speed, 3.0);
    }

    #[test]
    fn files_round_trip() {
        let file = DownloadFile {
            index: 3,
            path: "G/a.bin".into(),
            size: 10,
            bytes_downloaded: 4,
            completed: false,
        };
        assert_eq!(DownloadFile::from_json(&file.to_json()), Some(file));
    }
}
