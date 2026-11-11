//! Ghost of Tsushima DIRECTOR'S CUT (Nixxes PC port): `auto.sav`, `manual_NNNN.sav` and the rolling
//! `backup_NN.sav`, each a plain little-endian stream of about 300 KB. The stream carries no field
//! tags: values follow the engine's schema and only strings are length-prefixed, so fields are found
//! from string anchors. The player record starts with the four difficulty names (each with a f32),
//! then the horse, character and world strings, then a fixed block with the run's start time
//! (microseconds since 0001-01-01, local time), playtime, time of day and days elapsed.

use crate::games::{label, lookup, newest_modified_at, no_profile, Parser};
use crate::model::{SaveSlot, SlotKind, Stat, StatKind, StatValue};
use crate::source::SaveFile;
use crate::util::find;

pub const PARSER: Parser = Parser {
    id: "ghost-of-tsushima",
    version: 1,
    steam_app_ids: &["2215430"],
    read_slots,
    labels,
    read_profile: no_profile,
    stat_names: &[(StatKind::Money, "Supplies")],
};

const LABEL_PREFIX: &str = "ghost_of_tsushima";
const MAX_SAVE_BYTES: u64 = 4 * 1024 * 1024;

/// Count 4, then the first name of the difficulty list.
const DIFFICULTY_LIST: &[u8] = b"\x04\x00\x00\x00\x04\x00\x00\x00Easy";
const LIST_NAMES: [&[u8]; 4] = [b"Easy", b"Medium", b"Hard", b"Nightmare"];
/// The current difficulty string sits right before this string, which starts this many bytes before the list.
const SHIP: &[u8] = b"\x04\x00\x00\x00Ship";
const SHIP_BEFORE_LIST: usize = 0x31;
const FLAGS_AFTER_LIST: usize = 5;
const AFTER_HORSE: usize = 15;
const AFTER_CHARACTER: usize = 32;
const WORLD_TO_CLOCK: usize = 0x5b;
const MAX_NAME: usize = 64;

/// 2020-01-01 and 2100-01-01 as microseconds since 0001-01-01.
const STARTED_MIN_US: u64 = 63_713_433_600_000_000;
const STARTED_MAX_US: u64 = 66_238_041_600_000_000;
const MAX_PLAYTIME_SECONDS: f32 = 10_000_000.0;
const MAX_DAYS: u32 = 100_000;

const SUPPLIES: &[u8] = b"\x08\x00\x00\x00Supplies";
const MAX_SUPPLIES: u32 = 10_000_000;
/// 14 progression counters of (name, three u32), the first named `Xp`; a save holds several copies.
const COUNTERS: &[u8] = b"\x0e\x00\x00\x00\x02\x00\x00\x00Xp";
const COUNTER_ENTRIES: usize = 14;
const IKI_XP: &[u8] = b"XpIki";

const DIFFICULTIES: [(&[u8], &str); 4] = [
    (b"Easy", "Easy"),
    (b"Medium", "Normal"),
    (b"Hard", "Hard"),
    (b"Nightmare", "Lethal"),
];

const WORLDS: [(&[u8], &str); 2] = [(b"tsu", "Tsushima"), (b"iki", "Iki Island")];

const IKI_ISLAND: &str = "Iki Island";

fn labels() -> Vec<(&'static str, &'static str)> {
    let difficulties = DIFFICULTIES.iter().map(|&(_, text)| ("difficulty", text));
    let worlds = WORLDS.iter().map(|&(_, text)| ("location", text));
    difficulties
        .chain(worlds)
        .chain([("content", IKI_ISLAND)])
        .collect()
}

