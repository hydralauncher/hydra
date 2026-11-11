//! The Last of Us Part I: one folder per slot under `savedata/`: `SAVEFILE0A` is the autosave,
//! `SAVEFILE00`, `SAVEFILE01`... are manual or backup saves, and `SAVEFILE0P` is the profile.
//! `params.json` (mirrored in the `USR-DATA` header) holds the localized subtitle and detail text.
//! The detail ends with a language-independent hex code that holds difficulty, section,
//! chapter, collectibles and playtime.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::games::{label, newest_modified_at, Parser};
use crate::model::{SaveSlot, SlotKind, Stat, StatKind, StatValue};
use crate::source::SaveFile;
use crate::util::strip_bom;

pub const PARSER: Parser = Parser {
    id: "the-last-of-us-part-1",
    version: 1,
    steam_app_ids: &["1888930"],
    read_slots,
    labels,
    read_profile: crate::games::no_profile,
    stat_names: &[(StatKind::Location, "Section")],
};

const LABEL_PREFIX: &str = "the_last_of_us_part_1";
const FOLDER_PREFIX: &str = "SAVEFILE";
const PARAMS_FILE: &str = "params.json";
const DATA_FILE: &str = "USR-DATA";
const MAX_PARAMS_BYTES: u64 = 64 * 1024;
const HEADER_SUBTITLE: (usize, usize) = (0x90, 0x80);
const HEADER_DETAIL: (usize, usize) = (0x5a4, 0x400);
const CODE_HEX_LEN: usize = 24;
const PROFILE_DIFFICULTY: u8 = 0xff;
const MAIN_STORY: u8 = 3;
const BACKUP_FLAG: u16 = 0x0008;

const CHAPTERS: [&str; 12] = [
    "Hometown",
    "The Quarantine Zone",
    "The Outskirts",
    "Bill's Town",
    "Pittsburgh",
    "The Suburbs",
    "Tommy's Dam",
    "The University",
    "Lakeside Resort",
    "Bus Depot",
    "The Firefly Lab",
    "Jackson",
];

/// Indexed by the global section number in the detail code; each entry names its chapter index.
const SECTIONS: [(u8, &str); 29] = [
    (0, "Prologue"),
    (1, "20 Years Later"),
    (1, "Beyond The Wall"),
    (1, "The Slums"),
    (1, "The Cargo"),
    (2, "Outside"),
    (2, "Downtown"),
    (2, "Museum"),
    (2, "The Capitol Building"),
    (3, "The Woods"),
    (3, "Safehouse"),
    (3, "Graveyard"),
    (3, "High School Escape"),
    (4, "Alone and Forsaken"),
    (4, "Hotel Lobby"),
    (4, "Financial District"),
    (4, "Escape the City"),
    (5, "Sewers"),
    (5, "Suburbs"),
    (6, "Hydroelectric Dam"),
    (6, "Ranch House"),
    (7, "Go Big Horns"),
    (7, "Science Building"),
    (8, "The Hunt"),
    (8, "Cabin Resort"),
    (9, "Highway Exit"),
    (9, "Underground Tunnel"),
    (10, "The Hospital"),
    (11, "Epilogue"),
];

const DIFFICULTIES: [&str; 6] = [
    "Very Light",
    "Light",
    "Moderate",
    "Hard",
    "Survivor",
    "Grounded",
];

fn labels() -> Vec<(&'static str, &'static str)> {
    let chapters = CHAPTERS.iter().map(|&chapter| ("chapter", chapter));
    let sections = SECTIONS.iter().map(|&(_, section)| ("section", section));
    let difficulties = DIFFICULTIES.iter().map(|&text| ("difficulty", text));
    chapters.chain(sections).chain(difficulties).collect()
}

fn read_slots(files: &[SaveFile]) -> Vec<SaveSlot> {
    let mut folders: BTreeMap<&str, Vec<&SaveFile>> = BTreeMap::new();
    for file in files {
        let folder = file.parent_dir().rsplit('/').next().unwrap_or_default();
        if slot_kind(folder).is_some() {
            folders.entry(folder).or_default().push(file);
        }
    }
    folders
        .into_iter()
        .filter_map(|(folder, slot_files)| read_slot(folder, &slot_files))
        .collect()
}

