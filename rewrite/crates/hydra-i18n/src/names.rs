//! `Intl.DisplayNames([locale], { type: "language" }).of(code)` for the
//! languages reviews are written in (getLanguageDisplayName in
//! src/shared/review-translation.ts). The names come from Chromium's ICU data,
//! exported by tools/export-language-names.mjs.

use std::collections::HashMap;
use std::sync::OnceLock;

type Tables = HashMap<String, HashMap<String, String>>;

fn tables() -> &'static Tables {
    static TABLES: OnceLock<Tables> = OnceLock::new();
    TABLES.get_or_init(|| {
        serde_json::from_str(include_str!("../data/language-names.json")).unwrap_or_default()
    })
}

/// The name of `code` in `locale`, like `getLanguageDisplayName`: empty for no
/// code, the upper-cased code when the name is unknown.
pub fn language_display_name(code: Option<&str>, locale: &str) -> String {
    let Some(code) = code.filter(|c| !c.is_empty()) else {
        return String::new();
    };
    let tables = tables();
    let base = locale.split('-').next().unwrap_or(locale);
    let table = tables
        .get(locale)
        .or_else(|| tables.get(base))
        .or_else(|| {
            tables
                .iter()
                .find(|(k, _)| k.split('-').next() == Some(base))
                .map(|(_, v)| v)
        })
        .or_else(|| tables.get("en"));
    let lookup = code.to_ascii_lowercase();
    let short = lookup
        .split(['-', '_'])
        .next()
        .unwrap_or(&lookup)
        .to_string();
    table
        .and_then(|t| t.get(&lookup).or_else(|| t.get(&short)))
        .cloned()
        .unwrap_or_else(|| code.to_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_in_the_ui_language() {
        assert_eq!(language_display_name(Some("pt"), "en"), "Portuguese");
        assert_eq!(language_display_name(Some("en"), "pt-BR"), "inglês");
        assert_eq!(language_display_name(Some("es"), "de"), "Spanisch");
        assert_eq!(language_display_name(None, "en"), "");
        assert_eq!(language_display_name(Some("qq"), "en"), "QQ");
    }
}
