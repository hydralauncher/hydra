use std::path::Path;

use filetime::{set_file_mtime, FileTime};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct RestoreTimestamp {
    unix_seconds: i64,
    nanoseconds: u32,
}

impl RestoreTimestamp {
    pub fn as_file_time(self) -> FileTime {
        FileTime::from_unix_time(self.unix_seconds, self.nanoseconds)
    }
}

pub fn parse_last_modified_at(value: &str) -> Result<RestoreTimestamp, String> {
    let timestamp = OffsetDateTime::parse(value, &Rfc3339)
        .map_err(|_| "cloud_save_invalid_last_modified_at".to_string())?;
    Ok(RestoreTimestamp {
        unix_seconds: timestamp.unix_timestamp(),
        nanoseconds: timestamp.nanosecond(),
    })
}

pub fn read_mtime(path: &Path) -> Result<FileTime, String> {
    std::fs::metadata(path)
        .map(|metadata| FileTime::from_last_modification_time(&metadata))
        .map_err(|_| "cloud_save_restore_read_mtime_failed".to_string())
}

pub fn write_mtime(path: &Path, timestamp: FileTime) -> Result<(), String> {
    set_file_mtime(path, timestamp).map_err(|_| "cloud_save_restore_set_mtime_failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_utc_and_offset_as_the_same_instant() {
        assert_eq!(
            parse_last_modified_at("2026-07-23T10:00:00.123Z").unwrap(),
            parse_last_modified_at("2026-07-23T07:00:00.123-03:00").unwrap()
        );
    }

    #[test]
    fn rejects_invalid_timestamp() {
        assert!(parse_last_modified_at("2026-07-23 10:00:00").is_err());
    }
}
