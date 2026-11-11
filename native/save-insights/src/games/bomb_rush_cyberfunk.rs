//! Bomb Rush Cyberfunk: every file is one version byte followed by a gzip stream of C#
//! `BinaryWriter` data. `GameProgressN.brp` is save slot N: two u32 (version, slot) and four
//! 7-bit-length strings, the last three being the current stage, character and story objective
//! as enum names. `GameAchievements.bra` is two u32 (version, count) and one bool per achievement.

use crate::games::{label, lookup, newest_modified_at, Parser};
use crate::model::{SaveSlot, SlotKind, Stat, StatKind, StatValue};
use crate::source::SaveFile;
use crate::util::{gunzip, u32_le};

pub const PARSER: Parser = Parser {
    id: "bomb-rush-cyberfunk",
    version: 1,
    steam_app_ids: &["1353230"],
    read_slots,
    labels,
    read_profile,
    stat_names: &[],
};

const LABEL_PREFIX: &str = "bomb_rush_cyberfunk";
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_INFLATED_BYTES: usize = 16 * 1024 * 1024;
const MAX_STRING_BYTES: usize = 256;
const MAX_ACHIEVEMENTS: usize = 256;

const STAGES: [(&str, &str); 8] = [
    ("hideout", "Hideout"),
    ("downhill", "Versum Hill"),
    ("square", "Millennium Square"),
    ("tower", "Brink Terminal"),
    ("Mall", "Millennium Mall"),
    ("pyramid", "Pyramid Island"),
    ("osaka", "Mataan"),
    ("Prelude", "Prelude"),
];

const CHARACTERS: [(&str, &str); 2] = [("metalHead", "Red"), ("frank", "Frank")];

fn labels() -> Vec<(&'static str, &'static str)> {
    let stages = STAGES.iter().map(|&(_, text)| ("location", text));
    stages
        .chain(CHARACTERS.iter().map(|&(_, text)| ("character", text)))
        .collect()
}

fn read_slots(files: &[SaveFile]) -> Vec<SaveSlot> {
    let mut slots: Vec<SaveSlot> = Vec::new();
    for file in files {
        let Some(number) = slot_number(file.file_name()) else {
            continue;
        };
        let Some(slot) = read_slot(file, number) else {
            continue;
        };
        match slots.iter_mut().find(|existing| existing.id == slot.id) {
            Some(existing) if existing.saved_at_ms < slot.saved_at_ms => *existing = slot,
            Some(_) => {}
            None => slots.push(slot),
        }
    }
    slots
}

fn read_profile(files: &[SaveFile]) -> Vec<Stat> {
    let unlocked = files
        .iter()
        .filter(|file| file.file_name() == "GameAchievements.bra")
        .filter_map(|file| {
            let data = inflate(file)?;
            let count = usize::try_from(u32_le(&data, 4)?).ok()?;
            if count > MAX_ACHIEVEMENTS {
                return None;
            }
            let flags = data.get(8..8 + count)?;
            Some(flags.iter().filter(|&&flag| flag != 0).count())
        })
        .max();
    match unlocked {
        Some(count) if count > 0 => vec![Stat::new(
            StatKind::Achievements,
            StatValue::Integer(count as i64),
        )],
        _ => Vec::new(),
    }
}

fn slot_number(name: &str) -> Option<u32> {
    let number = name.strip_prefix("GameProgress")?.strip_suffix(".brp")?;
    if number.is_empty() || number.len() > 2 || !number.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    number.parse().ok()
}

fn read_slot(file: &SaveFile, number: u32) -> Option<SaveSlot> {
    let data = inflate(file)?;
    let mut cursor = 8;
    let mut strings = Vec::with_capacity(4);
    for _ in 0..4 {
        strings.push(read_string(&data, &mut cursor)?);
    }
    let (stage, character, objective) = (&strings[1], &strings[2], &strings[3]);

    let mut stats = Vec::new();
    if let Some(text) = lookup(&STAGES, stage.as_str()) {
        stats.push(Stat::new(
            StatKind::Location,
            label(LABEL_PREFIX, "location", text),
        ));
    }
    if let Some(text) = lookup(&CHARACTERS, character.as_str()) {
        stats.push(Stat::new(
            StatKind::CharacterName,
            label(LABEL_PREFIX, "character", text),
        ));
    }
    if let Some(objective) = words(objective) {
        stats.push(Stat::new(StatKind::Objective, StatValue::Text(objective)));
    }
    if stats.is_empty() {
        return None;
    }
    Some(SaveSlot {
        id: format!("slot-{}", number + 1),
        kind: SlotKind::Auto,
        title: None,
        saved_at_ms: newest_modified_at(&[file]),
        playthrough: None,
        stats,
        thumbnail: None,
        files: vec![file.relative_path.clone()],
    })
}

fn inflate(file: &SaveFile) -> Option<Vec<u8>> {
    let raw = file.read_prefix(MAX_FILE_BYTES).ok()?;
    gunzip(raw.get(1..)?, MAX_INFLATED_BYTES)
}

/// A C# `BinaryWriter` string: a 7-bit varint byte length, then UTF-8.
fn read_string(data: &[u8], cursor: &mut usize) -> Option<String> {
    let mut length = 0usize;
    for shift in [0, 7, 14] {
        let byte = *data.get(*cursor)?;
        *cursor += 1;
        length |= usize::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            if length > MAX_STRING_BYTES {
                return None;
            }
            let text = std::str::from_utf8(data.get(*cursor..*cursor + length)?).ok()?;
            *cursor += length;
            return Some(text.to_owned());
        }
    }
    None
}

