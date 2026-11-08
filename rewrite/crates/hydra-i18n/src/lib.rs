//! UI strings with i18next 23 semantics, read from the Electron app's own
//! `src/locales/*/translation.json` (the single source for both apps).
//!
//! Mirrors what the renderer configures in `src/renderer/src/main.tsx`:
//! `fallbackLng: "en"`, `escapeValue: false`, JSON v4 plural suffixes
//! (`_zero`, `_one`, `_few`, …) resolved with CLDR rules like
//! `Intl.PluralRules`, and `{{value, number}}` formatted like
//! `Intl.NumberFormat`.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::OnceLock;

use fixed_decimal::Decimal;
use icu_decimal::DecimalFormatter;
use icu_locale_core::Locale;
use icu_plurals::{PluralCategory, PluralRules};

pub mod date;

macro_rules! locales {
    ($($code:literal),* $(,)?) => {
        &[$(($code, include_str!(concat!("../../../../src/locales/", $code, "/translation.json")))),*]
    };
}

/// Every language the Electron app ships, in `src/locales/index.ts` order.
static SOURCES: &[(&str, &str)] = locales!(
    "pt-BR", "pt-PT", "en", "de", "el", "es", "nl", "fr", "hu", "it", "pl", "ru", "tr", "be", "uk",
    "zh", "id", "ko", "da", "ar", "fa", "fi", "ro", "ca", "bg", "kk", "cs", "nb", "et", "uz", "sv",
    "lv", "vi", "ja", "sl",
);

/// Language codes Hydra has translations for.
pub fn languages() -> impl Iterator<Item = &'static str> {
    SOURCES.iter().map(|(code, _)| *code)
}

/// Flattened `namespace.key` -> string for one language, parsed on first use.
struct Table {
    strings: HashMap<String, String>,
}

fn table(code: &str) -> Option<&'static Table> {
    static TABLES: OnceLock<Vec<OnceLock<Table>>> = OnceLock::new();
    let tables = TABLES.get_or_init(|| SOURCES.iter().map(|_| OnceLock::new()).collect());
    let index = SOURCES.iter().position(|(c, _)| *c == code)?;
    Some(tables[index].get_or_init(|| parse(SOURCES[index].1)))
}

fn parse(json: &str) -> Table {
    let mut strings = HashMap::new();
    let value: serde_json::Value = serde_json::from_str(json).unwrap_or_default();
    if let Some(namespaces) = value.as_object() {
        for (ns, keys) in namespaces {
            let Some(keys) = keys.as_object() else {
                continue;
            };
            for (key, text) in keys {
                if let Some(text) = text.as_str() {
                    strings.insert(format!("{ns}.{key}"), text.to_string());
                }
            }
        }
    }
    Table { strings }
}

/// i18next's `formatLanguageCode`: `pt-br` -> `pt-BR`, `EN` -> `en`.
fn format_code(code: &str) -> String {
    let code = code.replace('_', "-");
    let mut parts = code.split('-');
    let mut out = parts.next().unwrap_or("").to_lowercase();
    for part in parts {
        out.push('-');
        if part.len() == 2 {
            out.push_str(&part.to_uppercase());
        } else {
            out.push_str(part);
        }
    }
    out
}

/// Text direction for `document.documentElement.dir` (`i18n.dir()`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Ltr,
    Rtl,
}

/// A value for `{{name}}`.
#[derive(Clone, Debug)]
pub enum Arg {
    Text(String),
    Number(f64),
}

impl From<&str> for Arg {
    fn from(value: &str) -> Self {
        Arg::Text(value.to_string())
    }
}
impl From<String> for Arg {
    fn from(value: String) -> Self {
        Arg::Text(value)
    }
}
impl From<f64> for Arg {
    fn from(value: f64) -> Self {
        Arg::Number(value)
    }
}
impl From<i64> for Arg {
    fn from(value: i64) -> Self {
        Arg::Number(value as f64)
    }
}

/// A run of rich text from a `<Trans>` string (`<strong>`, `<b>`, `<code>`, `<0>`).
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Span {
    pub text: String,
    pub bold: bool,
    pub code: bool,
    /// Index of the `<N>` component this text sits in (links, mostly).
    pub component: Option<u8>,
}

/// The active language and everything resolved for it.
pub struct I18n {
    language: String,
    /// i18next's `toResolveHierarchy`: the language, its base language, then `en`.
    chain: Vec<(&'static str, &'static Table)>,
    plurals: Vec<PluralRules>,
    numbers: DecimalFormatter,
}

