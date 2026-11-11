//! Dark Souls III: `DS30000.sl2` (Seamless Co-op: `DS30000.co2`) is a BND4 archive with ten
//! character slots (USER_DATA000-009), the load screen summary (USER_DATA010) and regulation.
//! Each entry is an MD5, a 16-byte IV and AES-128-CBC ciphertext under the fixed key published by
//! tremwil/DS3SaveUnpacker; the plaintext starts with its own u32 length. CBC lets any block be
//! decrypted from the one before it, so only the summary head and the parts of active slots that
//! are read get decrypted, in 16 KiB chunks. Layouts follow JKAnderson/SoulsTemplates
//! (USER_DATA000_DS3.bt, USER_DATA010_DS3.bt); the walk from the stat block to the event flags
//! follows alfizari's DS3 save editor, and flag addresses match darthdemono/sl2-analyzer's table.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use crate::games::{label, lookup, newest_modified_at, Parser};
use crate::model::{SaveSlot, SlotKind, Stat, StatKind, StatValue};
use crate::source::{FileContent, SaveFile};
use crate::util::{crc32, u32_le, u64_le};

pub const PARSER: Parser = Parser {
    id: "dark-souls-3",
    version: 1,
    steam_app_ids: &["374320"],
    read_slots,
    labels,
    read_profile: crate::games::no_profile,
    stat_names: &[
        (StatKind::Money, "Souls"),
        (StatKind::Reputation, "Covenant"),
        (StatKind::QuestsCompleted, "Lords of Cinder"),
    ],
};

const LABEL_PREFIX: &str = "dark_souls_3";

const KEY: [u8; BLOCK] = [
    0xFD, 0x46, 0x4D, 0x69, 0x5E, 0x69, 0xA3, 0x9A, 0x10, 0xE3, 0x19, 0xA7, 0xAC, 0xE8, 0xB7, 0xFA,
];
const ROUND_KEYS: RoundKeys = expand_key(KEY);
const BLOCK: usize = 16;

const ENTRY_TABLE: usize = 0x40;
const ENTRY_LEN: usize = 0x20;
const SLOT_COUNT: usize = 10;
const SUMMARY_ENTRY: usize = 10;
const MAX_ENTRIES: usize = 64;
const HEADER_LEN: usize = ENTRY_TABLE + (SUMMARY_ENTRY + 1) * ENTRY_LEN;
const IV_AT: u64 = 0x10;
const CIPHER_AT: u64 = 0x20;
const MAX_CIPHER_LEN: usize = 0x10_0000;
const CHUNK: usize = 0x4000;

const ACTIVE_FLAGS: usize = 0x1098;
const PROFILES: usize = ACTIVE_FLAGS + SLOT_COUNT;
const PROFILE_LEN: usize = 0x22A;
const SUMMARY_LEN: usize = PROFILES + SLOT_COUNT * PROFILE_LEN;
const NAME_LEN: usize = 0x20;
const PROFILE_LEVEL: usize = 0x22;
const PROFILE_SECONDS: usize = 0x26;
const PROFILE_AREA: usize = 0x32;
const PROFILE_FACE: usize = 0x3A;
const PROFILE_COVENANT: usize = 0x1FE;
const FACE: &[u8] = b"FACE";

/// The slot header length; the item table starts 4 bytes after it.
const SLOT_HEADER_LEN: usize = 0x10;
const HEADER_LENS: [u32; 2] = [0x5C, 0x6C];
const ITEM_SLOTS: usize = 6144;
const ITEM_LEN: usize = 8;
const EQUIPMENT_ITEM_LEN: usize = 60;

const STATS_READ: usize = 0xA4;
/// Vigor, Attunement, Endurance, Strength, Dexterity, Intelligence, Faith, Luck, then Vitality.
const ATTRIBUTES: [usize; 9] = [0x34, 0x38, 0x3C, 0x40, 0x44, 0x48, 0x4C, 0x50, 0x5C];
const STATS_LEVEL: usize = 0x60;
const STATS_SOULS: usize = 0x64;
const STATS_NAME: usize = 0x78;
const STATS_CLASS: usize = 0x9E;
const STATS_GIFT: usize = 0xA0;
/// Soul level is the sum of the nine attributes minus 89: a Deprived has ten in each at level 1.
const LEVEL_BASE: u32 = 89;
const MAX_ATTRIBUTE: u32 = 99;
const MAX_LEVEL: u32 = 802;
const MAX_SOULS: u32 = 999_999_999;
const EQUIPPED_COVENANT: usize = 0x1F0 + 0xC8;

const STATS_TO_LIST: usize = 0x31C + 0x8808 + 0x11C;
const LIST_TO_GESTURES: usize = 0x18C + 4 + 0x8800 + 0xC + 0xA4;
const GESTURES_TO_CYCLE: usize = 0x92;
const CYCLE_TO_FLAG_SECTION: usize = 0xBCC;
const FLAG_SECTION_LEN: usize = 0x33E5E;
const SECTION_TO_FLAGS: usize = 0x5D;
const MAX_LIST: u32 = 0x10000;
const MAX_CYCLE: u16 = 99;
const FLAGS_READ: usize = 0x8000;
/// Event flags are sparse (about 0.2% set); a walk that went astray lands on denser data.
const MIN_BITS_PER_SET_FLAG: usize = 100;

const MAP_FLAGS_AT: usize = 0xF00;
const MAP_FLAGS_LEN: usize = 0x500;
const MAP_FLAG_BASE: u32 = 10_000_000;
/// Event flag `1CCCCnnn` lives in the block of map code `CCCC` (`mAA_BB` is `AA * 100 + BB * 10`).
const FLAG_BLOCKS: [(u32, usize); 16] = [
    (3000, 0),
    (3010, 1),
    (3100, 2),
    (3200, 4),
    (3300, 6),
    (3410, 8),
    (3500, 9),
    (3700, 12),
    (3800, 13),
    (3900, 14),
    (4000, 15),
    (4100, 16),
    (4500, 17),
    (5000, 20),
    (5100, 21),
    (5110, 22),
];

const CLASSES: [&str; 10] = [
    "Knight",
    "Mercenary",
    "Warrior",
    "Herald",
    "Thief",
    "Assassin",
    "Sorcerer",
    "Pyromancer",
    "Cleric",
    "Deprived",
];

/// Indexed by the map code of the load screen area (`AA * 100 + BB * 10 + sub-area`).
const MAPS: [(u32, &str); 20] = [
    (3000, "High Wall of Lothric / Consumed King's Garden"),
    (3010, "Lothric Castle"),
    (3100, "Undead Settlement"),
    (3200, "Archdragon Peak"),
    (3300, "Road of Sacrifices / Farron Keep"),
    (3410, "Grand Archives"),
    (3500, "Cathedral of the Deep"),
    (3700, "Irithyll of the Boreal Valley / Anor Londo"),
    (3800, "Catacombs of Carthus / Smouldering Lake"),
    (3900, "Irithyll Dungeon / Profaned Capital"),
    (4000, "Cemetery of Ash / Firelink Shrine"),
    (4100, "Kiln of the First Flame"),
    (4500, "Painted World of Ariandel"),
    (4600, "Grand Roof Arena"),
    (4700, "Kiln of Flame Arena"),
    (5000, "The Dreg Heap"),
    (5100, "The Ringed City"),
    (5110, "Filianore's Rest"),
    (5300, "Dragon Ruins Arena"),
    (5400, "Round Plaza Arena"),
];

