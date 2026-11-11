mod assassins_creed_black_flag_resynced;
mod blood_of_dawnwalker;
mod bomb_rush_cyberfunk;
mod celeste;
mod control_resonant;
mod cyberpunk_2077;
mod dark_souls_3;
mod elden_ring;
mod first_light;
mod ghost_of_tsushima;
mod insomniac_dat1;
mod red_dead_redemption_2;
mod resident_evil_4_2005;
mod the_last_of_us_part_1;

use std::collections::BTreeMap;

use crate::model::{SaveSlot, Stat, StatKind, StatValue};
use crate::source::SaveFile;

pub struct Parser {
    pub id: &'static str,
    /// Bump when the same files would now give different slots or stats.
    pub version: u32,
    pub steam_app_ids: &'static [&'static str],
    pub read_slots: fn(&[SaveFile]) -> Vec<SaveSlot>,
    /// `(field, English text)` of every label `read_slots` can emit.
    pub labels: fn() -> Vec<(&'static str, &'static str)>,
    /// Snapshot-wide stats the game itself records, such as its own achievement file.
    pub read_profile: fn(&[SaveFile]) -> Vec<Stat>,
    /// The game's own names for stat kinds, applied to every slot.
    pub stat_names: &'static [(StatKind, &'static str)],
}

pub fn no_profile(_files: &[SaveFile]) -> Vec<Stat> {
    Vec::new()
}

pub const PARSERS: &[Parser] = &[
    cyberpunk_2077::PARSER,
    elden_ring::PARSER,
    red_dead_redemption_2::PARSER,
    the_last_of_us_part_1::PARSER,
    first_light::PARSER,
    insomniac_dat1::SPIDER_MAN_REMASTERED,
    insomniac_dat1::SPIDER_MAN_2,
    assassins_creed_black_flag_resynced::PARSER,
    blood_of_dawnwalker::PARSER,
    resident_evil_4_2005::PARSER,
    celeste::PARSER,
    bomb_rush_cyberfunk::PARSER,
    ghost_of_tsushima::PARSER,
    control_resonant::PARSER,
    dark_souls_3::PARSER,
];

pub fn find_parser(shop: &str, object_id: &str) -> Option<&'static Parser> {
    match shop {
        "steam" => PARSERS
            .iter()
            .find(|parser| parser.steam_app_ids.contains(&object_id)),
        _ => None,
    }
}

/// Groups files by save location and parent folder, so each folder is one candidate slot.
pub fn group_by_dir(files: &[SaveFile]) -> BTreeMap<(&str, &str), Vec<&SaveFile>> {
    let mut groups: BTreeMap<(&str, &str), Vec<&SaveFile>> = BTreeMap::new();
    for file in files {
        groups
            .entry((file.raw_path.as_str(), file.parent_dir()))
            .or_default()
            .push(file);
    }
    groups
}

pub fn newest_modified_at(files: &[&SaveFile]) -> Option<i64> {
    files.iter().filter_map(|file| file.modified_at_ms).max()
}

/// `prefix` is the parser id with `-` replaced by `_`.
pub fn label(prefix: &str, field: &str, text: &'static str) -> StatValue {
    StatValue::Label {
        key: label_key(prefix, field, text),
        text: text.to_owned(),
    }
}

/// The game's own name for a stat; its catalog field is `stat`.
pub fn stat_name(prefix: &str, text: &'static str) -> crate::model::StatName {
    crate::model::StatName {
        key: label_key(prefix, "stat", text),
        text: text.to_owned(),
    }
}

pub fn label_key(prefix: &str, field: &str, text: &str) -> String {
    format!("{prefix}.{field}.{}", slug(text))
}

fn slug(text: &str) -> String {
    let mut slug = String::with_capacity(text.len());
    for character in text.chars().map(|character| character.to_ascii_lowercase()) {
        if character.is_ascii_lowercase() || character.is_ascii_digit() {
            slug.push(character);
        } else if !slug.ends_with('_') {
            slug.push('_');
        }
    }
    slug.trim_matches('_').to_owned()
}

pub fn lookup<K: PartialEq>(table: &[(K, &'static str)], code: K) -> Option<&'static str> {
    table
        .iter()
        .find(|(known, _)| *known == code)
        .map(|&(_, text)| text)
}

/// The label a test expects, checked against the catalog so emitted keys cannot drift from it.
#[cfg(test)]
pub fn cataloged_label(key: &str, text: &str) -> StatValue {
    let entry = (key.to_owned(), text.to_owned());
    assert!(
        crate::label_catalog().contains(&entry),
        "{key} = {text:?} is not in the label catalog"
    );
    StatValue::Label {
        key: entry.0,
        text: entry.1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs() {
        assert_eq!(slug("Morgott, the Omen King"), "morgott_the_omen_king");
        assert_eq!(slug("Bill's Town"), "bill_s_town");
        assert_eq!(slug("  Mt. Gelmir -- (Act 2)! "), "mt_gelmir_act_2");
        assert_eq!(slug("Café"), "caf");
        assert_eq!(
            label_key("007_first_light", "difficulty", "Purist"),
            "007_first_light.difficulty.purist"
        );
    }

    #[test]
    fn label_carries_key_and_english_text() {
        assert_eq!(
            label("cyberpunk_2077", "difficulty", "Very Hard"),
            StatValue::Label {
                key: "cyberpunk_2077.difficulty.very_hard".to_owned(),
                text: "Very Hard".to_owned(),
            }
        );
    }

    #[test]
    fn lookup_finds_the_text_of_a_code() {
        let table = [("a", "Alpha"), ("b", "Beta")];
        assert_eq!(lookup(&table, "b"), Some("Beta"));
        assert_eq!(lookup(&table, "c"), None);
        assert_eq!(lookup(&[(60u8, "Sixty")], 60), Some("Sixty"));
    }
}
