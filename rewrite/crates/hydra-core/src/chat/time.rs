//! `Date.parse` / `new Date(text)` as the chat code uses them: ISO strings
//! with an offset or `Z` are absolute, date-only strings are UTC, and
//! date-times without an offset are local time.

use chrono::{DateTime, NaiveDate, NaiveDateTime, TimeZone, Utc};

/// `new Date(text)` in `tz`; None where JS gives an Invalid Date.
pub fn parse_in<Tz: TimeZone>(text: &str, tz: &Tz) -> Option<DateTime<Tz>> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(date) = DateTime::parse_from_rfc3339(text) {
        return Some(date.with_timezone(tz));
    }
    if let Ok(date) = NaiveDate::parse_from_str(text, "%Y-%m-%d") {
        let midnight = date.and_hms_opt(0, 0, 0)?;
        return Some(Utc.from_utc_datetime(&midnight).with_timezone(tz));
    }
    for format in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M"] {
        if let Ok(local) = NaiveDateTime::parse_from_str(text, format) {
            return tz.from_local_datetime(&local).earliest();
        }
    }
    None
}

/// `Date.parse(text)` in milliseconds; None for NaN.
pub fn parse_ms(text: &str) -> Option<i64> {
    parse_in(text, &chrono::Local).map(|date| date.timestamp_millis())
}

/// `Date.parse(a) > Date.parse(b)`: false when either is NaN.
pub(crate) fn is_after(a: &str, b: &str) -> bool {
    matches!((parse_ms(a), parse_ms(b)), (Some(a), Some(b)) if a > b)
}

/// `Date.parse(a) - Date.parse(b)` as a sort comparator: NaN compares equal.
pub(crate) fn compare(a: &str, b: &str) -> std::cmp::Ordering {
    match (parse_ms(a), parse_ms(b)) {
        (Some(a), Some(b)) => a.cmp(&b),
        _ => std::cmp::Ordering::Equal,
    }
}

/// JS `Math.round`: halves round up, toward +∞.
pub(crate) fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// JS `\s` (and what `String.prototype.trim` removes).
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// `String.prototype.trim`.
pub fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_whitespace)
}

/// `text.replace(/\s+/g, " ").trim()`.
pub fn collapse_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_space = false;
    for c in text.chars() {
        if is_js_whitespace(c) {
            in_space = true;
            continue;
        }
        if in_space && !out.is_empty() {
            out.push(' ');
        }
        in_space = false;
        out.push(c);
    }
    out
}

/// `text.length`: UTF-16 code units.
pub fn js_length(text: &str) -> usize {
    text.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_like_date_parse() {
        let utc = parse_in("2026-10-05T12:00:00.000Z", &Utc).unwrap();
        assert_eq!(utc.timestamp_millis(), 1_791_201_600_000);
        let offset = chrono::FixedOffset::west_opt(3 * 3600).unwrap();
        let local = parse_in("2026-09-30T19:30:00", &offset).unwrap();
        assert_eq!(local.to_rfc3339(), "2026-09-30T19:30:00-03:00");
        assert_eq!(
            parse_in("2026-01-01", &Utc).unwrap().timestamp_millis(),
            1_767_225_600_000
        );
        assert!(parse_ms("").is_none());
        assert!(parse_ms("not a date").is_none());
    }

    #[test]
    fn trims_and_collapses_like_js() {
        assert_eq!(js_trim("\u{FEFF} hi \n"), "hi");
        assert_eq!(collapse_whitespace("  gg,\n\nrematch? "), "gg, rematch?");
        assert_eq!(js_length("👍a"), 3);
        assert_eq!(js_round(300.5), 301.0);
        assert_eq!(js_round(300.4), 300.0);
    }
}