fn read_slot(folder: &str, files: &[&SaveFile]) -> Option<SaveSlot> {
    let mut kind = slot_kind(folder)?;
    let params = newest(files, PARAMS_FILE);
    let data = newest(files, DATA_FILE);
    if params.is_none() && data.is_none() {
        return None;
    }
    let header = params
        .and_then(read_params)
        .or_else(|| data.and_then(|file| read_data_header(file, slot_number(folder))))
        .unwrap_or_default();
    let code = header.detail.as_deref().and_then(DetailCode::parse);
    if let Some(code) = &code {
        if code.difficulty == PROFILE_DIFFICULTY {
            return None;
        }
        if kind == SlotKind::Manual && code.flags & BACKUP_FLAG != 0 {
            kind = SlotKind::Auto;
        }
    }

    let mut stats = Vec::new();
    let place = code
        .as_ref()
        .and_then(DetailCode::place)
        .map(|(chapter, section)| {
            (
                label(LABEL_PREFIX, "chapter", chapter),
                Some(label(LABEL_PREFIX, "section", section)),
            )
        })
        .or_else(|| {
            let (chapter, section) = header.detail.as_deref().and_then(localized_place)?;
            Some((StatValue::Text(chapter), section.map(StatValue::Text)))
        });
    if let Some((chapter, section)) = place {
        stats.push(Stat::new(StatKind::Chapter, chapter));
        if let Some(section) = section {
            stats.push(Stat::new(StatKind::Location, section));
        }
    }
    if let Some(code) = &code {
        stats.push(Stat::new(
            StatKind::Playtime,
            StatValue::Seconds(u64::from(code.playtime)),
        ));
        if let Some(difficulty) = DIFFICULTIES.get(usize::from(code.difficulty)) {
            stats.push(Stat::new(
                StatKind::Difficulty,
                label(LABEL_PREFIX, "difficulty", difficulty),
            ));
        }
        stats.push(Stat::new(
            StatKind::Collectibles,
            StatValue::Integer(i64::from(code.collectibles)),
        ));
    }

    let mut paths: Vec<String> = files
        .iter()
        .map(|file| file.relative_path.clone())
        .collect();
    paths.sort();
    paths.dedup();
    Some(SaveSlot {
        id: folder.to_owned(),
        kind,
        title: header.subtitle,
        saved_at_ms: newest_modified_at(files),
        playthrough: None,
        stats,
        thumbnail: None,
        files: paths,
    })
}

fn slot_kind(folder: &str) -> Option<SlotKind> {
    match folder.strip_prefix(FOLDER_PREFIX)? {
        "0A" => Some(SlotKind::Auto),
        _ => slot_number(folder).map(|_| SlotKind::Manual),
    }
}

/// `SAVEFILE00` is the game's "Save Game 1".
fn slot_number(folder: &str) -> Option<u32> {
    let suffix = folder.strip_prefix(FOLDER_PREFIX)?;
    if !(2..=3).contains(&suffix.len()) || !suffix.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    suffix.parse::<u32>().ok()?.checked_add(1)
}

fn newest<'a>(files: &[&'a SaveFile], name: &str) -> Option<&'a SaveFile> {
    files
        .iter()
        .copied()
        .filter(|file| file.file_name() == name)
        .max_by_key(|file| file.modified_at_ms)
}

#[derive(Default)]
struct Header {
    subtitle: Option<String>,
    detail: Option<String>,
}

fn read_params(file: &SaveFile) -> Option<Header> {
    let bytes = file.read_prefix(MAX_PARAMS_BYTES).ok()?;
    let root: Value = serde_json::from_slice(strip_bom(&bytes)).ok()?;
    let text = |key: &str| root.get(key).and_then(Value::as_str);
    Some(Header {
        subtitle: text("subTitle").and_then(display_text),
        detail: Some(text("detail")?.to_owned()),
    })
}

/// The header subtitle lacks the slot number that `params.json` appends ("Save Game" vs "Save Game 4").
fn read_data_header(file: &SaveFile, slot_number: Option<u32>) -> Option<Header> {
    let end = HEADER_DETAIL.0 + HEADER_DETAIL.1;
    let bytes = file.read_prefix(end as u64).ok()?;
    let detail = c_string(&bytes, HEADER_DETAIL)?;
    DetailCode::parse(detail)?;
    let subtitle = c_string(&bytes, HEADER_SUBTITLE).map(|subtitle| match slot_number {
        Some(number) => format!("{subtitle} {number}"),
        None => subtitle.to_owned(),
    });
    Some(Header {
        subtitle: subtitle.as_deref().and_then(display_text),
        detail: Some(detail.to_owned()),
    })
}