impl I18n {
    /// `i18n.changeLanguage(code)`. Unknown languages fall back to English like i18next.
    pub fn new(code: &str) -> Self {
        let language = format_code(code);
        let mut chain = Vec::new();
        let base = language.split('-').next().unwrap_or("en").to_string();
        for candidate in [language.as_str(), base.as_str(), "en"] {
            if chain.iter().any(|(c, _)| *c == candidate) {
                continue;
            }
            if let Some((code, _)) = SOURCES.iter().find(|(c, _)| *c == candidate)
                && let Some(table) = table(code)
            {
                chain.push((*code, table));
            }
        }
        let plurals = chain
            .iter()
            .map(|(code, _)| plural_rules(code))
            .collect::<Vec<_>>();
        let numbers = DecimalFormatter::try_new(locale(&language).into(), Default::default())
            .or_else(|_| DecimalFormatter::try_new(locale("en").into(), Default::default()))
            .expect("English number formatting data is compiled in");
        I18n {
            language,
            chain,
            plurals,
            numbers,
        }
    }

    pub fn language(&self) -> &str {
        &self.language
    }

    /// The language whose strings are actually used (after fallback).
    pub fn resolved_language(&self) -> &str {
        self.chain.first().map(|(c, _)| *c).unwrap_or("en")
    }

    pub fn dir(&self) -> Direction {
        match self.language.split('-').next() {
            Some("ar" | "fa" | "he" | "ur" | "ps" | "yi" | "dv" | "ug" | "ckb") => Direction::Rtl,
            _ => Direction::Ltr,
        }
    }

    /// `t("namespace:key")` or `t("namespace.key")`.
    pub fn t(&self, key: &str) -> String {
        self.translate(key, None, &[])
    }

    /// `t(key, { name: value, … })`.
    pub fn t_with(&self, key: &str, args: &[(&str, Arg)]) -> String {
        self.translate(key, None, args)
    }

    /// `t(key, { count, … })` with plural resolution.
    pub fn t_count(&self, key: &str, count: f64, args: &[(&str, Arg)]) -> String {
        self.translate(key, Some(count), args)
    }

    /// A `<Trans>` string split into styled runs.
    pub fn rich(&self, key: &str, count: Option<f64>, args: &[(&str, Arg)]) -> Vec<Span> {
        let template = self
            .lookup(key, count)
            .unwrap_or_else(|| missing(key).to_string());
        parse_tags(&template)
            .into_iter()
            .map(|mut span| {
                span.text = self.interpolate(&span.text, count, args);
                span
            })
            .collect()
    }

    /// A `<Trans>` string as Markdown for Slint's `StyledText`. Components
    /// (`<0>`) become links to `hydra-trans:<index>`.
    pub fn rich_markdown(&self, key: &str, count: Option<f64>, args: &[(&str, Arg)]) -> String {
        spans_to_markdown(&self.rich(key, count, args))
    }

    /// `Intl.NumberFormat(language).format(value)`.
    pub fn format_number(&self, value: f64) -> String {
        format_decimal(&self.numbers, value)
    }

    fn translate(&self, key: &str, count: Option<f64>, args: &[(&str, Arg)]) -> String {
        match self.lookup(key, count) {
            Some(template) => self.interpolate(&template, count, args),
            None => missing(key).to_string(),
        }
    }

    fn lookup(&self, key: &str, count: Option<f64>) -> Option<String> {
        let key = normalize_key(key);
        for (index, (_, table)) in self.chain.iter().enumerate() {
            // Translator.resolve pops: `_zero` (count 0) -> `_<category>` -> the key.
            let mut candidates = vec![key.clone()];
            if let Some(count) = count {
                candidates.push(format!(
                    "{key}_{}",
                    category_name(category(&self.plurals[index], count))
                ));
                if count == 0.0 {
                    candidates.push(format!("{key}_zero"));
                }
            }
            while let Some(candidate) = candidates.pop() {
                if let Some(text) = table.strings.get(&candidate)
                    && !text.is_empty()
                {
                    return Some(text.clone());
                }
            }
        }
        None
    }

    fn interpolate(&self, template: &str, count: Option<f64>, args: &[(&str, Arg)]) -> String {
        let mut out = String::with_capacity(template.len());
        let mut rest = template;
        while let Some(start) = rest.find("{{") {
            out.push_str(&rest[..start]);
            let after = &rest[start + 2..];
            let Some(end) = after.find("}}") else {
                out.push_str(&rest[start..]);
                return out;
            };
            let inner = &after[..end];
            let (name, format) = match inner.split_once(',') {
                Some((name, format)) => (name.trim(), Some(format.trim())),
                None => (inner.trim(), None),
            };
            let value = args
                .iter()
                .find(|(arg, _)| *arg == name)
                .map(|(_, value)| value.clone())
                .or_else(|| (name == "count").then(|| count.map(Arg::Number)).flatten());
            match value {
                Some(value) => out.push_str(&self.format_arg(&value, format)),
                // skipOnVariables (default since i18next 21): leave the placeholder.
                None => {
                    out.push_str("{{");
                    out.push_str(inner);
                    out.push_str("}}");
                }
            }
            rest = &after[end + 2..];
        }
        out.push_str(rest);
        out
    }

