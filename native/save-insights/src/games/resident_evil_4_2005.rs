//! Resident Evil 4 (2005, Steam Ultimate HD Edition): one plain `savegame00.sav` of 1,047,200
//! bytes. A header at 0x1E40 holds the Steam account id, a 20-entry "slot used" table and the
//! record of the last save (date, difficulty, chapter, round, playtime, pesetas, room, character).
//! The 20 typewriter slots follow at 0x1F70, 0xCAFC bytes each, with no per-slot summary we can read.
//! Field offsets inside the record match the RE4 VR save editor (github.com/dubiousnerd/re4vr-save-editor, MIT).

use crate::games::{label, lookup, Parser};
use crate::model::{SaveSlot, SlotKind, Stat, StatKind, StatValue};
use crate::source::SaveFile;
use crate::util::u32_le;

pub const PARSER: Parser = Parser {
    id: "resident-evil-4-2005",
    version: 1,
    steam_app_ids: &["254700"],
    read_slots,
    labels,
    read_profile: crate::games::no_profile,
    stat_names: &[(StatKind::Money, "Pesetas")],
};

const LABEL_PREFIX: &str = "resident_evil_4_2005";
const HEADER_LEN: u64 = 0x1F70;
const SLOT_USED_TABLE: usize = 0x1E74;
const SLOT_COUNT: usize = 20;
const RECORD: usize = 0x1EE0;
const SAVED_AT: usize = 0x1EF0;
const DIFFICULTY: usize = RECORD + 69;
const CHAPTER: usize = RECORD + 70;
const ROUND: usize = RECORD + 74;
const PLAYTIME: usize = RECORD + 80;
const PESETAS: usize = RECORD + 84;
const ROOM: usize = RECORD + 88;
const CHARACTER: usize = RECORD + 116;
/// The game rewrites the file without saving (settings, cloud copies), so an mtime further than this
/// from the record's local save time is not the save time.
const MAX_ZONE_OFFSET_MS: i64 = 14 * 60 * 60 * 1000;

/// Indexed by the chapter byte; the second value is the chapter group the room table uses.
const CHAPTERS: [(&str, u8); 19] = [
    ("Chapter 1-1", 1),
    ("Chapter 1-2", 1),
    ("Chapter 1-3", 1),
    ("Chapter 2-1", 2),
    ("Chapter 2-2", 2),
    ("Chapter 2-3", 2),
    ("Chapter 3-1", 3),
    ("Chapter 3-2", 3),
    ("Chapter 3-3", 3),
    ("Chapter 3-4", 3),
    ("Chapter 4-1", 4),
    ("Chapter 4-2", 4),
    ("Chapter 4-3", 4),
    ("Chapter 4-4", 4),
    ("Chapter 5-1", 5),
    ("Chapter 5-2", 5),
    ("Chapter 5-3", 5),
    ("Chapter 5-4", 5),
    ("Final Chapter", 5),
];

const DIFFICULTIES: [(u8, &str); 4] = [
    (0, "Amateur"),
    (3, "Easy"),
    (5, "Normal"),
    (6, "Professional"),
];

const CHARACTERS: [(u8, &str); 6] = [
    (0, "Leon"),
    (1, "Ashley"),
    (2, "Ada"),
    (3, "HUNK"),
    (4, "Krauser"),
    (5, "Wesker"),
];

