//! date-fns 3 `formatDistance` and `format` as Hydra calls them
//! (src/renderer/src/hooks/use-date.ts, src/shared/index.ts getDateLocale).
//! The wording comes from date-fns' own locales, exported by
//! tools/export-date-locales.mjs into data/date-distance.json.

use std::sync::OnceLock;

use chrono::{DateTime, Datelike, Local, Months, TimeZone, Timelike};
use serde_json::Value;

static DATA: &str = include_str!("../data/date-distance.json");

fn tables() -> &'static Value {
    static TABLES: OnceLock<Value> = OnceLock::new();
    TABLES.get_or_init(|| serde_json::from_str(DATA).unwrap_or_default())
}

/// getDateLocale(language): prefix match in its order, enUS otherwise.
fn locale_name(language: &str) -> &'static str {
    const ORDER: &[(&str, &str)] = &[
        ("pt", "ptBR"),
        ("es", "es"),
        ("fr", "fr"),
        ("hu", "hu"),
        ("pl", "pl"),
        ("tr", "tr"),
        ("ru", "ru"),
        ("it", "it"),
        ("be", "be"),
        ("zh", "zhCN"),
        ("da", "da"),
        ("el", "el"),
        ("vi", "vi"),
        ("ja", "ja"),
        ("sl", "sl"),
    ];
    ORDER
        .iter()
        .find(|(prefix, _)| language.starts_with(prefix))
        .map(|(_, name)| *name)
        .unwrap_or("enUS")
}

fn render(language: &str, token: &str, count: i64, suffix: Option<i32>) -> String {
    let locale = &tables()["locales"][locale_name(language)];
    let table = match suffix {
        Some(c) if c > 0 => &locale["future"],
        Some(_) => &locale["past"],
        None => &locale["plain"],
    };
    let mut template = "";
    if let Some(runs) = table[token].as_array() {
        for run in runs {
            if count >= run[0].as_i64().unwrap_or(1) {
                template = run[1].as_str().unwrap_or_default();
            }
        }
    }
    template.replace("{n}", &count.to_string())
}

fn local(ms: i64) -> DateTime<Local> {
    Local.timestamp_millis_opt(ms).single().unwrap_or_else(Local::now)
}

/// JavaScript `getTimezoneOffset()` in minutes (UTC - local).
fn tz_offset_minutes(date: &DateTime<Local>) -> i64 {
    -(date.offset().local_minus_utc() as i64) / 60
}

fn is_last_day_of_month(date: &DateTime<Local>) -> bool {
    (*date + chrono::Duration::days(1)).month() != date.month()
}

/// date-fns `differenceInMonths(left, right)` on the local calendar.
fn difference_in_months(left: i64, right: i64) -> i64 {
    let (l, r) = (local(left), local(right));
    let sign: i64 = (left - right).signum();
    let calendar = (l.year() as i64 - r.year() as i64) * 12 + (l.month() as i64 - r.month() as i64);
    let difference = calendar.abs();
    if difference < 1 {
        return 0;
    }
    let mut shifted = l;
    if shifted.month() == 2 && shifted.day() > 27 {
        shifted = shifted.with_day(30).unwrap_or(shifted);
    }
    let months = Months::new(difference as u32);
    shifted = if sign > 0 { shifted - months } else { shifted + months };
    let mut last_month_not_full = (shifted.timestamp_millis() - right).signum() == -sign;
    if is_last_day_of_month(&l) && difference == 1 && left > right {
        last_month_not_full = false;
    }
    sign * (difference - last_month_not_full as i64)
}