    fn format_arg(&self, value: &Arg, format: Option<&str>) -> String {
        match (value, format) {
            (Arg::Number(n), Some("number")) => self.format_number(*n),
            (Arg::Text(s), Some("number")) => match s.trim().parse::<f64>() {
                Ok(n) => self.format_number(n),
                Err(_) => s.clone(),
            },
            (Arg::Number(n), _) => js_number(*n),
            (Arg::Text(s), _) => s.clone(),
        }
    }
}

fn normalize_key(key: &str) -> String {
    match key.split_once(':') {
        Some((ns, rest)) => format!("{ns}.{rest}"),
        None => key.to_string(),
    }
}

/// i18next returns the key (without its namespace) when nothing matches.
fn missing(key: &str) -> &str {
    key.split_once(':')
        .or_else(|| key.split_once('.'))
        .map(|(_, k)| k)
        .unwrap_or(key)
}

fn locale(code: &str) -> Locale {
    Locale::try_from_str(code)
        .or_else(|_| Locale::try_from_str(code.split('-').next().unwrap_or("en")))
        .unwrap_or_else(|_| Locale::try_from_str("en").expect("valid locale"))
}

fn plural_rules(code: &str) -> PluralRules {
    PluralRules::try_new_cardinal(locale(code).into())
        .or_else(|_| PluralRules::try_new_cardinal(locale("en").into()))
        .expect("English plural data is compiled in")
}

fn category(rules: &PluralRules, count: f64) -> PluralCategory {
    if count.fract() == 0.0 && count.abs() < 1e15 {
        rules.category_for(count as i64)
    } else {
        match parse_decimal(count) {
            Some(decimal) => rules.category_for(&decimal),
            None => PluralCategory::Other,
        }
    }
}

fn category_name(category: PluralCategory) -> &'static str {
    match category {
        PluralCategory::Zero => "zero",
        PluralCategory::One => "one",
        PluralCategory::Two => "two",
        PluralCategory::Few => "few",
        PluralCategory::Many => "many",
        PluralCategory::Other => "other",
    }
}

/// Intl.NumberFormat defaults: up to 3 fraction digits, grouping on.
fn format_decimal(formatter: &DecimalFormatter, value: f64) -> String {
    let rounded = (value * 1000.0).round() / 1000.0;
    let decimal = if rounded.fract() == 0.0 && rounded.abs() < 1e15 {
        Decimal::from(rounded as i64)
    } else {
        match parse_decimal(rounded) {
            Some(decimal) => decimal,
            None => return js_number(value),
        }
    };
    formatter.format(&decimal).to_string()
}

/// Rust's shortest round-trip `Display` for f64 never uses exponents.
fn parse_decimal(value: f64) -> Option<Decimal> {
    if !value.is_finite() {
        return None;
    }
    Decimal::try_from_str(&format!("{value}")).ok()
}