/// Room id `[room, stage]` as a big-endian u16, the chapter group (0 when outside the story), the area.
const ROOMS: [(u16, u8, &str); 110] = [
    (0x0001, 1, "Path to the Village"),
    (0x0101, 1, "The Village"),
    (0x0301, 1, "The Farm"),
    (0x0601, 1, "Beyond the Farm"),
    (0x0401, 1, "Valley"),
    (0x0701, 1, "Village Storage"),
    (0x0501, 1, "Chief's House"),
    (0x0201, 1, "The Locked Building"),
    (0x0801, 1, "Cemetery"),
    (0x0901, 1, "Holding Area"),
    (0x0A01, 1, "Swamp"),
    (0x0B01, 1, "The Lake"),
    (0x1B01, 2, "The Lake (Night)"),
    (0x0C01, 2, "Waterfall"),
    (0x0D01, 2, "Merchant Cave"),
    (0x1A01, 2, "Swamp (Night)"),
    (0x0E01, 2, "Underground Dock"),
    (0x1901, 2, "Holding Area (Night)"),
    (0x0F01, 2, "Gondola"),
    (0x1101, 2, "The Village (Night)"),
    (0x1201, 2, "The Locked Building (Night)"),
    (0x1301, 2, "The Farm (Night)"),
    (0x1701, 2, "Church"),
    (0x1801, 2, "Cemetery (Night)"),
    (0x1C01, 2, "Cabin"),
    (0x1D01, 2, "Bella Sisters (Left Path)"),
    (0x1E01, 2, "El Gigante (Right Path)"),
    (0x1F01, 2, "Burning Barn (Mendez)"),
    (0x0002, 2, "Road to the Castle"),
    (0x0202, 3, "Castle Catapults and Cannons"),
    (0x0302, 3, "Barracks"),
    (0x0102, 3, "Castle Entrance"),
    (0x0402, 3, "Ceremonial Chamber (Before Sewers)"),
    (0x0502, 3, "Sewers"),
    (0x0602, 3, "Giant Knight Hall"),
    (0x0702, 3, "Castle Sword Swap Room"),
    (0x0802, 3, "Castle Water Room"),
    (0x0902, 3, "Castle Gallery"),
    (0x0A02, 3, "Castle Fountain"),
    (0x0B02, 3, "Hedge Garden Maze"),
    (0x0C02, 3, "Castle Dining Hall"),
    (0x0D02, 3, "Ashley Library"),
    (0x0E02, 3, "Ashley Puzzle"),
    (0x0F02, 3, "Lifting Bridge Room"),
    (0x1002, 4, "Lava Trolley"),
    (0x2202, 4, "Dragon Room"),
    (0x1102, 4, "Grail Offering Hallway"),
    (0x1202, 4, "Queen's Grail"),
    (0x1302, 4, "Novistador Hive"),
    (0x1402, 4, "Path to the Clock Tower"),
    (0x1502, 4, "Castle Above Pit"),
    (0x2902, 4, "Castle Pit"),
    (0x1602, 4, "King's Grail"),
    (0x1702, 4, "Gear Clock Tower"),
    (0x1802, 4, "Dual Garrador Tower"),
    (0x1902, 4, "Castle Trolley Cart"),
    (0x1A02, 4, "Underground Mines"),
    (0x1B02, 4, "Mines (Mine Cart Ride)"),
    (0x1B03, 4, "U-3 Fight Area"),
    (0x1D02, 4, "Novistador Cave"),
    (0x1A03, 4, "Island Before U-3"),
    (0x1D03, 4, "Island After U-3"),
    (0x2002, 4, "Save Point After Verdugo"),
    (0x2102, 4, "Verdugo Area"),
    (0x2302, 4, "Mines with Boulder"),
    (0x2402, 4, "Furnace Dual El Gigante"),
    (0x2502, 4, "Outdoor Campfire Area"),
    (0x2602, 4, "Giant Salazar Statue Room"),
    (0x2702, 4, "Tower of Barrels"),
    (0x2802, 4, "Salazar Boss Room"),
    (0x2A02, 4, "Final Area (Ada Waits for Leon)"),
    (0x2C02, 0, "Shooting Range"),
    (0x0003, 5, "First Island"),
    (0x0103, 5, "Upper First Island"),
    (0x0303, 5, "Lab"),
    (0x0403, 5, "CCTV Room"),
    (0x0503, 5, "Garage Door and Archers"),
    (0x0603, 5, "Lab Hallway"),
    (0x0703, 5, "Testing Room with RGB Puzzle"),
    (0x0803, 5, "Freezer Room"),
    (0x0903, 5, "Lab with Iron Maiden"),
    (0x0A03, 5, "Communications Tower"),
    (0x0B03, 5, "Claw Machine"),
    (0x0C03, 5, "Ashley's Prison"),
    (0x0D03, 5, "Tandem Door"),
    (0x0E03, 5, "Break Room"),
    (0x0F03, 5, "Truck on the Lift"),
    (0x1003, 5, "Below the Claw Machine"),
    (0x1103, 5, "Wrecking Ball"),
    (0x1203, 5, "Merchant Before the Truck"),
    (0x1503, 5, "Room After Ashley Wrecks the Truck"),
    (0x1603, 5, "Saddler Steals Ashley"),
    (0x1703, 5, "Leon vs. Krauser"),
    (0x1803, 5, "Laser Room"),
    (0x1C03, 5, "Krauser Area"),
    (0x2003, 5, "Big Battle Area"),
    (0x2103, 5, "Mike's Helicopter"),
    (0x2503, 5, "Leon Attacks Ada"),
    (0x2603, 5, "Jail House with Regenerador"),
    (0x2703, 5, "Keycards and J.J."),
    (0x2903, 5, "Ada vs. Saddler"),
    (0x3003, 5, "Parasite Removal"),
    (0x3103, 5, "Final Merchant"),
    (0x3203, 5, "Saddler Boss Fight"),
    (0x3303, 5, "Jet Ski"),
    (0x3403, 5, "Second Truck"),
    (0x0004, 0, "Mercenaries: Village"),
    (0x0204, 0, "Mercenaries: Castle"),
    (0x0304, 0, "Mercenaries: Island"),
    (0x0404, 0, "Mercenaries: Waterworld"),
];

