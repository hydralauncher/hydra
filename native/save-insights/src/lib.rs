//! Turns the files of one cloud save snapshot into a short summary of each save slot
//! (level, playtime, money, quest progress, screenshot), so two snapshots in conflict
//! can be told apart.

mod emulator_achievements;
mod games;
pub mod model;
pub mod source;
mod util;

use std::panic::{catch_unwind, AssertUnwindSafe};

pub use model::*;
pub use source::{FileContent, SaveFile};

pub fn has_game_parser(shop: &str, object_id: &str) -> bool {
    games::find_parser(shop, object_id).is_some()
}

/// Every `(key, English text)` a `StatValue::Label` can carry, sorted by key.
pub fn label_catalog() -> Vec<(String, String)> {
    let mut catalog: Vec<(String, String)> = games::PARSERS
        .iter()
        .flat_map(|parser| {
            let prefix = parser.id.replace('-', "_");
            let names = parser.stat_names.iter().map(|&(_, text)| ("stat", text));
            (parser.labels)()
                .into_iter()
                .chain(names)
                .map(move |(field, text)| (games::label_key(&prefix, field, text), text.to_owned()))
        })
        .collect();
    catalog.sort();
    catalog.dedup();
    catalog
}

/// Returns `None` when nothing could be read. A summary is only a hint: parser
/// panics are caught and treated as "nothing read", so they can never break a sync.
pub fn summarize(shop: &str, object_id: &str, files: &[SaveFile]) -> Option<SaveSummary> {
    let mut parsers = Vec::new();

    let mut slots = Vec::new();
    let mut profile = Vec::new();
    if let Some(parser) = games::find_parser(shop, object_id) {
        slots = catch_unwind(AssertUnwindSafe(|| (parser.read_slots)(files))).unwrap_or_default();
        profile =
            catch_unwind(AssertUnwindSafe(|| (parser.read_profile)(files))).unwrap_or_default();
        if !slots.is_empty() || !profile.is_empty() {
            parsers.push(format!("{}@{}", parser.id, parser.version));
        }
        let prefix = parser.id.replace('-', "_");
        for stat in slots.iter_mut().flat_map(|slot| slot.stats.iter_mut()) {
            if let Some(&(_, text)) = parser
                .stat_names
                .iter()
                .find(|(kind, _)| *kind == stat.kind)
            {
                stat.name = Some(games::stat_name(&prefix, text));
            }
        }
    }
    slots.sort_by(|a, b| {
        (a.kind == SlotKind::Profile)
            .cmp(&(b.kind == SlotKind::Profile))
            .then_with(|| b.saved_at_ms.cmp(&a.saved_at_ms))
            .then_with(|| a.id.cmp(&b.id))
    });

    let has_game_achievements = profile
        .iter()
        .any(|stat| stat.kind == StatKind::Achievements);
    let emulator = catch_unwind(AssertUnwindSafe(|| {
        emulator_achievements::read_profile(files)
    }))
    .unwrap_or_default();
    if !has_game_achievements && !emulator.is_empty() {
        profile.extend(emulator);
        parsers.push(format!(
            "{}@{}",
            emulator_achievements::ID,
            emulator_achievements::VERSION
        ));
    }

    if parsers.is_empty() {
        return None;
    }
    Some(SaveSummary {
        schema_version: SCHEMA_VERSION,
        parsers,
        profile,
        slots,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_game_without_achievements_has_no_summary() {
        let files = [SaveFile::from_bytes("<base>", "save.dat", b"data".to_vec())];
        assert!(!has_game_parser("steam", "10"));
        assert_eq!(summarize("steam", "10", &files), None);
    }

    #[test]
    fn known_game_without_readable_slots_has_no_summary() {
        let files = [SaveFile::from_bytes(
            "<base>",
            "AutoSave-0/metadata.9.json",
            b"{".to_vec(),
        )];
        assert_eq!(summarize("steam", "1091500", &files), None);
    }

    #[test]
    fn unknown_game_still_gets_emulator_achievements() {
        let files = [SaveFile::from_bytes(
            "<winPublic>/Documents/Steam/RUNE/10",
            "achievements.ini",
            b"[A]\nAchieved=1\nUnlockTime=5\n".to_vec(),
        )];
        let summary = summarize("steam", "10", &files).unwrap();
        assert_eq!(summary.parsers, ["emulator-achievements@1"]);
        assert!(summary.slots.is_empty());
        assert_eq!(
            summary.profile,
            [Stat::new(StatKind::Achievements, StatValue::Integer(1))]
        );
    }

    #[test]
    fn label_slugs_are_never_empty() {
        let catalog = label_catalog();
        assert!(!catalog.is_empty());
        for (key, _) in &catalog {
            assert!(
                key.rsplit('.').next().is_some_and(|slug| !slug.is_empty()),
                "{key}"
            );
        }
    }

    #[test]
    fn a_label_key_never_has_two_texts() {
        for pair in label_catalog().windows(2) {
            assert_ne!(pair[0].0, pair[1].0, "{:?} and {:?}", pair[0], pair[1]);
        }
    }

    #[test]
    fn label_keys_are_prefix_field_and_slug() {
        for (key, text) in label_catalog() {
            let parts: Vec<&str> = key.split('.').collect();
            assert_eq!(parts.len(), 3, "{key}");
            assert!(parts.iter().all(|part| !part.is_empty()), "{key}");
            assert!(
                key.bytes()
                    .all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'.')),
                "{key}"
            );
            assert!(!text.is_empty(), "{key}");
        }
    }

    #[test]
    fn game_stat_names_are_applied_and_cataloged() {
        let files = [SaveFile::from_bytes(
            "<base>/Saves/*.celeste",
            "0.celeste",
            b"<SaveData><Time>10000000</Time><TotalStrawberries>3</TotalStrawberries></SaveData>"
                .to_vec(),
        )];
        let summary = summarize("steam", "504230", &files).unwrap();
        let strawberries = summary.slots[0]
            .stats
            .iter()
            .find(|stat| stat.kind == StatKind::Collectibles)
            .unwrap();
        let name = strawberries.name.as_ref().unwrap();
        assert_eq!(
            (name.key.as_str(), name.text.as_str()),
            ("celeste.stat.strawberries", "Strawberries")
        );
        assert!(label_catalog().contains(&(name.key.clone(), name.text.clone())));
        let playtime = summary.slots[0]
            .stats
            .iter()
            .find(|stat| stat.kind == StatKind::Playtime)
            .unwrap();
        assert_eq!(playtime.name, None);
    }
}