fn read_slots(files: &[SaveFile]) -> Vec<SaveSlot> {
    let mut slots: Vec<SaveSlot> = Vec::new();
    for file in files {
        let Some((id, kind)) = slot_name(file.file_name()) else {
            continue;
        };
        let Some(slot) = read_slot(file, id, kind) else {
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

fn slot_name(name: &str) -> Option<(String, SlotKind)> {
    let stem = name.to_ascii_lowercase();
    let stem = stem.strip_suffix(".sav")?;
    if stem == "auto" {
        return Some(("auto".to_owned(), SlotKind::Auto));
    }
    let (prefix, number) = stem.split_once('_')?;
    let kind = match prefix {
        "manual" => SlotKind::Manual,
        "backup" => SlotKind::Auto,
        _ => return None,
    };
    let numbered =
        !number.is_empty() && number.len() <= 6 && number.bytes().all(|byte| byte.is_ascii_digit());
    numbered.then(|| (stem.to_owned(), kind))
}

fn read_slot(file: &SaveFile, id: String, kind: SlotKind) -> Option<SaveSlot> {
    let bytes = file.read_prefix(MAX_SAVE_BYTES).ok()?;
    let record = read_record(&bytes);
    let supplies = read_supplies(&bytes);
    if record.is_none() && supplies.is_none() {
        return None;
    }

    let mut stats = Vec::new();
    let mut playthrough = None;
    let mut world = None;
    if let Some(record) = &record {
        if let Some(clock) = &record.clock {
            stats.push(Stat::new(
                StatKind::Playtime,
                StatValue::Seconds(clock.playtime_seconds),
            ));
        }
        if let Some(text) = record.difficulty {
            stats.push(Stat::new(
                StatKind::Difficulty,
                label(LABEL_PREFIX, "difficulty", text),
            ));
        }
        world = lookup(&WORLDS, record.world);
        if let Some(text) = world {
            stats.push(Stat::new(
                StatKind::Location,
                label(LABEL_PREFIX, "location", text),
            ));
        }
        if let Some(clock) = &record.clock {
            if !record.world.is_empty() {
                playthrough = Some(format!("run-{}", clock.started_us));
            }
            // The counter is 0 on the first day.
            stats.push(Stat::new(
                StatKind::InGameDay,
                StatValue::Integer(i64::from(clock.days) + 1),
            ));
        }
    }
    if world == Some(IKI_ISLAND) || iki_started(&bytes) {
        stats.push(Stat::new(
            StatKind::Content,
            label(LABEL_PREFIX, "content", IKI_ISLAND),
        ));
    }
    if let Some(supplies) = supplies {
        stats.push(Stat::new(
            StatKind::Money,
            StatValue::Integer(i64::from(supplies)),
        ));
    }

    Some(SaveSlot {
        id,
        kind,
        title: None,
        saved_at_ms: newest_modified_at(&[file]),
        playthrough,
        stats,
        thumbnail: None,
        files: vec![file.relative_path.clone()],
    })
}

struct Record<'a> {
    difficulty: Option<&'static str>,
    world: &'a [u8],
    clock: Option<Clock>,
}

struct Clock {
    started_us: u64,
    playtime_seconds: u64,
    days: u32,
}

fn read_record(bytes: &[u8]) -> Option<Record<'_>> {
    let list = find(bytes, DIFFICULTY_LIST, 0)?;
    let mut reader = Reader::at(bytes, list.checked_add(4)?);
    for expected in LIST_NAMES {
        if reader.string()? != expected {
            return None;
        }
        reader.skip(4)?;
    }
    reader.skip(FLAGS_AFTER_LIST)?;
    reader.string()?;
    reader.skip(AFTER_HORSE)?;
    reader.string()?;
    reader.skip(AFTER_CHARACTER)?;
    let world = reader.string()?;
    reader.skip(WORLD_TO_CLOCK)?;

    Some(Record {
        difficulty: current_difficulty(bytes, list),
        world,
        clock: read_clock(&mut reader),
    })
}

fn read_clock(reader: &mut Reader) -> Option<Clock> {
    let started_us = reader.u64()?;
    let playtime = reader.f32()?;
    let time_of_day = reader.f32()?;
    let days = reader.u32()?;
    let valid = (STARTED_MIN_US..STARTED_MAX_US).contains(&started_us)
        && (0.0..MAX_PLAYTIME_SECONDS).contains(&playtime)
        && (0.0..=1.0).contains(&time_of_day)
        && days < MAX_DAYS;
    valid.then_some(Clock {
        started_us,
        playtime_seconds: playtime as u64,
        days,
    })
}

fn current_difficulty(bytes: &[u8], list: usize) -> Option<&'static str> {
    let ship = list.checked_sub(SHIP_BEFORE_LIST)?;
    if bytes.get(ship..ship.checked_add(SHIP.len())?)? != SHIP {
        return None;
    }
    DIFFICULTIES.iter().find_map(|&(name, text)| {
        let start = ship.checked_sub(name.len() + 4)?;
        let field = bytes.get(start..ship)?;
        let length = u32::try_from(name.len()).ok()?.to_le_bytes();
        (field[..4] == length && &field[4..] == name).then_some(text)
    })
}

fn read_supplies(bytes: &[u8]) -> Option<u32> {
    let at = find(bytes, SUPPLIES, 0)?;
    let mut reader = Reader::at(bytes, at.checked_add(SUPPLIES.len())?);
    let owned = reader.u32()?;
    let amount = reader.u32()?;
    match owned {
        0 => Some(0),
        _ if amount < MAX_SUPPLIES => Some(amount),
        _ => None,
    }
}