/// Required bosses in the usual route order, by their "boss defeated" event flag.
const MAIN_STORY: [(u32, &str); 13] = [
    (14000800, "Defeated Iudex Gundyr"),
    (13000800, "Defeated Vordt of the Boreal Valley"),
    (13300850, "Defeated Crystal Sage"),
    (13500800, "Defeated Deacons of the Deep"),
    (13300800, "Defeated Abyss Watchers"),
    (13800800, "Defeated High Lord Wolnir"),
    (13700850, "Defeated Pontiff Sulyvahn"),
    (13700800, "Defeated Aldrich, Devourer of Gods"),
    (13900800, "Defeated Yhorm the Giant"),
    (13000890, "Defeated Dancer of the Boreal Valley"),
    (13010800, "Defeated Dragonslayer Armour"),
    (13410830, "Defeated Lothric, Younger Prince"),
    (14100800, "Defeated Soul of Cinder"),
];

/// Abyss Watchers, Aldrich, Yhorm the Giant and Lothric.
const LORDS_OF_CINDER: [u32; 4] = [13300800, 13700800, 13900800, 13410830];

/// Accessory param ids; the save may carry the ring category or handle bits above them.
const COVENANTS: [(u32, &str); 9] = [
    (10000, "Blade of the Darkmoon"),
    (10020, "Watchdogs of Farron"),
    (10030, "Aldrich Faithful"),
    (10040, "Warrior of Sunlight"),
    (10050, "Mound-makers"),
    (10060, "Way of Blue"),
    (10070, "Blue Sentinels"),
    (10080, "Rosaria's Fingers"),
    (10090, "Spears of the Church"),
];
const ITEM_ID_MASK: u32 = 0x0FFF_FFFF;

struct Dlc {
    name: &'static str,
    bosses: &'static [u32],
    maps: &'static [u32],
}

const DLCS: [Dlc; 2] = [
    Dlc {
        name: "Ashes of Ariandel",
        bosses: &[14500800, 14500860],
        maps: &[4500],
    },
    Dlc {
        name: "The Ringed City",
        bosses: &[15000800, 15100800, 15100850, 15110800],
        maps: &[5000, 5100, 5110],
    },
];

fn labels() -> Vec<(&'static str, &'static str)> {
    let classes = CLASSES.iter().map(|&text| ("class", text));
    let locations = MAPS.iter().map(|&(_, text)| ("location", text));
    let quests = MAIN_STORY.iter().map(|&(_, text)| ("quest", text));
    let covenants = COVENANTS.iter().map(|&(_, text)| ("covenant", text));
    let content = DLCS.iter().map(|dlc| ("content", dlc.name));
    classes
        .chain(locations)
        .chain(quests)
        .chain(covenants)
        .chain(content)
        .collect()
}

fn read_slots(files: &[SaveFile]) -> Vec<SaveSlot> {
    let mut slots: Vec<SaveSlot> = Vec::new();
    for file in files {
        let Some(prefix) = id_prefix(file.file_name()) else {
            continue;
        };
        for slot in read_file(file, &prefix) {
            match slots.iter_mut().find(|existing| existing.id == slot.id) {
                Some(existing) if existing.saved_at_ms < slot.saved_at_ms => *existing = slot,
                Some(_) => {}
                None => slots.push(slot),
            }
        }
    }
    slots
}

fn id_prefix(file_name: &str) -> Option<String> {
    let name = file_name.to_ascii_lowercase();
    let (stem, extension) = name.split_once('.')?;
    let number = stem.strip_prefix("ds3")?;
    if number.len() != 4 || !number.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let mode = match extension {
        "sl2" => "",
        "co2" => "co2-",
        _ => return None,
    };
    let file = if number == "0000" {
        String::new()
    } else {
        format!("ds3{number}-")
    };
    Some(format!("{mode}{file}"))
}

#[derive(Clone, Copy)]
struct Entry {
    offset: u64,
    size: u64,
}

fn read_file(file: &SaveFile, prefix: &str) -> Vec<SaveSlot> {
    let Some(mut source) = Source::open(file) else {
        return Vec::new();
    };
    let Some(entries) = source
        .read_at(0, HEADER_LEN)
        .and_then(|header| read_entries(&header))
    else {
        return Vec::new();
    };
    let Some(summary) = read_summary(&mut source, entries[SUMMARY_ENTRY]) else {
        return Vec::new();
    };

    let saved_at_ms = newest_modified_at(&[file]);
    let mut slots = Vec::new();
    for (index, (&active, profile)) in summary.active.iter().zip(&summary.profiles).enumerate() {
        if !active {
            continue;
        }
        let character = read_character(&mut source, entries[index], profile.as_ref());
        let slot = Slot {
            index,
            profile: profile.as_ref(),
            character: character.as_ref(),
        };
        if let Some(slot) = to_slot(file, prefix, saved_at_ms, &slot) {
            slots.push(slot);
        }
    }
    slots
}

fn read_entries(header: &[u8]) -> Option<Vec<Entry>> {
    let count = usize::try_from(u32_le(header, 0x0C)?).ok()?;
    if header.get(..4)? != b"BND4"
        || !(SUMMARY_ENTRY + 1..=MAX_ENTRIES).contains(&count)
        || u64_le(header, 0x20)? != ENTRY_LEN as u64
    {
        return None;
    }
    (0..=SUMMARY_ENTRY)
        .map(|index| {
            let at = ENTRY_TABLE + index * ENTRY_LEN;
            Some(Entry {
                size: u64_le(header, at + 0x08)?,
                offset: u64::from(u32_le(header, at + 0x10)?),
            })
        })
        .collect()
}

struct Summary {
    active: [bool; SLOT_COUNT],
    profiles: Vec<Option<Profile>>,
}

struct Profile {
    name: Option<String>,
    name_units: Vec<u8>,
    level: Option<u32>,
    seconds: Option<u32>,
    area: Option<u16>,
    covenant: Option<u32>,
}

fn read_summary(source: &mut Source, entry: Entry) -> Option<Summary> {
    let mut plain = Plaintext::open(source, entry)?;
    let data_end = plain.data_end()?;
    if data_end < SUMMARY_LEN {
        return None;
    }
    let summary = plain.read(0, SUMMARY_LEN)?;
    let flags = summary.get(ACTIVE_FLAGS..PROFILES)?;
    if flags.iter().any(|&flag| flag > 1) {
        return None;
    }
    let mut active = [false; SLOT_COUNT];
    for (active, &flag) in active.iter_mut().zip(flags) {
        *active = flag == 1;
    }
    let profiles = summary
        .get(PROFILES..)?
        .as_chunks::<PROFILE_LEN>()
        .0
        .iter()
        .map(|profile| read_profile(profile))
        .collect();
    Some(Summary { active, profiles })
}

fn read_profile(bytes: &[u8]) -> Option<Profile> {
    if bytes.get(PROFILE_FACE..PROFILE_FACE + FACE.len())? != FACE {
        return None;
    }
    let name_bytes = bytes.get(..NAME_LEN)?;
    Some(Profile {
        name: utf16_name(name_bytes),
        name_units: name_units(name_bytes),
        level: u32_le(bytes, PROFILE_LEVEL).filter(|level| (1..=MAX_LEVEL).contains(level)),
        seconds: u32_le(bytes, PROFILE_SECONDS),
        area: bytes
            .get(PROFILE_AREA..PROFILE_AREA + 2)
            .map(|area| u16::from_le_bytes([area[0], area[1]])),
        covenant: u32_le(bytes, PROFILE_COVENANT),
    })
}

struct Stats {
    level: u32,
    souls: u32,
    name: Option<String>,
    name_units: Vec<u8>,
    class: u8,
    gift: u8,
}

