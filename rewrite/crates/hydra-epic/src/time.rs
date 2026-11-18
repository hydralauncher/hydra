//! `Date.now()` and `Date.parse()` for the ISO timestamps Epic, Legendary and
//! the Hydra API send.

use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

/// `Date.parse(text)` for ISO 8601 date-times (`Z` or an offset; a missing
/// zone is read as UTC). `None` is `NaN`.
pub fn parse_ms(text: &str) -> Option<i64> {
    let text = text.trim();
    if let Ok(date) = chrono::DateTime::parse_from_rfc3339(text) {
        return Some(date.timestamp_millis());
    }
    for format in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
    ] {
        if let Ok(date) = chrono::NaiveDateTime::parse_from_str(text, format) {
            return Some(date.and_utc().timestamp_millis());
        }
    }
    chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|d| d.and_utc().timestamp_millis())
}

/// `new Date(ms).toISOString()`
pub fn iso(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .unwrap_or_default()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_epic_dates() {
        assert_eq!(parse_ms("1970-01-01T00:00:01.000Z"), Some(1000));
        assert_eq!(parse_ms("1970-01-01T01:00:00+01:00"), Some(0));
        assert_eq!(parse_ms("1970-01-01T00:00:02"), Some(2000));
        assert_eq!(parse_ms("nope"), None);
        assert_eq!(iso(1500), "1970-01-01T00:00:01.500Z");
    }
}