fn labels() -> Vec<(&'static str, &'static str)> {
    let chapters = CHAPTERS.iter().map(|&(text, _)| ("chapter", text));
    let difficulties = DIFFICULTIES.iter().map(|&(_, text)| ("difficulty", text));
    let characters = CHARACTERS.iter().map(|&(_, text)| ("character", text));
    let rooms = ROOMS.iter().map(|&(_, _, text)| ("location", text));
    chapters
        .chain(difficulties)
        .chain(characters)
        .chain(rooms)
        .collect()
}

fn read_slots(files: &[SaveFile]) -> Vec<SaveSlot> {
    files
        .iter()
        .filter(|file| is_save_file(file.file_name()))
        .filter_map(read_slot)
        .max_by_key(|slot| slot.saved_at_ms)
        .into_iter()
        .collect()
}

fn is_save_file(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.strip_prefix("savegame")
        .and_then(|rest| rest.strip_suffix(".sav"))
        .is_some_and(|number| number.len() == 2 && number.bytes().all(|byte| byte.is_ascii_digit()))
}

fn read_slot(file: &SaveFile) -> Option<SaveSlot> {
    let header = file.read_prefix(HEADER_LEN).ok()?;
    if header.len() < HEADER_LEN as usize {
        return None;
    }
    let local_saved_at_ms = local_save_time_ms(&header)?;
    if !(0..SLOT_COUNT).any(|slot| u32_le(&header, SLOT_USED_TABLE + slot * 4) == Some(1)) {
        return None;
    }

    let mut stats = Vec::new();
    let room = u16::from_be_bytes([*header.get(ROOM)?, *header.get(ROOM + 1)?]);
    let room = ROOMS.iter().find(|&&(id, _, _)| id == room);
    if let Some(&(text, group)) = CHAPTERS.get(usize::from(*header.get(CHAPTER)?)) {
        let agrees_with_room =
            room.is_none_or(|&(_, room_group, _)| room_group == 0 || room_group == group);
        if agrees_with_room {
            stats.push(Stat::new(
                StatKind::Chapter,
                label(LABEL_PREFIX, "chapter", text),
            ));
        }
    }
    if let Some(&(_, _, text)) = room {
        stats.push(Stat::new(
            StatKind::Location,
            label(LABEL_PREFIX, "location", text),
        ));
    }
    stats.push(Stat::new(
        StatKind::Playtime,
        StatValue::Seconds(u64::from(u32_le(&header, PLAYTIME)?)),
    ));
    stats.push(Stat::new(
        StatKind::Money,
        StatValue::Integer(i64::from(u32_le(&header, PESETAS)?)),
    ));
    if let Some(text) = lookup(&DIFFICULTIES, *header.get(DIFFICULTY)?) {
        stats.push(Stat::new(
            StatKind::Difficulty,
            label(LABEL_PREFIX, "difficulty", text),
        ));
    }
    let round = u16::from_le_bytes([*header.get(ROUND)?, *header.get(ROUND + 1)?]);
    if round > 0 && round < 100 {
        stats.push(Stat::new(
            StatKind::NewGamePlus,
            StatValue::Integer(i64::from(round)),
        ));
    }
    if let Some(text) = lookup(&CHARACTERS, *header.get(CHARACTER)?) {
        stats.push(Stat::new(
            StatKind::CharacterName,
            label(LABEL_PREFIX, "character", text),
        ));
    }

    let saved_at_ms = match file.modified_at_ms {
        Some(modified) if (modified - local_saved_at_ms).abs() <= MAX_ZONE_OFFSET_MS => modified,
        _ => local_saved_at_ms,
    };
    Some(SaveSlot {
        id: "last-save".to_owned(),
        kind: SlotKind::Manual,
        title: None,
        saved_at_ms: Some(saved_at_ms),
        playthrough: None,
        stats,
        thumbnail: None,
        files: vec![file.relative_path.clone()],
    })
}