struct Character {
    stats: Stats,
    covenant: Option<u32>,
    progress: Option<Progress>,
}

struct Progress {
    cycle: Option<u16>,
    flags: Vec<u8>,
}

fn read_character(
    source: &mut Source,
    entry: Entry,
    profile: Option<&Profile>,
) -> Option<Character> {
    let mut plain = Plaintext::open(source, entry)?;
    let data_end = plain.data_end()?;
    if data_end < SLOT_HEADER_LEN + 4 {
        return None;
    }
    let header_len = plain.u32(SLOT_HEADER_LEN)?;
    if !HEADER_LENS.contains(&header_len) {
        return None;
    }
    let items_at = usize::try_from(header_len).ok()? + 4;
    let walked =
        walk_items(&mut plain, items_at).and_then(|at| Some((at, read_stats(&mut plain, at)?)));
    let (stats_at, stats) = match walked {
        Some(found) => found,
        None => scan_stats(&mut plain, items_at, profile?)?,
    };
    Some(Character {
        covenant: plain.u32(stats_at + EQUIPPED_COVENANT),
        progress: read_progress(&mut plain, stats_at, data_end),
        stats,
    })
}

fn walk_items(plain: &mut Plaintext, mut at: usize) -> Option<usize> {
    for _ in 0..ITEM_SLOTS {
        let handle = plain.u32(at)?;
        at += match handle >> 28 {
            0x8 | 0x9 => EQUIPMENT_ITEM_LEN,
            _ => ITEM_LEN,
        };
    }
    Some(at)
}

/// For an item table the walk misreads: the stat block whose name and level match the summary.
fn scan_stats(plain: &mut Plaintext, items_at: usize, profile: &Profile) -> Option<(usize, Stats)> {
    let level = profile.level?;
    let first = items_at + ITEM_SLOTS * ITEM_LEN;
    let last = items_at + ITEM_SLOTS * EQUIPMENT_ITEM_LEN;
    (first..=last).step_by(4).find_map(|at| {
        if plain.u32(at + STATS_LEVEL)? != level {
            return None;
        }
        let stats = read_stats(plain, at)?;
        (stats.name_units == profile.name_units).then_some((at, stats))
    })
}

fn read_stats(plain: &mut Plaintext, at: usize) -> Option<Stats> {
    let block = plain.read(at, STATS_READ)?;
    let mut sum = 0;
    for offset in ATTRIBUTES {
        let value = u32_le(&block, offset)?;
        if !(1..=MAX_ATTRIBUTE).contains(&value) {
            return None;
        }
        sum += value;
    }
    let level = u32_le(&block, STATS_LEVEL)?;
    let name_bytes = block.get(STATS_NAME..STATS_NAME + NAME_LEN)?;
    let name_units = name_units(name_bytes);
    if level == 0 || sum.checked_sub(LEVEL_BASE) != Some(level) || name_units.is_empty() {
        return None;
    }
    Some(Stats {
        level,
        souls: u32_le(&block, STATS_SOULS)?,
        name: utf16_name(name_bytes),
        name_units,
        class: *block.get(STATS_CLASS)?,
        gift: *block.get(STATS_GIFT)?,
    })
}

fn read_progress(plain: &mut Plaintext, stats_at: usize, data_end: usize) -> Option<Progress> {
    let list_at = stats_at + STATS_TO_LIST;
    let list = plain.u32(list_at)?;
    if list > MAX_LIST {
        return None;
    }
    let gestures_at = list_at + 4 + usize::try_from(list).ok()? * 8 + LIST_TO_GESTURES;
    let gestures = plain.u32(gestures_at)?;
    if gestures > MAX_LIST {
        return None;
    }
    let cycle_at = gestures_at + 4 + usize::try_from(gestures).ok()? * 4 + GESTURES_TO_CYCLE;
    let section_at = cycle_at + CYCLE_TO_FLAG_SECTION;
    if section_at + FLAG_SECTION_LEN > data_end {
        return None;
    }
    let flags = plain.read(section_at + SECTION_TO_FLAGS, FLAGS_READ)?;
    let set: usize = flags.iter().map(|byte| byte.count_ones() as usize).sum();
    if set * MIN_BITS_PER_SET_FLAG > flags.len() * 8 {
        return None;
    }
    let cycle = plain.read(cycle_at, 2)?;
    let cycle = u16::from_le_bytes([*cycle.first()?, *cycle.get(1)?]);
    Some(Progress {
        cycle: (cycle <= MAX_CYCLE).then_some(cycle),
        flags,
    })
}

fn event_flag(flags: &[u8], id: u32) -> Option<bool> {
    let rest = id.checked_sub(MAP_FLAG_BASE)?;
    let (code, local) = (rest / 1000, usize::try_from(rest % 1000).ok()?);
    let &(_, block) = FLAG_BLOCKS.iter().find(|&&(known, _)| known == code)?;
    let at = MAP_FLAGS_AT + block * MAP_FLAGS_LEN + local / 32 * 4 + 3 - local % 32 / 8;
    Some((flags.get(at)? >> (7 - local % 8)) & 1 == 1)
}

struct Slot<'a> {
    index: usize,
    profile: Option<&'a Profile>,
    character: Option<&'a Character>,
}

fn to_slot(
    file: &SaveFile,
    prefix: &str,
    saved_at_ms: Option<i64>,
    slot: &Slot,
) -> Option<SaveSlot> {
    let (profile, character) = (slot.profile, slot.character);
    let stats_block = character.map(|character| &character.stats);
    let progress = character.and_then(|character| character.progress.as_ref());
    let name = profile
        .and_then(|profile| profile.name.clone())
        .or_else(|| stats_block.and_then(|stats| stats.name.clone()));
    let area = profile
        .and_then(|profile| profile.area)
        .and_then(map_code)
        .and_then(|code| Some((code, lookup(&MAPS, code)?)));

    let mut stats = Vec::new();
    if let Some(level) = stats_block
        .map(|stats| stats.level)
        .or_else(|| profile.and_then(|profile| profile.level))
    {
        stats.push(Stat::new(
            StatKind::Level,
            StatValue::Integer(i64::from(level)),
        ));
    }
    if let Some(seconds) = profile.and_then(|profile| profile.seconds) {
        stats.push(Stat::new(
            StatKind::Playtime,
            StatValue::Seconds(u64::from(seconds)),
        ));
    }
    if let Some(souls) = stats_block
        .map(|stats| stats.souls)
        .filter(|&souls| souls <= MAX_SOULS)
    {
        stats.push(Stat::new(
            StatKind::Money,
            StatValue::Integer(i64::from(souls)),
        ));
    }
    if let Some(name) = &name {
        stats.push(Stat::new(
            StatKind::CharacterName,
            StatValue::Text(name.clone()),
        ));
    }
    if let Some(class) = stats_block.and_then(|stats| CLASSES.get(usize::from(stats.class))) {
        stats.push(Stat::new(
            StatKind::CharacterClass,
            label(LABEL_PREFIX, "class", class),
        ));
    }
    if let Some((_, location)) = area {
        stats.push(Stat::new(
            StatKind::Location,
            label(LABEL_PREFIX, "location", location),
        ));
    }
    if let Some(progress) = progress {
        if let Some(&(_, quest)) = MAIN_STORY
            .iter()
            .rev()
            .find(|&&(flag, _)| event_flag(&progress.flags, flag) == Some(true))
        {
            stats.push(Stat::new(
                StatKind::Quest,
                label(LABEL_PREFIX, "quest", quest),
            ));
        }
        let lords = LORDS_OF_CINDER
            .iter()
            .filter(|&&flag| event_flag(&progress.flags, flag) == Some(true))
            .count();
        stats.push(Stat::new(
            StatKind::QuestsCompleted,
            StatValue::Progress {
                current: lords as u32,
                total: LORDS_OF_CINDER.len() as u32,
            },
        ));
        if let Some(cycle) = progress.cycle.filter(|&cycle| cycle > 0) {
            stats.push(Stat::new(
                StatKind::NewGamePlus,
                StatValue::Integer(i64::from(cycle)),
            ));
        }
    }
    if let Some(covenant) = character
        .and_then(|character| character.covenant)
        .and_then(covenant_name)
        .or_else(|| {
            profile
                .and_then(|profile| profile.covenant)
                .and_then(covenant_name)
        })
    {
        stats.push(Stat::new(
            StatKind::Reputation,
            label(LABEL_PREFIX, "covenant", covenant),
        ));
    }
    for dlc in &DLCS {
        let visited = area.is_some_and(|(code, _)| dlc.maps.contains(&code));
        let fought = progress.is_some_and(|progress| {
            dlc.bosses
                .iter()
                .any(|&flag| event_flag(&progress.flags, flag) == Some(true))
        });
        if visited || fought {
            stats.push(Stat::new(
                StatKind::Content,
                label(LABEL_PREFIX, "content", dlc.name),
            ));
        }
    }
    if stats.is_empty() {
        return None;
    }

    Some(SaveSlot {
        id: format!("{prefix}slot-{}", slot.index + 1),
        kind: SlotKind::Manual,
        title: name,
        saved_at_ms,
        playthrough: stats_block.map(|stats| playthrough(slot.index, stats)),
        stats,
        thumbnail: None,
        files: vec![file.relative_path.clone()],
    })
}