/// `formatDistance(date, baseDate, { addSuffix })` with the language's date-fns locale.
pub fn format_distance(language: &str, date_ms: i64, base_ms: i64, add_suffix: bool) -> String {
    let comparison = (date_ms - base_ms).signum() as i32;
    let (later, earlier) = if comparison > 0 { (date_ms, base_ms) } else { (base_ms, date_ms) };
    let seconds = (later - earlier) / 1000;
    let offset_seconds = (tz_offset_minutes(&local(later)) - tz_offset_minutes(&local(earlier))) * 60;
    let minutes = ((seconds - offset_seconds) as f64 / 60.0).round() as i64;
    let suffix = add_suffix.then_some(comparison);
    let say = |token: &str, count: i64| render(language, token, count, suffix);

    const MINUTES_IN_DAY: i64 = 1440;
    const MINUTES_IN_ALMOST_TWO_DAYS: i64 = 2520;
    const MINUTES_IN_MONTH: i64 = 43200;
    if minutes < 2 {
        return if minutes < 1 { say("lessThanXMinutes", 1) } else { say("xMinutes", minutes) };
    }
    if minutes < 45 {
        return say("xMinutes", minutes);
    }
    if minutes < 90 {
        return say("aboutXHours", 1);
    }
    if minutes < MINUTES_IN_DAY {
        return say("aboutXHours", (minutes as f64 / 60.0).round() as i64);
    }
    if minutes < MINUTES_IN_ALMOST_TWO_DAYS {
        return say("xDays", 1);
    }
    if minutes < MINUTES_IN_MONTH {
        return say("xDays", (minutes as f64 / MINUTES_IN_DAY as f64).round() as i64);
    }
    if minutes < MINUTES_IN_MONTH * 2 {
        return say("aboutXMonths", (minutes as f64 / MINUTES_IN_MONTH as f64).round() as i64);
    }
    let months = difference_in_months(later, earlier);
    if months < 12 {
        let nearest = (minutes as f64 / MINUTES_IN_MONTH as f64).round() as i64;
        return say("xMonths", nearest.max(1));
    }
    let since_start_of_year = months % 12;
    let years = months / 12;
    if since_start_of_year < 3 {
        say("aboutXYears", years)
    } else if since_start_of_year < 9 {
        say("overXYears", years)
    } else {
        say("almostXYears", years + 1)
    }
}

/// date-fns `format(date, pattern)` for the numeric patterns Hydra uses
/// ("dd/MM/yyyy HH:mm", "MM-dd-yyyy - hh:mm a", "MM-dd-yyyy", "dd/MM/yyyy").
pub fn format_pattern(date_ms: i64, pattern: &str) -> String {
    let d = local(date_ms);
    let (pm, hour12) = d.hour12();
    let chars: Vec<char> = pattern.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let mut run = 1;
        while i + run < chars.len() && chars[i + run] == c {
            run += 1;
        }
        match (c, run) {
            ('d', 2) => out.push_str(&format!("{:02}", d.day())),
            ('M', 2) => out.push_str(&format!("{:02}", d.month())),
            ('y', 4) => out.push_str(&format!("{:04}", d.year())),
            ('H', 2) => out.push_str(&format!("{:02}", d.hour())),
            ('h', 2) => out.push_str(&format!("{hour12:02}")),
            ('m', 2) => out.push_str(&format!("{:02}", d.minute())),
            ('a', 1) => out.push_str(if pm { "PM" } else { "AM" }),
            _ => (0..run).for_each(|_| out.push(c)),
        }
        i += run;
    }
    out
}

/// `formatDateTime` (use-date.ts).
pub fn format_date_time(language: &str, date_ms: i64) -> String {
    format_pattern(date_ms, if language == "en" { "MM-dd-yyyy - hh:mm a" } else { "dd/MM/yyyy HH:mm" })
}

/// `formatDate` (shared/index.ts).
pub fn format_date(language: &str, date_ms: i64) -> String {
    format_pattern(date_ms, if language == "en" { "MM-dd-yyyy" } else { "dd/MM/yyyy" })
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 86_400_000;

    #[test]
    fn distance_matches_date_fns_wording() {
        let now = 1_762_560_000_000; // 2025-11-08
        assert_eq!(format_distance("en", now - 20 * 1000, now, true), "less than a minute ago");
        // Math.round(30s / 60) = 1, like date-fns.
        assert_eq!(format_distance("en", now - 30 * 1000, now, true), "1 minute ago");
        assert_eq!(format_distance("en", now - 5 * 60_000, now, true), "5 minutes ago");
        assert_eq!(format_distance("en", now - 3 * 3_600_000, now, true), "about 3 hours ago");
        assert_eq!(format_distance("en", now - 3 * DAY, now, true), "3 days ago");
        assert_eq!(format_distance("en", now - 240 * DAY, now, true), "8 months ago");
        assert_eq!(format_distance("pt-BR", now - 240 * DAY, now, true), "há 8 meses");
        // Expected values printed by date-fns 3.6 itself.
        assert_eq!(format_distance("en", now - 800 * DAY, now, true), "about 2 years ago");
        assert_eq!(format_distance("en", now - 1000 * DAY, now, true), "over 2 years ago");
        assert_eq!(format_distance("ru", now - 45 * DAY, now, true), "около 1 месяца назад");
        assert_eq!(format_distance("ru", now - 5 * DAY, now, true), "5 дней назад");
        // German isn't in getDateLocale: English wording.
        assert_eq!(format_distance("de", now - 3 * DAY, now, true), "3 days ago");
    }
}