/// The record's save time is local wall-clock time without a zone, as `struct tm` fields.
fn local_save_time_ms(header: &[u8]) -> Option<i64> {
    let field = |index: usize| u32_le(header, SAVED_AT + index * 4).map(i64::from);
    let (second, minute, hour) = (field(0)?, field(1)?, field(2)?);
    let (day, month, year) = (field(3)?, field(4)?, field(5)?);
    let valid = (2005..=2100).contains(&year)
        && (1..=12).contains(&month)
        && (1..=31).contains(&day)
        && hour < 24
        && minute < 60
        && second < 61;
    valid.then(|| {
        (days_from_civil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second) * 1000
    })
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::cataloged_label;

    const RAW_PATH: &str = "<root>/userdata/<storeUserId>/254700/remote";
    const SAVED_LOCAL_MS: i64 = 1_779_391_200_000;

    struct Record {
        used_slots: usize,
        date: [u32; 6],
        difficulty: u8,
        chapter: u8,
        round: u16,
        playtime: u32,
        pesetas: u32,
        room: [u8; 2],
        character: u8,
    }

    impl Default for Record {
        fn default() -> Self {
            Self {
                used_slots: 1,
                date: [0, 20, 19, 21, 5, 2026],
                difficulty: 5,
                chapter: 5,
                round: 0,
                playtime: 9840,
                pesetas: 35_700,
                room: [0x1C, 0x01],
                character: 0,
            }
        }
    }

    fn save(record: &Record) -> Vec<u8> {
        let mut bytes = vec![0u8; 1_047_200];
        bytes[0x1E40..0x1E44].copy_from_slice(&[9, 9, 9, 9]);
        for slot in 0..record.used_slots {
            bytes[SLOT_USED_TABLE + slot * 4] = 1;
        }
        for (index, value) in record.date.iter().enumerate() {
            bytes[SAVED_AT + index * 4..SAVED_AT + index * 4 + 4]
                .copy_from_slice(&value.to_le_bytes());
        }
        bytes[DIFFICULTY] = record.difficulty;
        bytes[CHAPTER] = record.chapter;
        bytes[ROUND..ROUND + 2].copy_from_slice(&record.round.to_le_bytes());
        bytes[PLAYTIME..PLAYTIME + 4].copy_from_slice(&record.playtime.to_le_bytes());
        bytes[PESETAS..PESETAS + 4].copy_from_slice(&record.pesetas.to_le_bytes());
        bytes[ROOM..ROOM + 2].copy_from_slice(&record.room);
        bytes[CHARACTER] = record.character;
        bytes
    }

    fn file(record: &Record, modified_at_ms: Option<i64>) -> SaveFile {
        let mut file = SaveFile::from_bytes(RAW_PATH, "savegame00.sav", save(record));
        file.modified_at_ms = modified_at_ms;
        file
    }

    #[test]
    fn reads_the_last_save_record() {
        let slots = read_slots(&[file(&Record::default(), None)]);
        assert_eq!(slots.len(), 1);
        let slot = &slots[0];
        assert_eq!(
            (slot.id.as_str(), slot.kind),
            ("last-save", SlotKind::Manual)
        );
        assert_eq!(
            slot.stat(StatKind::Chapter),
            Some(&cataloged_label(
                "resident_evil_4_2005.chapter.chapter_2_3",
                "Chapter 2-3"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Location),
            Some(&cataloged_label(
                "resident_evil_4_2005.location.cabin",
                "Cabin"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Playtime),
            Some(&StatValue::Seconds(9840))
        );
        assert_eq!(
            slot.stat(StatKind::Money),
            Some(&StatValue::Integer(35_700))
        );
        assert_eq!(
            slot.stat(StatKind::Difficulty),
            Some(&cataloged_label(
                "resident_evil_4_2005.difficulty.normal",
                "Normal"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::CharacterName),
            Some(&cataloged_label(
                "resident_evil_4_2005.character.leon",
                "Leon"
            ))
        );
        assert_eq!(slot.stat(StatKind::NewGamePlus), None);
        assert_eq!(slot.saved_at_ms, Some(SAVED_LOCAL_MS));
    }

    #[test]
    fn round_two_is_new_game_plus() {
        let record = Record {
            round: 1,
            difficulty: 6,
            ..Record::default()
        };
        let slots = read_slots(&[file(&record, None)]);
        assert_eq!(
            slots[0].stat(StatKind::NewGamePlus),
            Some(&StatValue::Integer(1))
        );
        assert_eq!(
            slots[0].stat(StatKind::Difficulty),
            Some(&cataloged_label(
                "resident_evil_4_2005.difficulty.professional",
                "Professional"
            ))
        );
    }

    #[test]
    fn chapter_that_contradicts_the_room_is_dropped() {
        let record = Record {
            chapter: 18,
            ..Record::default()
        };
        let slots = read_slots(&[file(&record, None)]);
        assert_eq!(slots[0].stat(StatKind::Chapter), None);
        assert!(slots[0].stat(StatKind::Location).is_some());
    }

    #[test]
    fn unknown_room_keeps_the_chapter() {
        let record = Record {
            room: [0x7F, 0x07],
            chapter: 18,
            ..Record::default()
        };
        let slots = read_slots(&[file(&record, None)]);
        assert_eq!(slots[0].stat(StatKind::Location), None);
        assert_eq!(
            slots[0].stat(StatKind::Chapter),
            Some(&cataloged_label(
                "resident_evil_4_2005.chapter.final_chapter",
                "Final Chapter"
            ))
        );
    }

    #[test]
    fn save_time_prefers_a_nearby_mtime() {
        let three_hours = 3 * 60 * 60 * 1000;
        let nearby = read_slots(&[file(&Record::default(), Some(SAVED_LOCAL_MS + three_hours))]);
        assert_eq!(nearby[0].saved_at_ms, Some(SAVED_LOCAL_MS + three_hours));
        let rewritten_later = read_slots(&[file(
            &Record::default(),
            Some(SAVED_LOCAL_MS + 400 * three_hours),
        )]);
        assert_eq!(rewritten_later[0].saved_at_ms, Some(SAVED_LOCAL_MS));
    }

    #[test]
    fn newest_copy_wins() {
        let older = Record {
            date: [0, 20, 19, 21, 4, 2026],
            playtime: 60,
            ..Record::default()
        };
        let mut emulator_copy = file(&older, None);
        emulator_copy.raw_path = "<winAppData>/GSE Saves/254700".to_owned();
        emulator_copy.relative_path = "remote/savegame00.sav".to_owned();
        let slots = read_slots(&[emulator_copy, file(&Record::default(), None)]);
        assert_eq!(slots.len(), 1);
        assert_eq!(
            slots[0].stat(StatKind::Playtime),
            Some(&StatValue::Seconds(9840))
        );
    }

    #[test]
    fn empty_truncated_and_garbage_files_give_nothing() {
        let empty = Record {
            used_slots: 0,
            ..Record::default()
        };
        assert!(read_slots(&[file(&empty, None)]).is_empty());
        let no_date = Record {
            date: [0; 6],
            ..Record::default()
        };
        assert!(read_slots(&[file(&no_date, None)]).is_empty());
        let truncated = SaveFile::from_bytes(
            RAW_PATH,
            "savegame00.sav",
            save(&Record::default())[..0x1F00].to_vec(),
        );
        assert!(read_slots(&[truncated]).is_empty());
        let garbage = SaveFile::from_bytes(RAW_PATH, "savegame00.sav", vec![0xFF; 0x2000]);
        assert!(read_slots(&[garbage]).is_empty());
    }

    #[test]
    fn save_file_names() {
        assert!(is_save_file("savegame00.sav"));
        assert!(is_save_file("SaveGame01.SAV"));
        assert!(!is_save_file("savegame.sav"));
        assert!(!is_save_file("config.ini"));
    }

    #[test]
    fn room_ids_are_unique() {
        for (index, &(id, _, _)) in ROOMS.iter().enumerate() {
            assert!(
                ROOMS[index + 1..].iter().all(|&(other, _, _)| other != id),
                "{id:#06x}"
            );
        }
    }
}