fn c_string(bytes: &[u8], (offset, max_len): (usize, usize)) -> Option<&str> {
    let field = bytes.get(offset..)?;
    let field = &field[..field.len().min(max_len)];
    let len = field
        .iter()
        .position(|&byte| byte == 0)
        .unwrap_or(field.len());
    std::str::from_utf8(&field[..len]).ok()
}

fn display_text(text: &str) -> Option<String> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (!text.is_empty()).then_some(text)
}

/// Twelve bytes, hex encoded: difficulty, section, chapter, story, flags (u16), collectibles (u16), playtime seconds (u32), big-endian.
struct DetailCode {
    difficulty: u8,
    section: u8,
    chapter: u8,
    story: u8,
    flags: u16,
    collectibles: u16,
    playtime: u32,
}

impl DetailCode {
    fn parse(detail: &str) -> Option<Self> {
        let open = detail.rfind('[')?;
        let hex = detail.get(open + 1..)?.split(']').next()?;
        if hex.len() != CODE_HEX_LEN {
            return None;
        }
        let mut bytes = [0u8; CODE_HEX_LEN / 2];
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = u8::from_str_radix(hex.get(index * 2..index * 2 + 2)?, 16).ok()?;
        }
        Some(Self {
            difficulty: bytes[0],
            section: bytes[1],
            chapter: bytes[2],
            story: bytes[3],
            flags: u16::from_be_bytes([bytes[4], bytes[5]]),
            collectibles: u16::from_be_bytes([bytes[6], bytes[7]]),
            playtime: u32::from_be_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]),
        })
    }

    fn place(&self) -> Option<(&'static str, &'static str)> {
        if self.story != MAIN_STORY {
            return None;
        }
        let (chapter, section) = *SECTIONS.get(usize::from(self.section))?;
        if chapter != self.chapter {
            return None;
        }
        Some((CHAPTERS.get(usize::from(chapter))?, section))
    }
}

