//! The `Intl.DateTimeFormat` output the leaderboards page shows, for UTC
//! dates: week ranges (`formatRange` with `{ day: "numeric", month: "short" }`),
//! month and weekday labels and the heatmap's cell dates. The patterns and
//! names come from ICU through tools/export-intl-dates.mjs
//! (data/intl-dates.json); Persian (`fa`) dates use the Persian calendar like
//! Chromium does.

use std::sync::OnceLock;

use chrono::{DateTime, Datelike};
use serde_json::Value;

static DATA: &str = include_str!("../data/intl-dates.json");

fn tables() -> &'static Value {
    static TABLES: OnceLock<Value> = OnceLock::new();
    TABLES.get_or_init(|| serde_json::from_str(DATA).unwrap_or_default())
}

/// The language's table: the exact code, then its base language, then `en`.
fn table(language: &str) -> &'static Value {
    let all = tables();
    let base = language.split(['-', '_']).next().unwrap_or("en");
    [language, base, "en"]
        .into_iter()
        .map(|code| &all[code])
        .find(|t| t.is_object())
        .unwrap_or(&Value::Null)
}

fn name(table: &Value, list: &str, index: usize) -> String {
    table[list][index].as_str().unwrap_or_default().to_string()
}

/// A calendar date: year, month (1-12), day (1-31), weekday (0 = Monday).
#[derive(Clone, Copy, Debug, PartialEq)]
struct CalendarDate {
    year: i64,
    month: usize,
    day: usize,
    weekday: usize,
}

fn gregorian(ms: i64) -> CalendarDate {
    let date = DateTime::from_timestamp_millis(ms)
        .unwrap_or_default()
        .date_naive();
    CalendarDate {
        year: date.year() as i64,
        month: date.month() as usize,
        day: date.day() as usize,
        weekday: date.weekday().num_days_from_monday() as usize,
    }
}

// jalaali-js (the algorithm ICU's Persian calendar agrees with for these years).
fn div(a: i64, b: i64) -> i64 {
    a / b
}

fn rem(a: i64, b: i64) -> i64 {
    a - (a / b) * b
}

const BREAKS: [i64; 20] = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324,
    2394, 2456, 3178,
];

/// (leap, gregorian year, March day of Farvardin 1) for a Persian year.
fn jal_cal(jy: i64) -> (i64, i64, i64) {
    let gy = jy + 621;
    let mut leap_j = -14;
    let mut jp = BREAKS[0];
    let mut jump = 0;
    for &jm in &BREAKS[1..] {
        jump = jm - jp;
        if jy < jm {
            break;
        }
        leap_j += div(jump, 33) * 8 + div(rem(jump, 33), 4);
        jp = jm;
    }
    let mut n = jy - jp;
    leap_j += div(n, 33) * 8 + div(rem(n, 33) + 3, 4);
    if rem(jump, 33) == 4 && jump - n == 4 {
        leap_j += 1;
    }
    let leap_g = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    let march = 20 + leap_j - leap_g;
    if jump - n < 6 {
        n = n - jump + div(jump + 4, 33) * 33;
    }
    let mut leap = rem(rem(n + 1, 33) - 1, 4);
    if leap == -1 {
        leap = 4;
    }
    (leap, gy, march)
}

/// Julian day number of a Gregorian date.
fn g2d(gy: i64, gm: i64, gd: i64) -> i64 {
    let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * rem(gm + 9, 12) + 2, 5) + gd
        - 34840408;
    d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752
}

fn persian(ms: i64) -> CalendarDate {
    let g = gregorian(ms);
    let jdn = g2d(g.year, g.month as i64, g.day as i64);
    let mut jy = g.year - 621;
    let (leap, _, march) = jal_cal(jy);
    let mut k = jdn - g2d(g.year, 3, march);
    let (month, day);
    if k >= 0 {
        if k <= 185 {
            month = 1 + div(k, 31);
            day = rem(k, 31) + 1;
            return CalendarDate {
                year: jy,
                month: month as usize,
                day: day as usize,
                weekday: g.weekday,
            };
        }
        k -= 186;
    } else {
        jy -= 1;
        k += 179;
        if leap == 1 {
            k += 1;
        }
    }
    month = 7 + div(k, 30);
    day = rem(k, 30) + 1;
    CalendarDate {
        year: jy,
        month: month as usize,
        day: day as usize,
        weekday: g.weekday,
    }
}

fn date_in(table: &Value, ms: i64) -> CalendarDate {
    if table["calendar"].as_str() == Some("persian") {
        persian(ms)
    } else {
        gregorian(ms)
    }
}