/// Iki Island legend is earned only there, so any counters block with some means the expansion started.
fn iki_started(bytes: &[u8]) -> bool {
    let mut from = 0;
    while let Some(at) = find(bytes, COUNTERS, from) {
        if iki_xp(bytes, at).is_some_and(|xp| xp > 0) {
            return true;
        }
        from = at + 1;
    }
    false
}

fn iki_xp(bytes: &[u8], block: usize) -> Option<u32> {
    let mut reader = Reader::at(bytes, block.checked_add(4)?);
    for _ in 0..COUNTER_ENTRIES {
        let name = reader.string()?;
        reader.skip(8)?;
        let total = reader.u32()?;
        if name == IKI_XP {
            return Some(total);
        }
    }
    None
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn at(bytes: &'a [u8], at: usize) -> Self {
        Self { bytes, at }
    }

    fn take(&mut self, length: usize) -> Option<&'a [u8]> {
        let end = self.at.checked_add(length)?;
        let slice = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(slice)
    }

    fn skip(&mut self, length: usize) -> Option<()> {
        self.take(length).map(|_| ())
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }

    fn f32(&mut self) -> Option<f32> {
        Some(f32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    /// Some strings count their NUL terminator in the length; callers compare the raw bytes.
    fn string(&mut self) -> Option<&'a [u8]> {
        let length = usize::try_from(self.u32()?).ok()?;
        if length > MAX_NAME {
            return None;
        }
        self.take(length)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::cataloged_label;

    const RAW_PATH: &str = "<winDocuments>/Ghost of Tsushima DIRECTOR'S CUT/<storeUserId>";
    /// 2026-11-05 18:00:05 local time.
    const STARTED_US: u64 = 63_900_000_000_000_000;

    struct Save {
        difficulty: &'static str,
        character: &'static str,
        world: &'static str,
        started_us: u64,
        playtime: f32,
        time_of_day: f32,
        days: u32,
        supplies: Option<(u32, u32)>,
        iki_xp: u32,
    }

    impl Default for Save {
        fn default() -> Self {
            Self {
                difficulty: "Medium",
                character: "hero\0",
                world: "tsu",
                started_us: STARTED_US,
                playtime: 36_000.4,
                time_of_day: 0.55,
                days: 55,
                supplies: Some((1, 206)),
                iki_xp: 0,
            }
        }
    }

    fn string(out: &mut Vec<u8>, text: &str) {
        out.extend_from_slice(&(text.len() as u32).to_le_bytes());
        out.extend_from_slice(text.as_bytes());
    }

    fn counters(out: &mut Vec<u8>, iki_xp: u32) {
        out.extend_from_slice(&[0xff; 8]);
        out.extend_from_slice(&14u32.to_le_bytes());
        for name in [
            "Xp",
            "XpIki",
            "Talent",
            "HealthPiece",
            "SamuraiPoint",
            "OmamoriSlotPiece",
            "ZanshinHealPiece",
            "NinjaToolUnlock",
            "StanceUnlock",
            "LeaderHeads",
            "SideMissionGift",
            "CharmedCats",
            "CharmedDeer",
            "CharmedMonkeys",
        ] {
            string(out, name);
            let total = match name {
                "Xp" => 22_260,
                "XpIki" => iki_xp,
                _ => 3,
            };
            for value in [7u32, 0, total] {
                out.extend_from_slice(&value.to_le_bytes());
            }
        }
    }

    fn save(save: &Save) -> Vec<u8> {
        let mut out = Vec::new();
        for value in [334u32, 0, 0x1234_5678, 49] {
            out.extend_from_slice(&value.to_le_bytes());
        }
        out.extend_from_slice(&[0x5a; 392]);
        counters(&mut out, 0);
        out.extend_from_slice(&[0u8; 300]);
        counters(&mut out, save.iki_xp);
        out.extend_from_slice(&[0x13, 0xad, 0xdb, 0xba, 0, 0, 0, 0]);
        string(&mut out, save.difficulty);
        out.extend_from_slice(SHIP);
        out.extend_from_slice(&2u32.to_le_bytes());
        out.extend_from_slice(&[0u8; 37]);
        out.extend_from_slice(&4u32.to_le_bytes());
        for (name, seconds) in [
            ("Easy", 0.0f32),
            ("Medium", 9.0),
            ("Hard", 0.0),
            ("Nightmare", 0.0),
        ] {
            string(&mut out, name);
            out.extend_from_slice(&seconds.to_le_bytes());
        }
        out.extend_from_slice(&[1, 1, 0, 1, 0]);
        string(&mut out, "White");
        out.extend_from_slice(&[0, 0, 0, 0, 1, 0, 0, 0x80, 0x3f, 0, 0, 0, 0, 0, 0]);
        string(&mut out, save.character);
        out.extend_from_slice(&[0x3d; 32]);
        string(&mut out, save.world);
        out.extend_from_slice(&[0u8; 0x5b]);
        out.extend_from_slice(&save.started_us.to_le_bytes());
        out.extend_from_slice(&save.playtime.to_le_bytes());
        out.extend_from_slice(&save.time_of_day.to_le_bytes());
        out.extend_from_slice(&save.days.to_le_bytes());
        out.extend_from_slice(&[7, 2, 0x40, 0xb1, 0xb3, 0xa9]);
        out.extend_from_slice(&[0u8; 500]);
        string(&mut out, "Hide");
        for value in [1u32, 23, 0, 0, u32::MAX] {
            out.extend_from_slice(&value.to_le_bytes());
        }
        if let Some((owned, amount)) = save.supplies {
            out.extend_from_slice(SUPPLIES);
            for value in [owned, amount, 0, 0, u32::MAX] {
                out.extend_from_slice(&value.to_le_bytes());
            }
        }
        out.extend_from_slice(&[0u8; 64]);
        let size = out.len() as u32;
        out[4..8].copy_from_slice(&size.to_le_bytes());
        out
    }

    fn file(name: &str, save_data: &Save, modified_at_ms: Option<i64>) -> SaveFile {
        let mut file = SaveFile::from_bytes(RAW_PATH, name, self::save(save_data));
        file.modified_at_ms = modified_at_ms;
        file
    }

    #[test]
    fn reads_the_player_record_and_supplies() {
        let slots = read_slots(&[file("manual_0012.sav", &Save::default(), Some(7))]);
        assert_eq!(slots.len(), 1);
        let slot = &slots[0];
        assert_eq!(
            (slot.id.as_str(), slot.kind),
            ("manual_0012", SlotKind::Manual)
        );
        assert_eq!(slot.saved_at_ms, Some(7));
        assert_eq!(slot.playthrough.as_deref(), Some("run-63900000000000000"));
        assert_eq!(
            slot.stat(StatKind::Playtime),
            Some(&StatValue::Seconds(36_000))
        );
        assert_eq!(
            slot.stat(StatKind::Difficulty),
            Some(&cataloged_label(
                "ghost_of_tsushima.difficulty.normal",
                "Normal"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Location),
            Some(&cataloged_label(
                "ghost_of_tsushima.location.tsushima",
                "Tsushima"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::InGameDay),
            Some(&StatValue::Integer(56))
        );
        assert_eq!(slot.stat(StatKind::Money), Some(&StatValue::Integer(206)));
        assert_eq!(slot.stat(StatKind::Content), None);
        assert_eq!(slot.files, ["manual_0012.sav"]);
    }

    #[test]
    fn iki_island_world_and_lethal_difficulty() {
        let save = Save {
            difficulty: "Nightmare",
            world: "iki",
            ..Save::default()
        };
        let slots = read_slots(&[file("auto.sav", &save, None)]);
        let slot = &slots[0];
        assert_eq!((slot.id.as_str(), slot.kind), ("auto", SlotKind::Auto));
        assert_eq!(
            slot.stat(StatKind::Difficulty),
            Some(&cataloged_label(
                "ghost_of_tsushima.difficulty.lethal",
                "Lethal"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Location),
            Some(&cataloged_label(
                "ghost_of_tsushima.location.iki_island",
                "Iki Island"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Content),
            Some(&cataloged_label(
                "ghost_of_tsushima.content.iki_island",
                "Iki Island"
            ))
        );
    }

    #[test]
    fn iki_legend_on_tsushima_still_marks_the_expansion() {
        let save = Save {
            iki_xp: 1640,
            ..Save::default()
        };
        let slots = read_slots(&[file("backup_03.sav", &save, None)]);
        assert_eq!(
            (slots[0].id.as_str(), slots[0].kind),
            ("backup_03", SlotKind::Auto)
        );
        assert!(slots[0].stat(StatKind::Content).is_some());
        assert_eq!(
            slots[0].stat(StatKind::Location),
            Some(&cataloged_label(
                "ghost_of_tsushima.location.tsushima",
                "Tsushima"
            ))
        );
    }

    #[test]
    fn prologue_save_has_no_world_and_no_run() {
        let save = Save {
            character: "young_hero\0",
            world: "",
            supplies: Some((0, 0)),
            days: 0,
            ..Save::default()
        };
        let slots = read_slots(&[file("manual_0000.sav", &save, None)]);
        let slot = &slots[0];
        assert_eq!(slot.playthrough, None);
        assert_eq!(slot.stat(StatKind::Location), None);
        assert_eq!(slot.stat(StatKind::InGameDay), Some(&StatValue::Integer(1)));
        assert_eq!(slot.stat(StatKind::Money), Some(&StatValue::Integer(0)));
        assert!(slot.stat(StatKind::Playtime).is_some());
    }

    #[test]
    fn implausible_clock_drops_the_fixed_fields_only() {
        let save = Save {
            started_us: 12,
            ..Save::default()
        };
        let slots = read_slots(&[file("auto.sav", &save, None)]);
        let slot = &slots[0];
        assert_eq!(slot.stat(StatKind::Playtime), None);
        assert_eq!(slot.stat(StatKind::InGameDay), None);
        assert_eq!(slot.playthrough, None);
        assert!(slot.stat(StatKind::Difficulty).is_some());
        assert!(slot.stat(StatKind::Money).is_some());

        let save = Save {
            time_of_day: 7.5,
            ..Save::default()
        };
        let slots = read_slots(&[file("auto.sav", &save, None)]);
        assert_eq!(slots[0].stat(StatKind::Playtime), None);
    }

    #[test]
    fn unknown_difficulty_and_world_are_left_out() {
        let save = Save {
            difficulty: "Brutal",
            world: "xyz",
            ..Save::default()
        };
        let slots = read_slots(&[file("auto.sav", &save, None)]);
        assert_eq!(slots[0].stat(StatKind::Difficulty), None);
        assert_eq!(slots[0].stat(StatKind::Location), None);
        assert!(slots[0].stat(StatKind::Playtime).is_some());
    }

    #[test]
    fn newest_copy_of_a_slot_wins() {
        let older = Save {
            playtime: 60.0,
            ..Save::default()
        };
        let mut other_account = file("auto.sav", &older, Some(1));
        other_account.raw_path = "<winDocuments>/Ghost of Tsushima DIRECTOR'S CUT/other".to_owned();
        let slots = read_slots(&[other_account, file("auto.sav", &Save::default(), Some(2))]);
        assert_eq!(slots.len(), 1);
        assert_eq!(
            slots[0].stat(StatKind::Playtime),
            Some(&StatValue::Seconds(36_000))
        );
    }

    #[test]
    fn garbage_and_truncated_files_give_nothing_or_less() {
        let garbage = SaveFile::from_bytes(RAW_PATH, "auto.sav", vec![0xff; 4096]);
        assert!(read_slots(&[garbage]).is_empty());
        let empty = SaveFile::from_bytes(RAW_PATH, "manual_0001.sav", Vec::new());
        assert!(read_slots(&[empty]).is_empty());
        let full = save(&Save::default());
        for cut in (0..full.len()).step_by(13) {
            let truncated = SaveFile::from_bytes(RAW_PATH, "auto.sav", full[..cut].to_vec());
            let slots = read_slots(&[truncated]);
            assert!(slots.len() <= 1);
        }
        let mut long_name = full.clone();
        let list = find(&long_name, DIFFICULTY_LIST, 0).unwrap();
        long_name[list + 4..list + 8].copy_from_slice(&u32::MAX.to_le_bytes());
        let slots = read_slots(&[SaveFile::from_bytes(RAW_PATH, "auto.sav", long_name)]);
        assert_eq!(slots[0].stat(StatKind::Playtime), None);
        assert!(slots[0].stat(StatKind::Money).is_some());
    }

    #[test]
    fn slot_names() {
        assert_eq!(slot_name("auto.sav"), Some(("auto".into(), SlotKind::Auto)));
        assert_eq!(
            slot_name("manual_0003.sav"),
            Some(("manual_0003".into(), SlotKind::Manual))
        );
        assert_eq!(
            slot_name("BACKUP_05.SAV"),
            Some(("backup_05".into(), SlotKind::Auto))
        );
        assert_eq!(slot_name("manual_.sav"), None);
        assert_eq!(slot_name("manual_x1.sav"), None);
        assert_eq!(slot_name("user.pso"), None);
        assert_eq!(slot_name("settings.dat"), None);
        assert_eq!(slot_name("1.jpg"), None);
    }

    #[test]
    fn other_files_are_ignored() {
        let bytes = save(&Save::default());
        let files = [
            SaveFile::from_bytes(RAW_PATH, "user.pso", bytes.clone()),
            SaveFile::from_bytes(RAW_PATH, "crs/settings.dat", bytes.clone()),
            SaveFile::from_bytes(RAW_PATH, "images/1.jpg", bytes),
        ];
        assert!(read_slots(&files).is_empty());
    }
}