fn localized_place(detail: &str) -> Option<(String, Option<String>)> {
    let line = detail.lines().next()?.trim();
    if line.is_empty() || line.starts_with('[') {
        return None;
    }
    Some(match line.split_once(" - ") {
        Some((chapter, section)) => (chapter.trim().to_owned(), display_text(section)),
        None => (line.to_owned(), None),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::cataloged_label;

    const RAW_PATH: &str = "<home>/Saved Games/The Last of Us Part I/users/<storeUserId>/savedata";

    fn code(
        difficulty: u8,
        section: u8,
        chapter: u8,
        flags: u16,
        collectibles: u16,
        seconds: u32,
    ) -> String {
        story_code(
            MAIN_STORY,
            difficulty,
            section,
            chapter,
            flags,
            collectibles,
            seconds,
        )
    }

    fn story_code(
        story: u8,
        difficulty: u8,
        section: u8,
        chapter: u8,
        flags: u16,
        collectibles: u16,
        seconds: u32,
    ) -> String {
        format!("[{difficulty:02X}{section:02X}{chapter:02X}{story:02X}{flags:04X}{collectibles:04X}{seconds:08X}]")
    }

    fn detail(place: &str, code: &str) -> String {
        format!("{place}\n1 hr 2 min 3 sec\nChallenge X\nCollected 9 Collectibles\n\n{code}")
    }

    fn params(subtitle: &str, detail: &str) -> Vec<u8> {
        serde_json::json!({
            "title": "Game Title ",
            "subTitle": subtitle,
            "detail": detail,
            "userParam": 1,
            "mtime": 0,
        })
        .to_string()
        .into_bytes()
    }

    fn usr_data(subtitle: &str, detail: &str) -> Vec<u8> {
        let mut bytes = vec![0u8; 0x1000];
        bytes[HEADER_SUBTITLE.0..HEADER_SUBTITLE.0 + subtitle.len()]
            .copy_from_slice(subtitle.as_bytes());
        bytes[HEADER_DETAIL.0..HEADER_DETAIL.0 + detail.len()].copy_from_slice(detail.as_bytes());
        bytes
    }

    fn file(path: &str, bytes: Vec<u8>, modified_at_ms: i64) -> SaveFile {
        let mut file = SaveFile::from_bytes(RAW_PATH, path, bytes);
        file.modified_at_ms = Some(modified_at_ms);
        file
    }

    #[test]
    fn reads_the_autosave_from_params_json() {
        let detail = detail("Lakeside - Cabins", &code(2, 24, 8, 0, 92, 57_385));
        let files = vec![
            file(
                "SAVEFILE0A/params.json",
                params("CURRENT  AUTOSAVE ", &detail),
                10,
            ),
            file("SAVEFILE0A/USR-DATA", vec![0; 16], 20),
            file("SAVEFILE0A/ICN-ID", vec![1, 2, 3, 4], 5),
        ];
        let slots = read_slots(&files);
        assert_eq!(slots.len(), 1);

        let slot = &slots[0];
        assert_eq!(slot.id, "SAVEFILE0A");
        assert_eq!(slot.kind, SlotKind::Auto);
        assert_eq!(slot.title.as_deref(), Some("CURRENT AUTOSAVE"));
        assert_eq!(slot.saved_at_ms, Some(20));
        assert_eq!(
            slot.stat(StatKind::Chapter),
            Some(&cataloged_label(
                "the_last_of_us_part_1.chapter.lakeside_resort",
                "Lakeside Resort"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Location),
            Some(&cataloged_label(
                "the_last_of_us_part_1.section.cabin_resort",
                "Cabin Resort"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Playtime),
            Some(&StatValue::Seconds(57_385))
        );
        assert_eq!(
            slot.stat(StatKind::Difficulty),
            Some(&cataloged_label(
                "the_last_of_us_part_1.difficulty.moderate",
                "Moderate"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Collectibles),
            Some(&StatValue::Integer(92))
        );
        assert_eq!(slot.files.len(), 3);
        assert!(slot.thumbnail.is_none());
    }

    #[test]
    fn numbered_slots_are_manual_unless_flagged_as_backup() {
        let files = vec![
            file(
                "SAVEFILE03/params.json",
                params(
                    "Save Game 4",
                    &detail("a - b", &code(3, 13, 4, 0, 30, 22_186)),
                ),
                1,
            ),
            file(
                "SAVEFILE05/params.json",
                params(
                    "BACKUP SAVE 6",
                    &detail("a - b", &code(3, 12, 3, 8, 15, 24_721)),
                ),
                2,
            ),
        ];
        let slots = read_slots(&files);
        assert_eq!(slots.len(), 2);
        assert_eq!(
            (slots[0].id.as_str(), slots[0].kind),
            ("SAVEFILE03", SlotKind::Manual)
        );
        assert_eq!(
            (slots[1].id.as_str(), slots[1].kind),
            ("SAVEFILE05", SlotKind::Auto)
        );
        assert_eq!(
            slots[1].stat(StatKind::Chapter),
            Some(&cataloged_label(
                "the_last_of_us_part_1.chapter.bill_s_town",
                "Bill's Town"
            ))
        );
        assert_eq!(
            slots[1].stat(StatKind::Location),
            Some(&cataloged_label(
                "the_last_of_us_part_1.section.high_school_escape",
                "High School Escape"
            ))
        );
        assert_eq!(
            slots[1].stat(StatKind::Difficulty),
            Some(&cataloged_label(
                "the_last_of_us_part_1.difficulty.hard",
                "Hard"
            ))
        );
    }

    #[test]
    fn falls_back_to_the_usr_data_header() {
        let detail = detail("QZ - Wall", &code(3, 2, 1, 0, 3, 2_059));
        let files = vec![
            file("SAVEFILE03/params.json", b"not json".to_vec(), 1),
            file("SAVEFILE03/USR-DATA", usr_data("Save Game", &detail), 1),
            file(
                "SAVEFILE0A/USR-DATA",
                usr_data("CURRENT AUTOSAVE", &detail),
                1,
            ),
        ];
        let slots = read_slots(&files);
        assert_eq!(slots[0].kind, SlotKind::Manual);
        assert_eq!(slots[0].title.as_deref(), Some("Save Game 4"));
        assert_eq!(
            slots[0].stat(StatKind::Location),
            Some(&cataloged_label(
                "the_last_of_us_part_1.section.beyond_the_wall",
                "Beyond The Wall"
            ))
        );
        assert_eq!(
            slots[0].stat(StatKind::Playtime),
            Some(&StatValue::Seconds(2_059))
        );
        assert_eq!(slots[1].title.as_deref(), Some("CURRENT AUTOSAVE"));
    }

    #[test]
    fn uses_localized_text_when_the_code_is_not_a_known_main_story_section() {
        let other_story = story_code(5, 2, 3, 1, 0, 1, 60);
        let files = vec![file(
            "SAVEFILE01/params.json",
            params("Save 2", &detail("Mall - Arcade", &other_story)),
            1,
        )];
        let slot = &read_slots(&files)[0];
        assert_eq!(
            slot.stat(StatKind::Chapter),
            Some(&StatValue::Text("Mall".into()))
        );
        assert_eq!(
            slot.stat(StatKind::Location),
            Some(&StatValue::Text("Arcade".into()))
        );
        assert_eq!(slot.stat(StatKind::Playtime), Some(&StatValue::Seconds(60)));

        let mismatched = detail("Kapitel - Abschnitt", &code(2, 24, 3, 0, 0, 1));
        let files = vec![file("SAVEFILE02/params.json", params("x", &mismatched), 1)];
        let slot = &read_slots(&files)[0];
        assert_eq!(
            slot.stat(StatKind::Chapter),
            Some(&StatValue::Text("Kapitel".into()))
        );
    }

    #[test]
    fn skips_the_profile_and_unrelated_folders() {
        let profile = params("Profile", "\n[FF0000000000000000000000]");
        let files = vec![
            file("SAVEFILE0P/params.json", profile.clone(), 1),
            file("SAVEFILE0P/USR-DATA", vec![0; 64], 1),
            file("SAVEFILE07/params.json", profile, 1),
            file("screeninfo.cfg", b"x".to_vec(), 1),
            file("achievements.ini", b"x".to_vec(), 1),
            file("SAVEFILE09/ICN-ID", vec![0; 4], 1),
        ];
        assert!(read_slots(&files).is_empty());
    }

    #[test]
    fn garbage_and_truncated_files_give_a_slot_without_stats() {
        let files = vec![
            file(
                "SAVEFILE00/params.json",
                b"{\"detail\":\"x [0102".to_vec(),
                1,
            ),
            file("SAVEFILE00/USR-DATA", vec![0xff; 0x5b0], 1),
            file(
                "SAVEFILE0A/params.json",
                params("Auto", "Town - Street\n[ZZ0000000000000000000000]"),
                1,
            ),
            file("SAVEFILE01/USR-DATA", Vec::new(), 1),
        ];
        let slots = read_slots(&files);
        assert_eq!(slots.len(), 3);
        assert!(slots[0].stats.is_empty());
        assert!(slots[1].stats.is_empty());
        assert_eq!(slots[2].id, "SAVEFILE0A");
        assert_eq!(
            slots[2].stat(StatKind::Chapter),
            Some(&StatValue::Text("Town".into()))
        );
        assert_eq!(slots[2].stat(StatKind::Playtime), None);
    }

    #[test]
    fn picks_the_newest_copy_when_a_slot_appears_twice() {
        let old = params("Old", &detail("a - b", &code(2, 0, 0, 0, 0, 10)));
        let new = params("New", &detail("a - b", &code(2, 6, 2, 0, 6, 5_367)));
        let files = vec![
            file("SAVEFILE00/params.json", old, 1),
            file("SAVEFILE00/params.json", new, 2),
        ];
        let slots = read_slots(&files);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].title.as_deref(), Some("New"));
        assert_eq!(slots[0].files, vec!["SAVEFILE00/params.json".to_owned()]);
        assert_eq!(
            slots[0].stat(StatKind::Location),
            Some(&cataloged_label(
                "the_last_of_us_part_1.section.downtown",
                "Downtown"
            ))
        );
    }

    #[test]
    fn slot_kinds() {
        assert_eq!(slot_kind("SAVEFILE0A"), Some(SlotKind::Auto));
        assert_eq!(slot_kind("SAVEFILE00"), Some(SlotKind::Manual));
        assert_eq!(slot_kind("SAVEFILE19"), Some(SlotKind::Manual));
        assert_eq!(slot_kind("SAVEFILE0P"), None);
        assert_eq!(slot_kind("SAVEFILE"), None);
        assert_eq!(slot_kind("SAVEFILE1"), None);
        assert_eq!(slot_kind("SAVEDATA00"), None);
        assert_eq!(slot_number("SAVEFILE00"), Some(1));
        assert_eq!(slot_number("SAVEFILE10"), Some(11));
        assert_eq!(slot_number("SAVEFILE0A"), None);
    }

    #[test]
    fn detail_code_parsing() {
        let parsed = DetailCode::parse("x\n\n[021808030000005C0000E029]").unwrap();
        assert_eq!(
            (
                parsed.difficulty,
                parsed.section,
                parsed.chapter,
                parsed.story
            ),
            (2, 24, 8, 3)
        );
        assert_eq!(
            (parsed.flags, parsed.collectibles, parsed.playtime),
            (0, 92, 57_385)
        );
        assert!(DetailCode::parse("[0218080300]").is_none());
        assert!(DetailCode::parse("[02180803000é05C0000E029]").is_none());
        assert!(DetailCode::parse("no code").is_none());
        assert!(DetailCode::parse("[").is_none());
    }
}