fn playthrough(index: usize, stats: &Stats) -> String {
    let mut identity = stats.name_units.clone();
    identity.extend([index as u8, stats.class, stats.gift]);
    format!("{:08x}", crc32(&identity))
}

fn map_code(area: u16) -> Option<u32> {
    let area = u32::from(area);
    (area > 0).then(|| area / 10 * 10)
}

fn covenant_name(id: u32) -> Option<&'static str> {
    lookup(&COVENANTS, id & ITEM_ID_MASK)
}

fn name_units(bytes: &[u8]) -> Vec<u8> {
    let (units, _) = bytes.as_chunks::<2>();
    let len = units
        .iter()
        .position(|unit| *unit == [0, 0])
        .unwrap_or(units.len());
    units[..len].concat()
}

fn utf16_name(bytes: &[u8]) -> Option<String> {
    let units: Vec<u16> = name_units(bytes)
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&unit| u16::from_le_bytes(unit))
        .collect();
    let name = String::from_utf16_lossy(&units).trim().to_owned();
    (!name.is_empty()).then_some(name)
}

/// One entry's plaintext, decrypted a chunk at a time on first use.
struct Plaintext<'s, 'f> {
    source: &'s mut Source<'f>,
    iv_at: u64,
    len: usize,
    chunks: Vec<Option<Option<Vec<u8>>>>,
}

impl<'s, 'f> Plaintext<'s, 'f> {
    fn open(source: &'s mut Source<'f>, entry: Entry) -> Option<Self> {
        let len = usize::try_from(entry.size.checked_sub(CIPHER_AT)?).ok()?;
        if len == 0 || len % BLOCK != 0 || len > MAX_CIPHER_LEN {
            return None;
        }
        Some(Self {
            source,
            iv_at: entry.offset.checked_add(IV_AT)?,
            len,
            chunks: vec![None; len.div_ceil(CHUNK)],
        })
    }

    /// The end of the data the leading u32 length covers.
    fn data_end(&mut self) -> Option<usize> {
        let end = usize::try_from(self.u32(0)?).ok()?.checked_add(4)?;
        (end <= self.len).then_some(end)
    }

    fn chunk(&mut self, index: usize) -> Option<&[u8]> {
        let chunk = self.chunks.get_mut(index)?;
        if chunk.is_none() {
            let start = index * CHUNK;
            let len = CHUNK.min(self.len - start) + BLOCK;
            *chunk = Some(
                self.source
                    .read_at(self.iv_at + start as u64, len)
                    .filter(|cipher| cipher.len() == len)
                    .map(|cipher| decrypt_cbc(&ROUND_KEYS, &cipher)),
            );
        }
        chunk.as_ref()?.as_deref()
    }

    fn read(&mut self, at: usize, len: usize) -> Option<Vec<u8>> {
        let end = at.checked_add(len)?;
        if end > self.len {
            return None;
        }
        let mut out = Vec::with_capacity(len);
        let mut position = at;
        while position < end {
            let index = position / CHUNK;
            let from = position % CHUNK;
            let chunk = self.chunk(index)?;
            let take = (end - position).min(chunk.len().checked_sub(from)?);
            out.extend_from_slice(chunk.get(from..from + take)?);
            position += take;
        }
        Some(out)
    }

    fn u32(&mut self, at: usize) -> Option<u32> {
        if let Some(value) = self
            .chunk(at / CHUNK)
            .and_then(|chunk| u32_le(chunk, at % CHUNK))
        {
            return Some(value);
        }
        u32_le(&self.read(at, 4)?, 0)
    }
}

type RoundKeys = [[u8; BLOCK]; 11];

const SBOX: [u8; 256] = sbox();
const INV_SBOX: [u8; 256] = invert(SBOX);
const MUL_9: [u8; 256] = mul_table(9);
const MUL_11: [u8; 256] = mul_table(11);
const MUL_13: [u8; 256] = mul_table(13);
const MUL_14: [u8; 256] = mul_table(14);

const fn gf_mul(mut a: u8, mut b: u8) -> u8 {
    let mut product = 0;
    while b != 0 {
        if b & 1 == 1 {
            product ^= a;
        }
        let carry = a & 0x80;
        a <<= 1;
        if carry != 0 {
            a ^= 0x1B;
        }
        b >>= 1;
    }
    product
}

const fn gf_inverse(x: u8) -> u8 {
    let (mut result, mut base, mut exponent) = (1u8, x, 254u32);
    while exponent > 0 {
        if exponent & 1 == 1 {
            result = gf_mul(result, base);
        }
        base = gf_mul(base, base);
        exponent >>= 1;
    }
    result
}

const fn sbox() -> [u8; 256] {
    let mut table = [0; 256];
    let mut index = 0;
    while index < 256 {
        let b = gf_inverse(index as u8);
        table[index] =
            b ^ b.rotate_left(1) ^ b.rotate_left(2) ^ b.rotate_left(3) ^ b.rotate_left(4) ^ 0x63;
        index += 1;
    }
    table
}

const fn invert(table: [u8; 256]) -> [u8; 256] {
    let mut inverse = [0; 256];
    let mut index = 0;
    while index < 256 {
        inverse[table[index] as usize] = index as u8;
        index += 1;
    }
    inverse
}

const fn mul_table(factor: u8) -> [u8; 256] {
    let mut table = [0; 256];
    let mut index = 0;
    while index < 256 {
        table[index] = gf_mul(index as u8, factor);
        index += 1;
    }
    table
}

const fn expand_key(key: [u8; BLOCK]) -> RoundKeys {
    let mut keys = [[0; BLOCK]; 11];
    keys[0] = key;
    let (mut round, mut rcon) = (1, 1u8);
    while round < 11 {
        let previous = keys[round - 1];
        let word = [
            SBOX[previous[13] as usize] ^ rcon,
            SBOX[previous[14] as usize],
            SBOX[previous[15] as usize],
            SBOX[previous[12] as usize],
        ];
        let mut next = [0; BLOCK];
        let mut index = 0;
        while index < BLOCK {
            let feed = if index < 4 {
                word[index]
            } else {
                next[index - 4]
            };
            next[index] = previous[index] ^ feed;
            index += 1;
        }
        keys[round] = next;
        rcon = gf_mul(rcon, 2);
        round += 1;
    }
    keys
}