/// A number in the language's numerals (`digits`, e.g. "۰۱۲…" for fa).
fn digits(table: &Value, value: i64) -> String {
    let numerals: Vec<char> = table["digits"]
        .as_str()
        .unwrap_or("0123456789")
        .chars()
        .collect();
    value
        .to_string()
        .chars()
        .map(|c| {
            c.to_digit(10)
                .and_then(|d| numerals.get(d as usize).copied())
                .unwrap_or(c)
        })
        .collect()
}

fn fill(template: &str, values: &[(&str, String)]) -> String {
    let mut out = template.to_string();
    for (key, value) in values {
        out = out.replace(&format!("{{{key}}}"), value);
    }
    out
}

/// `new Intl.DateTimeFormat(language, { day: "numeric", month: "short",
/// timeZone: "UTC" }).formatRange(start, end)`: "Nov 2 – 8".
pub fn week_range(language: &str, start_ms: i64, end_ms: i64) -> String {
    let table = table(language);
    let (a, b) = (date_in(table, start_ms), date_in(table, end_ms));
    let template = if a.year != b.year {
        "range_cross_year"
    } else if a.month != b.month {
        "range_cross"
    } else {
        "range_same"
    };
    let day = |d: usize| name(table, "range_days", d - 1);
    let month = |m: usize| name(table, "range_months", m - 1);
    fill(
        table[template].as_str().unwrap_or_default(),
        &[
            ("d1", day(a.day)),
            ("d2", day(b.day)),
            ("m1", month(a.month)),
            ("m2", month(b.month)),
            ("y1", digits(table, a.year)),
            ("y2", digits(table, b.year)),
        ],
    )
}

/// `{ month: "short", timeZone: "UTC" }`: "Nov".
pub fn month_short(language: &str, ms: i64) -> String {
    let table = table(language);
    name(table, "months", date_in(table, ms).month - 1)
}

/// `{ weekday: "short", timeZone: "UTC" }` for a weekday (0 = Monday): "Mon".
pub fn weekday_short(language: &str, weekday: usize) -> String {
    name(table(language), "weekdays", weekday.min(6))
}

/// `{ weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }`:
/// "Sun, Nov 8".
pub fn day_label(language: &str, ms: i64) -> String {
    let table = table(language);
    let date = date_in(table, ms);
    fill(
        table["cell"].as_str().unwrap_or_default(),
        &[
            ("w", name(table, "cell_weekdays", date.weekday)),
            ("d", digits(table, date.day as i64)),
            ("m", name(table, "cell_months", date.month - 1)),
        ],
    )
}

/// Month and weekday names are lower case in some locales (pt-BR "nov."):
/// `text.charAt(0).toLocaleUpperCase(locale) + text.slice(1)`.
pub fn capitalize(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Generated with Node's ICU (the same data Chromium uses).
    #[test]
    fn week_ranges_match_intl() {
        let cases = [
            (
                "en",
                1793577600000,
                1794096000000,
                "Nov 2\u{2009}–\u{2009}8",
            ),
            (
                "en",
                1792972800000,
                1793491200000,
                "Oct 26\u{2009}–\u{2009}Nov 1",
            ),
            (
                "en",
                1766966400000,
                1767484800000,
                "Dec 29, 2025\u{2009}–\u{2009}Jan 4, 2026",
            ),
            (
                "pt-BR",
                1792972800000,
                1793491200000,
                "26 de out.\u{2009}–\u{2009}1 de nov.",
            ),
            ("ja", 1767571200000, 1768089600000, "01/05～01/11"),
            ("fa", 1793577600000, 1794096000000, "۱۱ آبان تا ۱۷ آبان"),
            ("fa", 1773619200000, 1774137600000, "۲۵ اسفند تا ۲ فروردین"),
            ("de", 1772409600000, 1772928000000, "2.–8. März"),
        ];
        for (language, start, end, expected) in cases {
            assert_eq!(week_range(language, start, end), expected, "{language}");
        }
    }

    #[test]
    fn labels_match_intl() {
        assert_eq!(month_short("en", 1793577600000), "Nov");
        assert_eq!(month_short("pt-BR", 1792972800000), "out.");
        assert_eq!(month_short("fa", 1773619200000), "اسفند");
        assert_eq!(day_label("en", 1794096000000), "Sun, Nov 8");
        assert_eq!(day_label("pt-BR", 1793491200000), "dom., 1 de nov.");
        assert_eq!(day_label("ja", 1768089600000), "1月11日(日)");
        assert_eq!(day_label("fa", 1794096000000), "یکشنبه ۱۷ آبان");
        assert_eq!(day_label("de", 1772928000000), "So., 8. März");
        assert_eq!(weekday_short("en", 0), "Mon");
        assert_eq!(capitalize("nov."), "Nov.");
    }
}
