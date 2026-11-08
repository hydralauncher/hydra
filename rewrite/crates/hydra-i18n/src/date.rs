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
    Local
        .timestamp_millis_opt(ms)
        .single()
        .unwrap_or_else(Local::now)
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
    shifted = if sign > 0 {
        shifted - months
    } else {
        shifted + months
    };
    let mut last_month_not_full = (shifted.timestamp_millis() - right).signum() == -sign;
    if is_last_day_of_month(&l) && difference == 1 && left > right {
        last_month_not_full = false;
    }
    sign * (difference - last_month_not_full as i64)
}

/// `formatDistance(date, baseDate, { addSuffix })` with the language's date-fns locale.
pub fn format_distance(language: &str, date_ms: i64, base_ms: i64, add_suffix: bool) -> String {
    let comparison = (date_ms - base_ms).signum() as i32;
    let (later, earlier) = if comparison > 0 {
        (date_ms, base_ms)
    } else {
        (base_ms, date_ms)
    };
    let seconds = (later - earlier) / 1000;
    let offset_seconds =
        (tz_offset_minutes(&local(later)) - tz_offset_minutes(&local(earlier))) * 60;
    let minutes = ((seconds - offset_seconds) as f64 / 60.0).round() as i64;
    let suffix = add_suffix.then_some(comparison);
    let say = |token: &str, count: i64| render(language, token, count, suffix);

    const MINUTES_IN_DAY: i64 = 1440;
    const MINUTES_IN_ALMOST_TWO_DAYS: i64 = 2520;
    const MINUTES_IN_MONTH: i64 = 43200;
    if minutes < 2 {
        return if minutes < 1 {
            say("lessThanXMinutes", 1)
        } else {
            say("xMinutes", minutes)
        };
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
        return say(
            "xDays",
            (minutes as f64 / MINUTES_IN_DAY as f64).round() as i64,
        );
    }
    if minutes < MINUTES_IN_MONTH * 2 {
        return say(
            "aboutXMonths",
            (minutes as f64 / MINUTES_IN_MONTH as f64).round() as i64,
        );
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
            ('H', 1) => out.push_str(&format!("{}", d.hour())),
            ('h', 2) => out.push_str(&format!("{hour12:02}")),
            ('h', 1) => out.push_str(&format!("{hour12}")),
            ('m', 2) => out.push_str(&format!("{:02}", d.minute())),
            ('a', 1) => out.push_str(if pm { "PM" } else { "AM" }),
            _ => (0..run).for_each(|_| out.push(c)),
        }
        i += run;
    }
    out
}

/// date-fns `MMM` (formatting context) per getDateLocale (shared/index.ts).
const MONTHS_SHORT: &[(&str, [&str; 12])] = &[
    (
        "pt",
        [
            "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
        ],
    ),
    (
        "es",
        [
            "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic",
        ],
    ),
    (
        "fr",
        [
            "janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.",
            "nov.", "déc.",
        ],
    ),
    (
        "hu",
        [
            "jan.", "febr.", "márc.", "ápr.", "máj.", "jún.", "júl.", "aug.", "szept.", "okt.",
            "nov.", "dec.",
        ],
    ),
    (
        "pl",
        [
            "sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru",
        ],
    ),
    (
        "tr",
        [
            "Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
        ],
    ),
    (
        "ru",
        [
            "янв.",
            "фев.",
            "мар.",
            "апр.",
            "мая",
            "июн.",
            "июл.",
            "авг.",
            "сент.",
            "окт.",
            "нояб.",
            "дек.",
        ],
    ),
    (
        "it",
        [
            "gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic",
        ],
    ),
    (
        "be",
        [
            "студз.",
            "лют.",
            "сак.",
            "крас.",
            "мая",
            "чэрв.",
            "ліп.",
            "жн.",
            "вер.",
            "кастр.",
            "ліст.",
            "снеж.",
        ],
    ),
    (
        "zh",
        [
            "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月",
        ],
    ),
    (
        "da",
        [
            "jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.",
            "dec.",
        ],
    ),
    (
        "el",
        [
            "Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ",
        ],
    ),
    (
        "vi",
        [
            "thg 1", "thg 2", "thg 3", "thg 4", "thg 5", "thg 6", "thg 7", "thg 8", "thg 9",
            "thg 10", "thg 11", "thg 12",
        ],
    ),
    (
        "ja",
        [
            "1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月",
        ],
    ),
    (
        "sl",
        [
            "jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "avg.", "sep.", "okt.", "nov.",
            "dec.",
        ],
    ),
];
const MONTHS_SHORT_EN: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// description-header.tsx: a "YYYY-MM-DD" release date shown as
/// `format(date, "MMM d, yyyy", { locale })`; anything else is kept as is.
pub fn format_release_date(language: &str, raw: &str) -> String {
    let b = raw.as_bytes();
    let iso = b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && raw
            .chars()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
    if !iso {
        return raw.to_string();
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        raw[0..4].parse::<u32>(),
        raw[5..7].parse::<usize>(),
        raw[8..10].parse::<u32>(),
    ) else {
        return raw.to_string();
    };
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return raw.to_string();
    }
    let months = MONTHS_SHORT
        .iter()
        .find(|(p, _)| language.starts_with(p))
        .map(|(_, m)| m)
        .unwrap_or(&MONTHS_SHORT_EN);
    format!("{} {day}, {year}", months[month - 1])
}