fn add_round_key(block: &mut [u8; BLOCK], key: &[u8; BLOCK]) {
    for (byte, key) in block.iter_mut().zip(key) {
        *byte ^= key;
    }
}

fn inv_shift_sub(block: &mut [u8; BLOCK]) {
    let state = *block;
    for (index, byte) in block.iter_mut().enumerate() {
        let (row, column) = (index % 4, index / 4);
        *byte = INV_SBOX[usize::from(state[row + 4 * ((column + 4 - row) % 4)])];
    }
}

fn inv_mix_columns(block: &mut [u8; BLOCK]) {
    for column in block.as_chunks_mut::<4>().0 {
        let [a, b, c, d] = column.map(usize::from);
        column[0] = MUL_14[a] ^ MUL_11[b] ^ MUL_13[c] ^ MUL_9[d];
        column[1] = MUL_9[a] ^ MUL_14[b] ^ MUL_11[c] ^ MUL_13[d];
        column[2] = MUL_13[a] ^ MUL_9[b] ^ MUL_14[c] ^ MUL_11[d];
        column[3] = MUL_11[a] ^ MUL_13[b] ^ MUL_9[c] ^ MUL_14[d];
    }
}

fn decrypt_block(keys: &RoundKeys, block: &mut [u8; BLOCK]) {
    add_round_key(block, &keys[10]);
    for key in keys[1..10].iter().rev() {
        inv_shift_sub(block);
        add_round_key(block, key);
        inv_mix_columns(block);
    }
    inv_shift_sub(block);
    add_round_key(block, &keys[0]);
}

/// `cipher` starts with the block before the first one to decrypt (the IV for block 0).
fn decrypt_cbc(keys: &RoundKeys, cipher: &[u8]) -> Vec<u8> {
    let (blocks, _) = cipher.as_chunks::<BLOCK>();
    let mut plain = Vec::with_capacity(cipher.len().saturating_sub(BLOCK));
    for pair in blocks.windows(2) {
        let mut block = pair[1];
        decrypt_block(keys, &mut block);
        add_round_key(&mut block, &pair[0]);
        plain.extend_from_slice(&block);
    }
    plain
}

enum Source<'a> {
    Memory(&'a [u8]),
    Disk(File),
}