/// `BeatDotExe` -> "Beat Dot Exe". Objective ids are the developers' English names.
fn words(id: &str) -> Option<String> {
    if id.is_empty() || id == "NONE" || !id.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return None;
    }
    let mut text = String::with_capacity(id.len() + 4);
    for (index, character) in id.chars().enumerate() {
        if index > 0 && character.is_ascii_uppercase() {
            text.push(' ');
        }
        text.push(character);
    }
    Some(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::cataloged_label;

    const RAW_PATH: &str = "<root>/userdata/<storeUserId>/1353230/remote/GameProgress*.brp";

    fn gzip(data: &[u8]) -> Vec<u8> {
        let mut out = vec![0x02, 0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 0x0a];
        out.extend(miniz_oxide::deflate::compress_to_vec(data, 6));
        out.extend_from_slice(&[0; 8]);
        out
    }

    fn net_string(text: &str) -> Vec<u8> {
        let mut out = vec![text.len() as u8];
        out.extend_from_slice(text.as_bytes());
        out
    }

    fn progress(stage: &str, character: &str, objective: &str) -> Vec<u8> {
        let mut data = 3u32.to_le_bytes().to_vec();
        data.extend_from_slice(&0u32.to_le_bytes());
        for text in ["NONE", stage, character, objective] {
            data.extend(net_string(text));
        }
        data.extend_from_slice(&[0, 0, 0, 0, 0, 1]);
        gzip(&data)
    }

    fn file(name: &str, bytes: Vec<u8>, modified_at_ms: Option<i64>) -> SaveFile {
        let mut file = SaveFile::from_bytes(RAW_PATH, name, bytes);
        file.modified_at_ms = modified_at_ms;
        file
    }

    #[test]
    fn reads_a_save_slot() {
        let slots = read_slots(&[
            file(
                "GameProgress0.brp",
                progress("Mall", "metalHead", "BeatDotExe"),
                Some(9),
            ),
            file(
                "GameProgress0_backup.brp",
                progress("square", "frank", "HangOut"),
                Some(10),
            ),
        ]);
        assert_eq!(slots.len(), 1);
        let slot = &slots[0];
        assert_eq!(
            (slot.id.as_str(), slot.kind, slot.saved_at_ms),
            ("slot-1", SlotKind::Auto, Some(9))
        );
        assert_eq!(
            slot.stat(StatKind::Location),
            Some(&cataloged_label(
                "bomb_rush_cyberfunk.location.millennium_mall",
                "Millennium Mall"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::CharacterName),
            Some(&cataloged_label("bomb_rush_cyberfunk.character.red", "Red"))
        );
        assert_eq!(
            slot.stat(StatKind::Objective),
            Some(&StatValue::Text("Beat Dot Exe".into()))
        );
    }

    #[test]
    fn unknown_stage_and_character_keep_the_objective() {
        let slots = read_slots(&[file(
            "GameProgress1.brp",
            progress("mapstation/custom.map", "dummy", "HangOut"),
            None,
        )]);
        assert_eq!(slots[0].id, "slot-2");
        assert_eq!(slots[0].stat(StatKind::Location), None);
        assert_eq!(slots[0].stat(StatKind::CharacterName), None);
        assert_eq!(
            slots[0].stat(StatKind::Objective),
            Some(&StatValue::Text("Hang Out".into()))
        );
    }

    #[test]
    fn reads_achievements() {
        let mut data = 0u32.to_le_bytes().to_vec();
        data.extend_from_slice(&24u32.to_le_bytes());
        data.extend((0..24).map(|index| u8::from(index % 5 == 0)));
        let profile = read_profile(&[file("GameAchievements.bra", gzip(&data), None)]);
        assert_eq!(
            profile,
            [Stat::new(StatKind::Achievements, StatValue::Integer(5))]
        );
    }

    #[test]
    fn game_achievements_replace_emulator_ones() {
        let mut data = 0u32.to_le_bytes().to_vec();
        data.extend_from_slice(&2u32.to_le_bytes());
        data.extend_from_slice(&[1, 1]);
        let files = [
            file("GameAchievements.bra", gzip(&data), None),
            file(
                "achievements.json",
                br#"{"a":{"earned":true}}"#.to_vec(),
                None,
            ),
            file(
                "GameProgress0.brp",
                progress("hideout", "metalHead", "JoinTheCrew"),
                None,
            ),
        ];
        let summary = crate::summarize("steam", "1353230", &files).unwrap();
        assert_eq!(summary.parsers, ["bomb-rush-cyberfunk@1"]);
        assert_eq!(
            summary.profile,
            [Stat::new(StatKind::Achievements, StatValue::Integer(2))]
        );
    }

    #[test]
    fn garbage_and_truncated_files_give_nothing() {
        let full = progress("square", "frank", "HangOut");
        for cut in 0..full.len() {
            let _ = read_slots(&[file("GameProgress0.brp", full[..cut].to_vec(), None)]);
        }
        assert!(
            read_slots(&[file("GameProgress0.brp", b"\x02not gzip".to_vec(), None)]).is_empty()
        );
        assert!(read_profile(&[file("GameAchievements.bra", vec![2], None)]).is_empty());
    }

    #[test]
    fn names() {
        assert_eq!(slot_number("GameProgress0.brp"), Some(0));
        assert_eq!(slot_number("GameProgress2.brp"), Some(2));
        assert_eq!(slot_number("GameProgress0_backup.brp"), None);
        assert_eq!(slot_number("SaveSlots.brss"), None);
        assert_eq!(words("GoToSquare").as_deref(), Some("Go To Square"));
        assert_eq!(words("NONE"), None);
        assert_eq!(words("bad name"), None);
    }
}