/// `String(number)` in JavaScript for the values Hydra interpolates.
fn js_number(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 1e21 {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

/// `<strong>`, `<b>`, `<code>`, `<0>`…`<9>` (react-i18next `Trans`). Unknown
/// tags stay as text.
fn parse_tags(template: &str) -> Vec<Span> {
    let mut spans = Vec::new();
    let mut bold = 0u32;
    let mut code = 0u32;
    let mut components: Vec<u8> = Vec::new();
    let mut text = String::new();
    let mut rest = template;

    let flush = |text: &mut String, spans: &mut Vec<Span>, bold: u32, code: u32, comps: &[u8]| {
        if !text.is_empty() {
            spans.push(Span {
                text: std::mem::take(text),
                bold: bold > 0,
                code: code > 0,
                component: comps.last().copied(),
            });
        }
    };

    while let Some(open) = rest.find('<') {
        text.push_str(&rest[..open]);
        let tail = &rest[open..];
        let Some(close) = tail.find('>') else {
            text.push_str(tail);
            rest = "";
            break;
        };
        let tag = &tail[1..close];
        let (closing, name) = match tag.strip_prefix('/') {
            Some(name) => (true, name),
            None => (false, tag.trim_end_matches('/').trim()),
        };
        let known = matches!(name, "strong" | "b" | "code")
            || (name.len() == 1 && name.as_bytes()[0].is_ascii_digit());
        if !known {
            text.push_str(&tail[..=close]);
            rest = &tail[close + 1..];
            continue;
        }
        flush(&mut text, &mut spans, bold, code, &components);
        match (name, closing) {
            ("strong" | "b", false) => bold += 1,
            ("strong" | "b", true) => bold = bold.saturating_sub(1),
            ("code", false) => code += 1,
            ("code", true) => code = code.saturating_sub(1),
            (digit, false) => components.push(digit.as_bytes()[0] - b'0'),
            (_, true) => {
                components.pop();
            }
        }
        rest = &tail[close + 1..];
    }
    text.push_str(rest);
    flush(&mut text, &mut spans, bold, code, &components);
    spans
}

fn escape_markdown(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if matches!(
            ch,
            '\\' | '*' | '_' | '`' | '[' | ']' | '<' | '>' | '#' | '~' | '|' | '!'
        ) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Rich runs as Markdown (`**bold**`, `` `code` ``, `[text](hydra-trans:N)`).
pub fn spans_to_markdown(spans: &[Span]) -> String {
    let mut out = String::new();
    for span in spans {
        let mut piece = if span.code {
            format!("`{}`", span.text.replace('`', "'"))
        } else {
            escape_markdown(&span.text)
        };
        if span.bold && !piece.trim().is_empty() {
            piece = format!("**{piece}**");
        }
        if let Some(component) = span.component {
            let _ = write!(out, "[{piece}](hydra-trans:{component})");
        } else {
            out.push_str(&piece);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_language_parses() {
        for code in languages() {
            let table = table(code).expect("table");
            assert!(table.strings.len() > 100, "{code} has too few strings");
        }
    }

    #[test]
    fn plain_and_fallback() {
        let en = I18n::new("en");
        assert_eq!(en.t("sidebar.catalogue"), "Catalogue");
        assert_eq!(en.t("sidebar:catalogue"), "Catalogue");
        // Missing keys return the key itself, like i18next.
        assert_eq!(en.t("sidebar.no_such_key"), "no_such_key");
        // Unknown language -> English.
        assert_eq!(I18n::new("xx").t("sidebar.catalogue"), "Catalogue");
        assert_eq!(I18n::new("en-US").resolved_language(), "en");
        assert_eq!(I18n::new("pt-br").language(), "pt-BR");
    }

    #[test]
    fn plurals_follow_cldr() {
        let en = I18n::new("en");
        let one = en.t_count("settings.games_found", 1.0, &[]);
        let many = en.t_count("settings.games_found", 1234.0, &[]);
        assert_eq!(one, "1 game found");
        assert_eq!(many, "1,234 games found");

        let ru = I18n::new("ru");
        // Russian has one/few/many; each count picks a different form.
        let forms: Vec<String> = [1.0, 3.0, 5.0]
            .iter()
            .map(|n| ru.t_count("settings.file_count", *n, &[]))
            .collect();
        assert_ne!(forms[0], forms[1]);
        assert_ne!(forms[1], forms[2]);
    }

    #[test]
    fn interpolation() {
        let en = I18n::new("en");
        let text = en.t_with(
            "settings.scan_complete_toast",
            &[("matched", Arg::from(1200.0)), ("unmatched", "3".into())],
        );
        assert_eq!(text, "1,200 games matched, 3 games unmatched");
        // Missing values keep the placeholder (skipOnVariables).
        assert!(en.t("game_details.download_size").contains("{{size}}"));
    }

    #[test]
    fn numbers_use_the_locale() {
        assert_eq!(I18n::new("pt-BR").format_number(12345.0), "12.345");
        assert_eq!(I18n::new("en").format_number(1234.5), "1,234.5");
        // es keeps 4-digit numbers ungrouped (CLDR minimumGroupingDigits = 2).
        assert_eq!(I18n::new("es").format_number(1234.0), "1234");
    }

    #[test]
    fn trans_tags() {
        let en = I18n::new("en");
        let spans = en.rich(
            "game_details.download_size",
            None,
            &[("size", "4 GB".into())],
        );
        assert_eq!(
            spans,
            vec![
                Span {
                    text: "Download: ".into(),
                    ..Default::default()
                },
                Span {
                    text: "4 GB".into(),
                    bold: true,
                    ..Default::default()
                },
            ]
        );
        let md = en.rich_markdown("game_details.select_folder_hint", None, &[]);
        assert_eq!(
            md,
            "To change the default folder, go to the [Settings](hydra-trans:0)"
        );
    }

    #[test]
    fn direction() {
        assert_eq!(I18n::new("ar").dir(), Direction::Rtl);
        assert_eq!(I18n::new("fa").dir(), Direction::Rtl);
        assert_eq!(I18n::new("en").dir(), Direction::Ltr);
    }
}