impl Source<'_> {
    fn open(file: &SaveFile) -> Option<Source<'_>> {
        match &file.content {
            FileContent::Bytes(bytes) => Some(Source::Memory(bytes)),
            FileContent::Path(path) => File::open(path).ok().map(Source::Disk),
        }
    }

    /// Reads up to `len` bytes at `offset`; fewer at the end of the file.
    fn read_at(&mut self, offset: u64, len: usize) -> Option<Vec<u8>> {
        match self {
            Source::Memory(bytes) => {
                let start = usize::try_from(offset).ok()?;
                let end = start.checked_add(len)?.min(bytes.len());
                Some(bytes.get(start..end)?.to_vec())
            }
            Source::Disk(handle) => {
                handle.seek(SeekFrom::Start(offset)).ok()?;
                let mut buffer = Vec::with_capacity(len);
                handle
                    .by_ref()
                    .take(len as u64)
                    .read_to_end(&mut buffer)
                    .ok()?;
                Some(buffer)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::sync::OnceLock;

    use super::*;
    use crate::games::cataloged_label;

    const RAW_PATH: &str = "<winAppData>/DarkSoulsIII/<storeUserId>";
    const MODIFIED_AT: i64 = 1_762_812_000_000;
    const SLOT_DATA_LEN: usize = 0xC0000;
    const SUMMARY_DATA_LEN: usize = 0x3000;
    /// sl2-analyzer measures flag distances from 0x6F before our flag block.
    const ANALYZER_BASE: usize = 0x6F;
    const MUL_2: [u8; 256] = mul_table(2);
    const MUL_3: [u8; 256] = mul_table(3);

    /// sl2-analyzer's `[distance, bit]` of each boss flag.
    const IUDEX: (usize, u8) = (23254, 7);
    const VORDT: (usize, u8) = (4054, 7);
    const CRYSTAL_SAGE: (usize, u8) = (11736, 5);
    const ABYSS_WATCHERS: (usize, u8) = (11734, 7);
    const ALDRICH: (usize, u8) = (19414, 7);
    const FRIEDE: (usize, u8) = (25814, 7);

    fn encrypt_block(keys: &RoundKeys, block: &mut [u8; BLOCK]) {
        add_round_key(block, &keys[0]);
        for (round, key) in keys.iter().enumerate().skip(1) {
            let state = *block;
            for (index, byte) in block.iter_mut().enumerate() {
                let (row, column) = (index % 4, index / 4);
                *byte = SBOX[usize::from(state[row + 4 * ((column + row) % 4)])];
            }
            if round < 10 {
                for column in block.as_chunks_mut::<4>().0 {
                    let [a, b, c, d] = *column;
                    let [wa, wb, wc, wd] = column.map(usize::from);
                    column[0] = MUL_2[wa] ^ MUL_3[wb] ^ c ^ d;
                    column[1] = a ^ MUL_2[wb] ^ MUL_3[wc] ^ d;
                    column[2] = a ^ b ^ MUL_2[wc] ^ MUL_3[wd];
                    column[3] = MUL_3[wa] ^ b ^ c ^ MUL_2[wd];
                }
            }
            add_round_key(block, key);
        }
    }

    fn encrypt_entry(plain: &[u8], key: [u8; BLOCK], seed: u8) -> Vec<u8> {
        let keys = expand_key(key);
        let mut padded = plain.to_vec();
        let pad = BLOCK - padded.len() % BLOCK;
        padded.resize(padded.len() + pad, pad as u8);
        let iv: [u8; BLOCK] = std::array::from_fn(|index| seed.wrapping_mul(31) ^ index as u8);
        let mut out = vec![0xAB; BLOCK];
        out.extend_from_slice(&iv);
        let mut previous = iv;
        for chunk in padded.as_chunks::<BLOCK>().0 {
            let mut block = *chunk;
            add_round_key(&mut block, &previous);
            encrypt_block(&keys, &mut block);
            out.extend_from_slice(&block);
            previous = block;
        }
        out
    }

    fn put(data: &mut [u8], at: usize, value: u32) {
        data[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn put_name(data: &mut [u8], at: usize, name: &str) {
        let units: Vec<u8> = name.encode_utf16().flat_map(u16::to_le_bytes).collect();
        data[at..at + units.len()].copy_from_slice(&units);
    }

    struct TestCharacter {
        name: &'static str,
        attributes: [u32; 9],
        souls: u32,
        class: u8,
        weapons: usize,
        rings: usize,
        covenant: u32,
        list: u32,
        gestures: u32,
        cycle: u16,
        bosses: &'static [(usize, u8)],
        dense_flags: bool,
    }

    impl Default for TestCharacter {
        fn default() -> Self {
            Self {
                name: "Tester",
                attributes: [20, 15, 18, 25, 18, 9, 12, 7, 15],
                souls: 12_345,
                class: 0,
                weapons: 40,
                rings: 0,
                covenant: 0x2000_2760,
                list: 3,
                gestures: 5,
                cycle: 2,
                bosses: &[IUDEX, VORDT, CRYSTAL_SAGE, ABYSS_WATCHERS, ALDRICH, FRIEDE],
                dense_flags: false,
            }
        }
    }

    impl TestCharacter {
        fn level(&self) -> u32 {
            self.attributes.iter().sum::<u32>() - LEVEL_BASE
        }
    }

    fn slot_data(character: &TestCharacter) -> Vec<u8> {
        let mut data = vec![0u8; SLOT_DATA_LEN + 4];
        put(&mut data, 0, SLOT_DATA_LEN as u32);
        put(&mut data, SLOT_HEADER_LEN, 0x6C);
        let mut at = 0x70;
        for index in 0..ITEM_SLOTS {
            if index < character.weapons {
                put(&mut data, at, 0x8080_0000 | index as u32);
                put(&mut data, at + 4, 2_000_000 + index as u32);
                at += EQUIPMENT_ITEM_LEN;
            } else if index < character.weapons + character.rings {
                put(&mut data, at, 0xA000_0000 | index as u32);
                put(&mut data, at + 4, 0x2000_4E20);
                at += EQUIPMENT_ITEM_LEN;
            } else {
                put(&mut data, at + 4, u32::MAX);
                at += ITEM_LEN;
            }
        }

        let stats = at;
        for (offset, value) in ATTRIBUTES.iter().zip(character.attributes) {
            put(&mut data, stats + offset, value);
        }
        put(&mut data, stats + STATS_LEVEL, character.level());
        put(&mut data, stats + STATS_SOULS, character.souls);
        put_name(&mut data, stats + STATS_NAME, character.name);
        data[stats + STATS_CLASS] = character.class;
        data[stats + STATS_GIFT] = 2;
        put(&mut data, stats + EQUIPPED_COVENANT, character.covenant);

        let list = stats + STATS_TO_LIST;
        put(&mut data, list, character.list);
        let gestures = list + 4 + character.list as usize * 8 + LIST_TO_GESTURES;
        put(&mut data, gestures, character.gestures);
        let cycle = gestures + 4 + character.gestures as usize * 4 + GESTURES_TO_CYCLE;
        data[cycle..cycle + 2].copy_from_slice(&character.cycle.to_le_bytes());
        let base = cycle + CYCLE_TO_FLAG_SECTION + SECTION_TO_FLAGS - ANALYZER_BASE;
        if character.dense_flags {
            data[base..base + FLAGS_READ].fill(0x55);
        }
        for &(distance, bit) in character.bosses {
            data[base + distance] |= 1 << bit;
        }
        data
    }

    fn profile(character: &TestCharacter, seconds: u32, area: u16, covenant: u32) -> Vec<u8> {
        let mut profile = vec![0u8; PROFILE_LEN];
        put_name(&mut profile, 0, character.name);
        put(&mut profile, PROFILE_LEVEL, character.level());
        put(&mut profile, PROFILE_SECONDS, seconds);
        profile[PROFILE_AREA..PROFILE_AREA + 2].copy_from_slice(&area.to_le_bytes());
        profile[PROFILE_FACE..PROFILE_FACE + 4].copy_from_slice(FACE);
        put(&mut profile, PROFILE_COVENANT, covenant);
        profile
    }

    struct TestSlot {
        index: usize,
        active: u8,
        profile: Vec<u8>,
        data: Vec<u8>,
    }

    fn summary_data(slots: &[TestSlot]) -> Vec<u8> {
        let mut data = vec![0u8; SUMMARY_DATA_LEN];
        put(&mut data, 0, (SUMMARY_DATA_LEN - 4) as u32);
        for slot in slots {
            data[ACTIVE_FLAGS + slot.index] = slot.active;
            let at = PROFILES + slot.index * PROFILE_LEN;
            data[at..at + PROFILE_LEN].copy_from_slice(&slot.profile);
        }
        data
    }

    /// The summary is stored first so that truncating the file cuts into character slots.
    fn build_save(key: [u8; BLOCK], slots: &[TestSlot]) -> Vec<u8> {
        let header_len = 0x300;
        let order = [SUMMARY_ENTRY, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11];
        let mut body = Vec::new();
        let mut entries = [(0usize, 0usize); 12];
        for index in order {
            let plain = match index {
                SUMMARY_ENTRY => summary_data(slots),
                11 => vec![0; 0x20],
                _ => slots
                    .iter()
                    .find(|slot| slot.index == index)
                    .map_or_else(|| vec![0; 0x10], |slot| slot.data.clone()),
            };
            let entry = encrypt_entry(&plain, key, index as u8);
            entries[index] = (header_len + body.len(), entry.len());
            body.extend_from_slice(&entry);
        }

        let mut header = vec![0u8; header_len];
        header[..4].copy_from_slice(b"BND4");
        put(&mut header, 0x0C, entries.len() as u32);
        header[0x10..0x18].copy_from_slice(&0x40u64.to_le_bytes());
        header[0x18..0x20].copy_from_slice(b"00000001");
        header[0x20..0x28].copy_from_slice(&(ENTRY_LEN as u64).to_le_bytes());
        header[0x28..0x30].copy_from_slice(&(header_len as u64).to_le_bytes());
        header[0x30] = 1;
        for (index, (offset, size)) in entries.iter().enumerate() {
            let at = ENTRY_TABLE + index * ENTRY_LEN;
            put(&mut header, at, 0x50);
            put(&mut header, at + 4, u32::MAX);
            header[at + 8..at + 16].copy_from_slice(&(*size as u64).to_le_bytes());
            put(&mut header, at + 16, *offset as u32);
        }
        header.extend_from_slice(&body);
        header
    }

    fn heavy() -> TestCharacter {
        TestCharacter {
            name: "Heavy",
            attributes: [10; 9],
            class: 9,
            weapons: ITEM_SLOTS,
            covenant: u32::MAX,
            cycle: 0,
            dense_flags: true,
            ..TestCharacter::default()
        }
    }

    fn misread() -> TestCharacter {
        TestCharacter {
            name: "Scanned",
            attributes: [30, 10, 20, 10, 10, 30, 10, 10, 15],
            class: 7,
            weapons: 10,
            rings: 100,
            covenant: 0,
            cycle: 0,
            bosses: &[],
            ..TestCharacter::default()
        }
    }

    fn standard_save() -> &'static [u8] {
        static SAVE: OnceLock<Vec<u8>> = OnceLock::new();
        SAVE.get_or_init(|| {
            let main = TestCharacter::default();
            let ashen = TestCharacter {
                name: "Ashen",
                ..TestCharacter::default()
            };
            build_save(
                KEY,
                &[
                    TestSlot {
                        index: 0,
                        active: 1,
                        profile: profile(&main, 98_765, 4005, u32::MAX),
                        data: slot_data(&main),
                    },
                    TestSlot {
                        index: 1,
                        active: 0,
                        profile: profile(&ashen, 5, 4000, 0),
                        data: vec![0; 0x10],
                    },
                    TestSlot {
                        index: 2,
                        active: 1,
                        profile: profile(&ashen, 3_600, 3305, 0xA000_274C),
                        data: vec![0; 0x40],
                    },
                    TestSlot {
                        index: 4,
                        active: 1,
                        profile: profile(&heavy(), 7, 0, 0x2000_2710),
                        data: slot_data(&heavy()),
                    },
                    TestSlot {
                        index: 6,
                        active: 1,
                        profile: profile(&misread(), 60, 5105, 0),
                        data: slot_data(&misread()),
                    },
                ],
            )
        })
    }

    fn small_save(key: [u8; BLOCK], active: u8) -> Vec<u8> {
        build_save(
            key,
            &[TestSlot {
                index: 0,
                active,
                profile: profile(&TestCharacter::default(), 9, 3100, 0),
                data: vec![0; 0x10],
            }],
        )
    }

    fn save_file(name: &str, bytes: &[u8]) -> SaveFile {
        let mut file = SaveFile::from_bytes(RAW_PATH, name, bytes.to_vec());
        file.modified_at_ms = Some(MODIFIED_AT);
        file
    }

    fn slot<'a>(slots: &'a [SaveSlot], id: &str) -> &'a SaveSlot {
        slots.iter().find(|slot| slot.id == id).unwrap()
    }

    #[test]
    fn aes_matches_published_vectors() {
        let fips_key: [u8; BLOCK] = std::array::from_fn(|index| index as u8);
        let mut block: [u8; BLOCK] = [
            0x69, 0xC4, 0xE0, 0xD8, 0x6A, 0x7B, 0x04, 0x30, 0xD8, 0xCD, 0xB7, 0x80, 0x70, 0xB4,
            0xC5, 0x5A,
        ];
        decrypt_block(&expand_key(fips_key), &mut block);
        let plain: [u8; BLOCK] = std::array::from_fn(|index| index as u8 * 0x11);
        assert_eq!(block, plain);
        encrypt_block(&expand_key(fips_key), &mut block);
        assert_eq!(block[..4], [0x69, 0xC4, 0xE0, 0xD8]);

        let mut cipher: Vec<u8> = (0..16).collect();
        cipher.extend_from_slice(&[
            0x41, 0x56, 0xC7, 0x4C, 0x16, 0x94, 0x7A, 0x01, 0x91, 0x43, 0xA7, 0xBF, 0x37, 0xD6,
            0x14, 0xB4, 0x66, 0xCA, 0x91, 0xE4, 0x2C, 0x68, 0xB1, 0xF0, 0xCF, 0xE8, 0xF4, 0x32,
            0x1C, 0x90, 0xD0, 0x27,
        ]);
        let plain = decrypt_cbc(&ROUND_KEYS, &cipher);
        assert_eq!(&plain[..16], b"DS3 test vec.\0\0\0");
        assert_eq!(plain[16..], [0x10; 16]);
    }

    #[test]
    fn reads_active_characters() {
        let files = vec![
            save_file("DS30000.sl2", standard_save()),
            SaveFile::from_bytes(
                "<winPublic>/Documents/Steam/RUNE/374320",
                "achievements.ini",
                b"[x]".to_vec(),
            ),
        ];
        let slots = read_slots(&files);
        let ids: Vec<&str> = slots.iter().map(|slot| slot.id.as_str()).collect();
        assert_eq!(ids, ["slot-1", "slot-3", "slot-5", "slot-7"]);

        let slot = &slots[0];
        assert_eq!(slot.kind, SlotKind::Manual);
        assert_eq!(slot.title.as_deref(), Some("Tester"));
        assert_eq!(slot.saved_at_ms, Some(MODIFIED_AT));
        assert_eq!(slot.files, ["DS30000.sl2"]);
        assert_eq!(slot.stat(StatKind::Level), Some(&StatValue::Integer(50)));
        assert_eq!(
            slot.stat(StatKind::Playtime),
            Some(&StatValue::Seconds(98_765))
        );
        assert_eq!(
            slot.stat(StatKind::Money),
            Some(&StatValue::Integer(12_345))
        );
        assert_eq!(
            slot.stat(StatKind::CharacterName),
            Some(&StatValue::Text("Tester".to_owned()))
        );
        assert_eq!(
            slot.stat(StatKind::CharacterClass),
            Some(&cataloged_label("dark_souls_3.class.knight", "Knight"))
        );
        assert_eq!(
            slot.stat(StatKind::Location),
            Some(&cataloged_label(
                "dark_souls_3.location.cemetery_of_ash_firelink_shrine",
                "Cemetery of Ash / Firelink Shrine"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Quest),
            Some(&cataloged_label(
                "dark_souls_3.quest.defeated_aldrich_devourer_of_gods",
                "Defeated Aldrich, Devourer of Gods"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::QuestsCompleted),
            Some(&StatValue::Progress {
                current: 2,
                total: 4
            })
        );
        assert_eq!(
            slot.stat(StatKind::NewGamePlus),
            Some(&StatValue::Integer(2))
        );
        assert_eq!(
            slot.stat(StatKind::Reputation),
            Some(&cataloged_label(
                "dark_souls_3.covenant.rosaria_s_fingers",
                "Rosaria's Fingers"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Content),
            Some(&cataloged_label(
                "dark_souls_3.content.ashes_of_ariandel",
                "Ashes of Ariandel"
            ))
        );
        assert_eq!(slot.playthrough.as_ref().map(String::len), Some(8));
    }

    #[test]
    fn empty_slot_data_falls_back_to_the_load_screen_summary() {
        let slots = read_slots(&[save_file("DS30000.sl2", standard_save())]);
        let slot = slot(&slots, "slot-3");
        assert_eq!(slot.title.as_deref(), Some("Ashen"));
        assert_eq!(slot.stat(StatKind::Level), Some(&StatValue::Integer(50)));
        assert_eq!(
            slot.stat(StatKind::Playtime),
            Some(&StatValue::Seconds(3_600))
        );
        assert_eq!(
            slot.stat(StatKind::Location),
            Some(&cataloged_label(
                "dark_souls_3.location.road_of_sacrifices_farron_keep",
                "Road of Sacrifices / Farron Keep"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Reputation),
            Some(&cataloged_label(
                "dark_souls_3.covenant.way_of_blue",
                "Way of Blue"
            ))
        );
        assert_eq!(slot.stat(StatKind::Money), None);
        assert_eq!(slot.stat(StatKind::CharacterClass), None);
        assert_eq!(slot.stat(StatKind::QuestsCompleted), None);
        assert_eq!(slot.playthrough, None);
    }

    #[test]
    fn dense_flags_drop_progress_but_keep_the_stat_block() {
        let slots = read_slots(&[save_file("DS30000.sl2", standard_save())]);
        let slot = slot(&slots, "slot-5");
        assert_eq!(slot.stat(StatKind::Level), Some(&StatValue::Integer(1)));
        assert_eq!(
            slot.stat(StatKind::Money),
            Some(&StatValue::Integer(12_345))
        );
        assert_eq!(
            slot.stat(StatKind::CharacterClass),
            Some(&cataloged_label("dark_souls_3.class.deprived", "Deprived"))
        );
        assert_eq!(
            slot.stat(StatKind::Reputation),
            Some(&cataloged_label(
                "dark_souls_3.covenant.blade_of_the_darkmoon",
                "Blade of the Darkmoon"
            ))
        );
        assert_eq!(slot.stat(StatKind::Quest), None);
        assert_eq!(slot.stat(StatKind::QuestsCompleted), None);
        assert_eq!(slot.stat(StatKind::NewGamePlus), None);
        assert_eq!(slot.stat(StatKind::Location), None);
        assert_eq!(slot.stat(StatKind::Content), None);
    }

    #[test]
    fn scans_for_the_stat_block_when_the_item_walk_misreads() {
        let save = standard_save();
        let entries = read_entries(&save[..HEADER_LEN]).unwrap();
        let mut source = Source::Memory(save);
        let mut plain = Plaintext::open(&mut source, entries[6]).unwrap();
        let walked = walk_items(&mut plain, 0x70).unwrap();
        assert!(read_stats(&mut plain, walked).is_none());

        let slots = read_slots(&[save_file("DS30000.sl2", save)]);
        let slot = slot(&slots, "slot-7");
        assert_eq!(slot.stat(StatKind::Level), Some(&StatValue::Integer(56)));
        assert_eq!(
            slot.stat(StatKind::CharacterClass),
            Some(&cataloged_label(
                "dark_souls_3.class.pyromancer",
                "Pyromancer"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::QuestsCompleted),
            Some(&StatValue::Progress {
                current: 0,
                total: 4
            })
        );
        assert_eq!(slot.stat(StatKind::Quest), None);
        assert_eq!(slot.stat(StatKind::NewGamePlus), None);
        assert_eq!(slot.stat(StatKind::Reputation), None);
        assert_eq!(
            slot.stat(StatKind::Location),
            Some(&cataloged_label(
                "dark_souls_3.location.the_ringed_city",
                "The Ringed City"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Content),
            Some(&cataloged_label(
                "dark_souls_3.content.the_ringed_city",
                "The Ringed City"
            ))
        );
        assert_ne!(slot.playthrough, slots[0].playthrough);
    }

    #[test]
    fn reads_from_disk_with_seeks() {
        let bytes = standard_save();
        let mut temp = tempfile::NamedTempFile::new().unwrap();
        temp.write_all(bytes).unwrap();
        let on_disk = SaveFile {
            raw_path: RAW_PATH.to_owned(),
            relative_path: "DS30000.sl2".to_owned(),
            size: bytes.len() as u64,
            modified_at_ms: Some(MODIFIED_AT),
            content: FileContent::Path(temp.path().to_path_buf()),
        };
        assert_eq!(
            read_slots(&[on_disk]),
            read_slots(&[save_file("DS30000.sl2", bytes)])
        );
    }

    #[test]
    fn names_slots_by_file() {
        let save = small_save(KEY, 1);
        let ids = |name: &str| -> Vec<String> {
            read_slots(&[save_file(name, &save)])
                .into_iter()
                .map(|slot| slot.id)
                .collect()
        };
        assert_eq!(ids("DS30000.sl2"), ["slot-1"]);
        assert_eq!(ids("ds30000.SL2"), ["slot-1"]);
        assert_eq!(ids("DS30000.co2"), ["co2-slot-1"]);
        assert_eq!(ids("DS30012.sl2"), ["ds30012-slot-1"]);
        assert!(ids("DS30000.sl2.bak").is_empty());
        assert!(ids("DS3000.sl2").is_empty());
        assert!(ids("ER0000.sl2").is_empty());
        assert!(ids("DS2SOFS0000.sl2").is_empty());
    }

    #[test]
    fn newest_copy_of_a_slot_wins() {
        let mut older = save_file("DS30000.sl2", &small_save(KEY, 1));
        older.modified_at_ms = Some(1);
        older.raw_path = "<winAppData>/DarkSoulsIII/other".to_owned();
        let slots = read_slots(&[older, save_file("DS30000.sl2", &small_save(KEY, 1))]);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].saved_at_ms, Some(MODIFIED_AT));
    }

    #[test]
    fn wrong_key_garbage_and_bad_summaries_give_nothing() {
        let mut other_key = KEY;
        other_key[0] ^= 1;
        let mut corrupted_summary = small_save(KEY, 1);
        corrupted_summary[0x300 + 0x20] ^= 0x40;
        for bytes in [
            Vec::new(),
            b"BND4".to_vec(),
            vec![0x5A; 0x4000],
            standard_save()[..0x300].to_vec(),
            standard_save()[..0x300 + 0x1000].to_vec(),
            small_save(other_key, 1),
            small_save(KEY, 7),
            small_save(KEY, 0),
            corrupted_summary,
        ] {
            assert!(read_slots(&[save_file("DS30000.sl2", &bytes)]).is_empty());
        }
        assert_eq!(
            read_slots(&[save_file("DS30000.sl2", &small_save(KEY, 1))]).len(),
            1
        );
    }

    #[test]
    fn truncated_or_resized_slots_give_fewer_stats() {
        let save = standard_save();
        for cut in (0x300..save.len()).step_by(save.len() / 23) {
            let slots = read_slots(&[save_file("DS30000.sl2", &save[..cut])]);
            assert!(slots.len() <= 4);
        }

        let size_at = ENTRY_TABLE + 8;
        for size in [0x20 + 0x10000u64, u64::MAX, 0x21] {
            let mut resized = save.to_vec();
            resized[size_at..size_at + 8].copy_from_slice(&size.to_le_bytes());
            let slots = read_slots(&[save_file("DS30000.sl2", &resized)]);
            let slot = slot(&slots, "slot-1");
            assert_eq!(slot.stat(StatKind::Money), None);
            assert_eq!(
                slot.stat(StatKind::Playtime),
                Some(&StatValue::Seconds(98_765))
            );
            assert_eq!(slots.len(), 4);
        }
    }

    #[test]
    fn event_flags_match_the_published_boss_table() {
        let table: [(u32, usize, u8); 19] = [
            (14000800, 23254, 7),
            (13000800, 4054, 7),
            (13300850, 11736, 5),
            (13500800, 15574, 7),
            (13300800, 11734, 7),
            (13800800, 20694, 7),
            (13700850, 19416, 5),
            (13700800, 19414, 7),
            (13900800, 21974, 7),
            (13000890, 4059, 5),
            (13010800, 5334, 7),
            (13410830, 14291, 1),
            (14100800, 24534, 7),
            (14500800, 25814, 7),
            (14500860, 25815, 3),
            (15000800, 29654, 7),
            (15100800, 30934, 7),
            (15100850, 30936, 5),
            (15110800, 32214, 7),
        ];
        for &(flag, distance, bit) in &table {
            let mut flags = vec![0u8; FLAGS_READ];
            flags[distance - ANALYZER_BASE] = 1 << bit;
            for &(other, _, _) in &table {
                assert_eq!(event_flag(&flags, other), Some(other == flag), "{other}");
            }
        }
        let used = MAIN_STORY
            .iter()
            .map(|&(flag, _)| flag)
            .chain(DLCS.iter().flat_map(|dlc| dlc.bosses.iter().copied()));
        for flag in used {
            assert!(table.iter().any(|&(known, _, _)| known == flag), "{flag}");
        }
        assert_eq!(event_flag(&[0; 8], 14000800), None);
        assert_eq!(event_flag(&[0xFF; FLAGS_READ], 9_000_000), None);
        assert_eq!(event_flag(&[0xFF; FLAGS_READ], 16000800), None);
    }

    #[test]
    fn display_text() {
        assert_eq!(
            map_code(4005).and_then(|code| lookup(&MAPS, code)),
            Some("Cemetery of Ash / Firelink Shrine")
        );
        assert_eq!(
            map_code(3410).and_then(|code| lookup(&MAPS, code)),
            Some("Grand Archives")
        );
        assert_eq!(
            map_code(5115).and_then(|code| lookup(&MAPS, code)),
            Some("Filianore's Rest")
        );
        assert_eq!(map_code(0), None);
        assert_eq!(map_code(1234).and_then(|code| lookup(&MAPS, code)), None);
        assert_eq!(covenant_name(10060), Some("Way of Blue"));
        assert_eq!(covenant_name(0x2000_276A), Some("Spears of the Church"));
        assert_eq!(covenant_name(0xA000_2724), Some("Watchdogs of Farron"));
        assert_eq!(covenant_name(u32::MAX), None);
        assert_eq!(covenant_name(10010), None);
        assert_eq!(
            utf16_name(&[0x41, 0, 0x42, 0, 0, 0, 0x43, 0]).as_deref(),
            Some("AB")
        );
        assert_eq!(utf16_name(&[0, 0, 0x41, 0]), None);
        assert_eq!(CLASSES[3], "Herald");
    }
}