/// `formatDateTime` (use-date.ts).
pub fn format_date_time(language: &str, date_ms: i64) -> String {
    format_pattern(
        date_ms,
        if language == "en" {
            "MM-dd-yyyy - hh:mm a"
        } else {
            "dd/MM/yyyy HH:mm"
        },
    )
}

/// formatAchievementUnlockDateTime: Intl day (2-digit, numeric year) and
/// timeStyle "short", joined by " · ". English and Intl's dotted/slashed
/// European orders; other locales fall back to day/month/year.
pub fn format_achievement_unlock(language: &str, date_ms: i64) -> String {
    let base = language
        .split(['-', '_'])
        .next()
        .unwrap_or("en")
        .to_lowercase();
    let pattern = match base.as_str() {
        "en" => "MM/dd/yyyy · h:mm a",
        "de" | "ru" | "uk" | "pl" | "cs" | "fi" | "nb" | "da" | "tr" | "ro" | "be" | "kk"
        | "bg" => "dd.MM.yyyy · HH:mm",
        "hu" => "yyyy. MM. dd. · H:mm",
        _ => "dd/MM/yyyy · HH:mm",
    };
    format_pattern(date_ms, pattern)
}

/// `formatDate` (shared/index.ts).
pub fn format_date(language: &str, date_ms: i64) -> String {
    format_pattern(
        date_ms,
        if language == "en" {
            "MM-dd-yyyy"
        } else {
            "dd/MM/yyyy"
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_dates() {
        assert_eq!(format_release_date("en-US", "2005-03-22"), "Mar 22, 2005");
        assert_eq!(format_release_date("pt-BR", "2005-03-02"), "mar 2, 2005");
        assert_eq!(format_release_date("en", "Sep 4, 2025"), "Sep 4, 2025");
    }

    const DAY: i64 = 86_400_000;

    #[test]
    fn distance_matches_date_fns_wording() {
        let now = 1_762_560_000_000; // 2025-11-08
        assert_eq!(
            format_distance("en", now - 20 * 1000, now, true),
            "less than a minute ago"
        );
        // Math.round(30s / 60) = 1, like date-fns.
        assert_eq!(
            format_distance("en", now - 30 * 1000, now, true),
            "1 minute ago"
        );
        assert_eq!(
            format_distance("en", now - 5 * 60_000, now, true),
            "5 minutes ago"
        );
        assert_eq!(
            format_distance("en", now - 3 * 3_600_000, now, true),
            "about 3 hours ago"
        );
        assert_eq!(
            format_distance("en", now - 3 * DAY, now, true),
            "3 days ago"
        );
        assert_eq!(
            format_distance("en", now - 240 * DAY, now, true),
            "8 months ago"
        );
        assert_eq!(
            format_distance("pt-BR", now - 240 * DAY, now, true),
            "há 8 meses"
        );
        // Expected values printed by date-fns 3.6 itself.
        assert_eq!(
            format_distance("en", now - 800 * DAY, now, true),
            "about 2 years ago"
        );
        assert_eq!(
            format_distance("en", now - 1000 * DAY, now, true),
            "over 2 years ago"
        );
        assert_eq!(
            format_distance("ru", now - 45 * DAY, now, true),
            "около 1 месяца назад"
        );
        assert_eq!(
            format_distance("ru", now - 5 * DAY, now, true),
            "5 дней назад"
        );
        // German isn't in getDateLocale: English wording.
        assert_eq!(
            format_distance("de", now - 3 * DAY, now, true),
            "3 days ago"
        );
    }
}
