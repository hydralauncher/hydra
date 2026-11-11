//! Elden Ring: `ER0000.sl2` (Seamless Co-op: `ER0000.co2`) is a BND4 archive with ten character
//! slots, USER_DATA010 (the load screen summary of each slot) and USER_DATA011 (regulation). Every
//! entry is an MD5 followed by plain little-endian data. Only the header, the summary and the stat
//! blocks of active slots are read, never the whole 29 MB file.

mod maps;

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use crate::games::{label, lookup, newest_modified_at, Parser};
use crate::model::{SaveSlot, SlotKind, Stat, StatKind, StatValue};
use crate::source::{FileContent, SaveFile};
use crate::util::{crc32, u32_le, u64_le};

pub const PARSER: Parser = Parser {
    id: "elden-ring",
    version: 1,
    steam_app_ids: &["1245620"],
    read_slots,
    labels,
    read_profile: crate::games::no_profile,
    stat_names: &[
        (StatKind::Money, "Runes held"),
        (StatKind::Collectibles, "Great Runes"),
    ],
};

const LABEL_PREFIX: &str = "elden_ring";

const HEADER_LEN: usize = 0x300;
const ENTRY_TABLE: usize = 0x40;
const ENTRY_LEN: usize = 0x20;
const ENTRY_COUNT: usize = 12;
const SLOT_COUNT: usize = 10;
const SUMMARY_ENTRY: usize = 10;
const CHECKSUM_LEN: u64 = 0x10;

const ACTIVE_FLAGS: usize = 0x1964;
const PROFILES: usize = ACTIVE_FLAGS + SLOT_COUNT;
const PROFILE_LEN: usize = 0x24C;
const SUMMARY_LEN: usize = PROFILES + SLOT_COUNT * PROFILE_LEN;
const PROFILE_NAME: usize = 0x00;
const PROFILE_LEVEL: usize = 0x22;
const PROFILE_SECONDS: usize = 0x26;
const PROFILE_MAP: usize = 0x2E;
const PROFILE_BODY_TYPE: usize = 0x242;
const PROFILE_ARCHETYPE: usize = 0x243;
const PROFILE_GIFT: usize = 0x244;

const SLOT_WINDOW: u64 = 0x50000;
const MAX_SLOT_READ: u64 = 0x400000;
const GAITEMS_OLD: usize = 5118;
const GAITEMS: usize = 5120;
const LAST_OLD_GAITEM_VERSION: u32 = 81;

const PGD_LEN: usize = 0x1B0;
const PGD_LEVEL: usize = 0x60;
const PGD_RUNES: usize = 0x64;
const PGD_NAME: usize = 0x94;
const NAME_LEN: usize = 0x20;
const PGD_BODY_TYPE: usize = 0xB6;
const PGD_ARCHETYPE: usize = 0xB7;
const PGD_GIFT: usize = 0xBB;

const BEFORE_PROJECTILES: usize = 0xD0 + 0x58 + 0x1C + 0x58 + 0x58 + 0x9010 + 0x74 + 0x8C + 0x18;
const BEFORE_FACE: usize = 0x9C + 0xC;
const FACE_LEN: usize = 0x12F;
const BEFORE_REGIONS: usize = 0x6010 + 0x100;
const BEFORE_CYCLE: usize = 0x28 + 1 + 0x44;
const BEFORE_TUTORIALS: usize = 0x34 + 0x1B588;
const TUTORIAL_TAG: u32 = 174;
const BEFORE_DEATHS: usize = 3;
const BEFORE_FLAGS: usize = 4 + 1 + 4 + 4 + 1 + 4 + 4;
const EVENT_FLAGS_LEN: u64 = 0x1BF99F + 1;
const FLAGS_READ: usize = 0x600;
const MAX_LIST: u32 = 0x10000;
const MAX_BLOCK: u32 = 0x10000;

const WORLD_BLOCK_CAPS: [u32; 5] = [0x10000, 0x10000, 0x100000, 0x100000, 0x100000];
const BEFORE_NET_MAN: u64 = 0x3D + 2 + 4 + 4;
const NET_MAN_TAG: u32 = 2;
const BEFORE_ACTIVITIES: u64 = 0x20004 + 0xC + 0xC + 0x10 + 8;
const ACTIVITY_COUNT: usize = 7;
const ACTIVITY_DONE: u8 = 2;

const GREAT_RUNE_COUNT_FLAG: u32 = 180;
const GREAT_RUNES: u32 = 7;
const REALM_OF_SHADOW_FLAG: u32 = 62002;
/// Byte position of each event flag block (flags / 1000), from the game's eventflag_bst.txt.
const FLAG_BLOCKS: &[(u32, usize)] = &[(0, 0), (62, 12)];
const FLAG_BLOCK_LEN: usize = 125;

/// One quest per main boss activity card, in card order.
const MAIN_STORY: [&str; 6] = [
    "Defeated Godrick the Grafted",
    "Defeated Starscourge Radahn",
    "Defeated Morgott, the Omen King",
    "Defeated Fire Giant",
    "Defeated Maliketh, the Black Blade",
    "Defeated Godfrey, First Elden Lord",
];

const CLASSES: [&str; 10] = [
    "Vagabond",
    "Warrior",
    "Hero",
    "Bandit",
    "Astrologer",
    "Prophet",
    "Confessor",
    "Samurai",
    "Prisoner",
    "Wretch",
];

/// Shown for an open world tile missing from `maps::TILES`.
const OPEN_WORLDS: [(u8, &str); 2] = [(60, "The Lands Between"), (61, "Realm of Shadow")];

const SHADOW_OF_THE_ERDTREE: &str = "Shadow of the Erdtree";

fn labels() -> Vec<(&'static str, &'static str)> {
    let classes = CLASSES.iter().map(|&class| ("class", class));
    let regions = maps::REGIONS.iter().map(|&region| ("location", region));
    let dungeons = maps::DUNGEONS
        .iter()
        .map(|&(_, _, dungeon)| ("location", dungeon));
    let worlds = OPEN_WORLDS.iter().map(|&(_, world)| ("location", world));
    let quests = MAIN_STORY.iter().map(|&quest| ("quest", quest));
    classes
        .chain(regions)
        .chain(dungeons)
        .chain(worlds)
        .chain(quests)
        .chain([("content", SHADOW_OF_THE_ERDTREE)])
        .collect()
}

fn read_slots(files: &[SaveFile]) -> Vec<SaveSlot> {
    files
        .iter()
        .filter_map(|file| Some((file, save_variant(file.file_name())?)))
        .flat_map(|(file, variant)| read_file(file, &variant))
        .collect()
}

struct Variant {
    id_prefix: String,
    convergence: bool,
}

fn save_variant(file_name: &str) -> Option<Variant> {
    let suffix = file_name.strip_prefix("ER0000.")?;
    let id_prefix = match suffix {
        "sl2" => String::new(),
        "co2" | "cnv" | "cnv.co2" => format!("{}-", suffix.replace('.', "-")),
        _ => return None,
    };
    Some(Variant {
        id_prefix,
        convergence: suffix.contains("cnv"),
    })
}

#[derive(Clone, Copy)]
struct Entry {
    offset: u64,
    size: u64,
}

fn read_file(file: &SaveFile, variant: &Variant) -> Vec<SaveSlot> {
    let Some(mut source) = Source::open(file) else {
        return Vec::new();
    };
    let Some(entries) = source
        .read_at(0, HEADER_LEN)
        .and_then(|header| read_entries(&header))
    else {
        return Vec::new();
    };
    let Some(summary) = source
        .read_at(entries[SUMMARY_ENTRY].offset, SUMMARY_LEN)
        .filter(|summary| summary.len() == SUMMARY_LEN)
    else {
        return Vec::new();
    };
    let active = &summary[ACTIVE_FLAGS..PROFILES];
    if active.iter().any(|&flag| flag > 1) {
        return Vec::new();
    }

    let saved_at_ms = newest_modified_at(&[file]);
    (0..SLOT_COUNT)
        .filter(|&index| active[index] == 1)
        .filter_map(|index| {
            let profile = summary
                .get(PROFILES + index * PROFILE_LEN..PROFILES + (index + 1) * PROFILE_LEN)?;
            let character = read_character(&mut source, entries[index], profile)?;
            Some(to_slot(file, variant, index, saved_at_ms, &character))
        })
        .collect()
}

fn read_entries(header: &[u8]) -> Option<Vec<Entry>> {
    if header.get(..4)? != b"BND4"
        || u32_le(header, 0x0C)? as usize != ENTRY_COUNT
        || u64_le(header, 0x20)? != ENTRY_LEN as u64
    {
        return None;
    }
    (0..ENTRY_COUNT)
        .map(|index| {
            let at = ENTRY_TABLE + index * ENTRY_LEN;
            Some(Entry {
                size: u64_le(header, at + 0x08)?,
                offset: u64::from(u32_le(header, at + 0x10)?),
            })
        })
        .collect()
}

#[derive(Default)]
struct Character {
    name: Option<String>,
    name_units: Vec<u8>,
    archetype: u8,
    gift: u8,
    body_type: u8,
    level: Option<u32>,
    seconds: Option<u64>,
    runes: Option<u32>,
    map: Option<[u8; 4]>,
    version: Option<u32>,
    progress: Option<Progress>,
    activities: Option<Vec<u8>>,
}

struct Progress {
    cycle: u32,
    deaths: u32,
    great_runes: Option<u32>,
    realm_of_shadow: bool,
    flags_end: usize,
}

fn read_character(source: &mut Source, entry: Entry, profile: &[u8]) -> Option<Character> {
    let data_offset = entry.offset.checked_add(CHECKSUM_LEN)?;
    let data_len = entry.size.checked_sub(CHECKSUM_LEN)?;
    if source.read_u32(data_offset) == Some(0) {
        return None;
    }
    let window = source.read_at(data_offset, read_len(data_len.min(SLOT_WINDOW))?)?;

    let mut character = parse_slot(&window);
    let complete = character
        .as_ref()
        .is_some_and(|character| character.progress.is_some());
    if !complete && (window.len() as u64) < data_len {
        if let Some(full) = source.read_at(data_offset, read_len(data_len.min(MAX_SLOT_READ))?) {
            character = parse_slot(&full).or(character);
        }
    }

    let Some(mut character) = character else {
        return profile_character(profile);
    };
    if let (Some(progress), Some(version)) = (&character.progress, character.version) {
        character.activities =
            read_activities(source, data_offset, data_len, progress.flags_end, version);
    }
    Some(character)
}

fn read_len(len: u64) -> Option<usize> {
    usize::try_from(len).ok()
}

fn parse_slot(data: &[u8]) -> Option<Character> {
    let mut cursor = Cursor::new(data);
    let version = cursor.u32()?;
    if version == 0 {
        return None;
    }
    let map: [u8; 4] = cursor.take(4)?.try_into().ok()?;
    let play_time_ms = u64_le(data, 0x08)?;
    cursor.skip(0x18)?;

    let gaitems = if version <= LAST_OLD_GAITEM_VERSION {
        GAITEMS_OLD
    } else {
        GAITEMS
    };
    for _ in 0..gaitems {
        let handle = cursor.u32()?;
        cursor.skip(4)?;
        match handle >> 28 {
            0x8 => cursor.skip(13)?,
            0x9 => cursor.skip(8)?,
            _ => {}
        }
    }

    let player = cursor.take(PGD_LEN)?;
    cursor.skip(BEFORE_PROJECTILES)?;
    cursor.list(8)?;
    cursor.skip(BEFORE_FACE)?;
    if cursor.take(FACE_LEN)?.get(4..8)? != b"FACE" {
        return None;
    }

    let name_bytes = player.get(PGD_NAME..PGD_NAME + NAME_LEN)?;
    Some(Character {
        name: utf16_name(name_bytes),
        name_units: name_units(name_bytes),
        archetype: *player.get(PGD_ARCHETYPE)?,
        gift: *player.get(PGD_GIFT)?,
        body_type: *player.get(PGD_BODY_TYPE)?,
        level: u32_le(player, PGD_LEVEL).filter(|level| (1..=999).contains(level)),
        seconds: Some(play_time_ms / 1000),
        runes: u32_le(player, PGD_RUNES),
        map: Some(map),
        version: Some(version),
        progress: read_progress(&mut cursor),
        activities: None,
    })
}

fn read_progress(cursor: &mut Cursor) -> Option<Progress> {
    cursor.skip(BEFORE_REGIONS)?;
    cursor.list(4)?;
    cursor.skip(BEFORE_CYCLE)?;
    let cycle = cursor.u32()?;
    cursor.skip(4)?;
    cursor.block()?;
    cursor.skip(BEFORE_TUTORIALS)?;
    if cursor.peek_u32()? & 0xFFFF != TUTORIAL_TAG {
        return None;
    }
    cursor.block()?;
    cursor.skip(BEFORE_DEATHS)?;
    let deaths = cursor.u32()?;
    cursor.skip(BEFORE_FLAGS)?;
    let flags_start = cursor.at;
    let flags = cursor.take(FLAGS_READ)?;
    Some(Progress {
        cycle,
        deaths,
        great_runes: great_rune_count(flags),
        realm_of_shadow: event_flag(flags, REALM_OF_SHADOW_FLAG) == Some(true),
        flags_end: flags_start.checked_add(read_len(EVENT_FLAGS_LEN)?)?,
    })
}

/// The PlayStation activity cards (story, then six main bosses), written on every platform.
fn read_activities(
    source: &mut Source,
    data_offset: u64,
    data_len: u64,
    flags_end: usize,
    version: u32,
) -> Option<Vec<u8>> {
    let mut at = u64::try_from(flags_end).ok()?;
    for cap in WORLD_BLOCK_CAPS {
        let size = source.read_u32(data_offset.checked_add(at)?)?;
        if size > cap {
            return None;
        }
        at = at.checked_add(4 + u64::from(size))?;
    }
    at += BEFORE_NET_MAN + u64::from(version >= 65) * 4 + u64::from(version >= 66);
    if source.read_u32(data_offset.checked_add(at)?)? != NET_MAN_TAG {
        return None;
    }
    at += BEFORE_ACTIVITIES;
    if at + ACTIVITY_COUNT as u64 > data_len {
        return None;
    }
    let activities = source.read_at(data_offset.checked_add(at)?, ACTIVITY_COUNT)?;
    (activities.len() == ACTIVITY_COUNT && activities.iter().all(|&state| state <= ACTIVITY_DONE))
        .then_some(activities)
}

fn profile_character(profile: &[u8]) -> Option<Character> {
    let name_bytes = profile.get(PROFILE_NAME..PROFILE_NAME + NAME_LEN)?;
    let level = u32_le(profile, PROFILE_LEVEL).filter(|level| (1..=999).contains(level))?;
    Some(Character {
        name: utf16_name(name_bytes),
        name_units: name_units(name_bytes),
        archetype: *profile.get(PROFILE_ARCHETYPE)?,
        gift: *profile.get(PROFILE_GIFT)?,
        body_type: *profile.get(PROFILE_BODY_TYPE)?,
        level: Some(level),
        seconds: u32_le(profile, PROFILE_SECONDS).map(u64::from),
        map: profile.get(PROFILE_MAP..PROFILE_MAP + 4)?.try_into().ok(),
        ..Character::default()
    })
}

fn to_slot(
    file: &SaveFile,
    variant: &Variant,
    index: usize,
    saved_at_ms: Option<i64>,
    character: &Character,
) -> SaveSlot {
    let mut stats = Vec::new();
    if let Some(level) = character.level {
        stats.push(Stat::new(
            StatKind::Level,
            StatValue::Integer(i64::from(level)),
        ));
    }
    if let Some(seconds) = character.seconds {
        stats.push(Stat::new(StatKind::Playtime, StatValue::Seconds(seconds)));
    }
    if let Some(runes) = character.runes {
        stats.push(Stat::new(
            StatKind::Money,
            StatValue::Integer(i64::from(runes)),
        ));
    }
    if let Some(name) = &character.name {
        stats.push(Stat::new(
            StatKind::CharacterName,
            StatValue::Text(name.clone()),
        ));
    }
    if let Some(class) = class_name(character.archetype).filter(|_| !variant.convergence) {
        stats.push(Stat::new(
            StatKind::CharacterClass,
            label(LABEL_PREFIX, "class", class),
        ));
    }
    if let Some(location) = character.map.and_then(location) {
        stats.push(Stat::new(
            StatKind::Location,
            label(LABEL_PREFIX, "location", location),
        ));
    }
    if let Some(quest) = character.activities.as_deref().and_then(main_story) {
        stats.push(Stat::new(
            StatKind::Quest,
            label(LABEL_PREFIX, "quest", quest),
        ));
    }
    if let Some(progress) = &character.progress {
        if let Some(current) = progress.great_runes {
            stats.push(Stat::new(
                StatKind::Collectibles,
                StatValue::Progress {
                    current,
                    total: GREAT_RUNES,
                },
            ));
        }
        stats.push(Stat::new(
            StatKind::Deaths,
            StatValue::Integer(i64::from(progress.deaths)),
        ));
        if progress.cycle > 0 {
            stats.push(Stat::new(
                StatKind::NewGamePlus,
                StatValue::Integer(i64::from(progress.cycle)),
            ));
        }
        if progress.realm_of_shadow {
            stats.push(Stat::new(
                StatKind::Content,
                label(LABEL_PREFIX, "content", SHADOW_OF_THE_ERDTREE),
            ));
        }
    }

    SaveSlot {
        id: format!("{}character-{index}", variant.id_prefix),
        kind: SlotKind::Manual,
        title: character.name.clone(),
        saved_at_ms,
        playthrough: playthrough(index, character),
        stats,
        thumbnail: None,
        files: vec![file.relative_path.clone()],
    }
}

fn playthrough(index: usize, character: &Character) -> Option<String> {
    character.name.as_ref()?;
    let mut identity = character.name_units.clone();
    identity.extend([
        index as u8,
        character.archetype,
        character.gift,
        character.body_type,
    ]);
    Some(format!("{:08x}", crc32(&identity)))
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

fn class_name(archetype: u8) -> Option<&'static str> {
    CLASSES.get(usize::from(archetype)).copied()
}

/// `map` is stored as `[DD, CC, BB, AA]` for map `mAA_BB_CC_DD`.
fn location(map: [u8; 4]) -> Option<&'static str> {
    let [tile, y, x, area] = map;
    match lookup(&OPEN_WORLDS, area) {
        Some(world) => {
            let found = maps::TILES
                .binary_search_by(|&(a, tx, ty, _)| (a, tx, ty).cmp(&(area, x, y)))
                .ok()
                .filter(|_| tile == 0)
                .and_then(|index| {
                    maps::REGIONS
                        .get(usize::from(maps::TILES[index].3))
                        .copied()
                });
            Some(found.unwrap_or(world))
        }
        None => maps::DUNGEONS
            .binary_search_by(|&(a, block, _)| (a, block).cmp(&(area, x)))
            .ok()
            .map(|index| maps::DUNGEONS[index].2),
    }
}

fn main_story(activities: &[u8]) -> Option<&'static str> {
    MAIN_STORY
        .iter()
        .enumerate()
        .rev()
        .find(|&(index, _)| activities.get(index + 1) == Some(&ACTIVITY_DONE))
        .map(|(_, &quest)| quest)
}

/// One flag per great rune count (180 = none, 187 = all seven); every count reached stays set.
fn great_rune_count(flags: &[u8]) -> Option<u32> {
    (0..=GREAT_RUNES)
        .rev()
        .find(|&count| event_flag(flags, GREAT_RUNE_COUNT_FLAG + count) == Some(true))
}

fn event_flag(flags: &[u8], id: u32) -> Option<bool> {
    let block = id / 1000;
    let (_, position) = FLAG_BLOCKS.iter().find(|&&(known, _)| known == block)?;
    let index = (id % 1000) as usize;
    let byte = *flags.get(position * FLAG_BLOCK_LEN + index / 8)?;
    Some((byte >> (7 - index % 8)) & 1 == 1)
}

struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }

    fn skip(&mut self, len: usize) -> Option<()> {
        self.take(len).map(|_| ())
    }

    fn take(&mut self, len: usize) -> Option<&'a [u8]> {
        let end = self.at.checked_add(len)?;
        let bytes = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(bytes)
    }

    fn u32(&mut self) -> Option<u32> {
        let value = self.peek_u32()?;
        self.at += 4;
        Some(value)
    }

    fn peek_u32(&self) -> Option<u32> {
        u32_le(self.bytes, self.at)
    }

    fn list(&mut self, item_len: usize) -> Option<()> {
        let count = self.u32()?;
        if count > MAX_LIST {
            return None;
        }
        self.skip((count as usize).checked_mul(item_len)?)
    }

    fn block(&mut self) -> Option<()> {
        self.skip(4)?;
        let size = self.u32()?;
        if size > MAX_BLOCK {
            return None;
        }
        self.skip(size as usize)
    }
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

    fn read_u32(&mut self, offset: u64) -> Option<u32> {
        u32_le(&self.read_at(offset, 4)?, 0)
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;
    use crate::games::cataloged_label;
    use crate::util::find;

    const RAW_PATH: &str = "<winAppData>/EldenRing/<storeUserId>";
    const STORMVEIL: [u8; 4] = [0, 0, 0, 10];
    const CHURCH_OF_ELLEH: [u8; 4] = [0, 36, 42, 60];

    struct TestCharacter {
        name: &'static str,
        version: u32,
        map: [u8; 4],
        play_ms: u64,
        level: u32,
        runes: u32,
        archetype: u8,
        weapons: usize,
        projectiles: usize,
        cycle: u32,
        deaths: u32,
        great_runes: u32,
        realm_of_shadow: bool,
        activities: [u8; 7],
    }

    impl Default for TestCharacter {
        fn default() -> Self {
            Self {
                name: "Tester",
                version: 262,
                map: STORMVEIL,
                play_ms: 45_296_789,
                level: 56,
                runes: 2873,
                archetype: 7,
                weapons: 3,
                projectiles: 4,
                cycle: 1,
                deaths: 124,
                great_runes: 2,
                realm_of_shadow: true,
                activities: [1, 2, 2, 1, 0, 0, 0],
            }
        }
    }

    fn utf16(name: &str) -> Vec<u8> {
        name.encode_utf16().flat_map(u16::to_le_bytes).collect()
    }

    fn pad(data: &mut Vec<u8>, len: usize) {
        data.resize(data.len() + len, 0);
    }

    fn put_u32(data: &mut Vec<u8>, value: u32) {
        data.extend_from_slice(&value.to_le_bytes());
    }

    fn set_flag(flags: &mut [u8], byte: usize, bit: u8) {
        flags[byte] |= 1 << bit;
    }

    fn slot_data(character: &TestCharacter) -> Vec<u8> {
        let mut data = Vec::new();
        put_u32(&mut data, character.version);
        data.extend_from_slice(&character.map);
        data.extend_from_slice(&character.play_ms.to_le_bytes());
        pad(&mut data, 0x10);
        for index in 0..GAITEMS {
            if index < character.weapons {
                put_u32(&mut data, 0x8080_0000 | index as u32);
                put_u32(&mut data, 1_000_000);
                pad(&mut data, 13);
            } else if index == character.weapons {
                put_u32(&mut data, 0x9080_0000 | index as u32);
                put_u32(&mut data, 0x1000_0000 | 40_000);
                pad(&mut data, 8);
            } else {
                pad(&mut data, 8);
            }
        }

        let mut player = vec![0u8; PGD_LEN];
        player[PGD_LEVEL..PGD_LEVEL + 4].copy_from_slice(&character.level.to_le_bytes());
        player[PGD_RUNES..PGD_RUNES + 4].copy_from_slice(&character.runes.to_le_bytes());
        let name = utf16(character.name);
        player[PGD_NAME..PGD_NAME + name.len()].copy_from_slice(&name);
        player[PGD_BODY_TYPE] = 1;
        player[PGD_ARCHETYPE] = character.archetype;
        player[PGD_GIFT] = 3;
        data.extend_from_slice(&player);

        pad(&mut data, BEFORE_PROJECTILES);
        put_u32(&mut data, character.projectiles as u32);
        pad(&mut data, 8 * character.projectiles);
        pad(&mut data, BEFORE_FACE);
        let mut face = vec![0u8; FACE_LEN];
        face[..4].copy_from_slice(&[0xFF; 4]);
        face[4..8].copy_from_slice(b"FACE");
        data.extend_from_slice(&face);
        pad(&mut data, BEFORE_REGIONS);
        put_u32(&mut data, 2);
        pad(&mut data, 8);
        pad(&mut data, BEFORE_CYCLE);
        put_u32(&mut data, character.cycle);
        put_u32(&mut data, 0);
        put_u32(&mut data, 0);
        put_u32(&mut data, 0x1000);
        pad(&mut data, 0x1000);
        pad(&mut data, BEFORE_TUTORIALS);
        put_u32(&mut data, TUTORIAL_TAG | 1 << 16);
        put_u32(&mut data, 0x400);
        pad(&mut data, 0x400);
        pad(&mut data, BEFORE_DEATHS);
        put_u32(&mut data, character.deaths);
        pad(&mut data, BEFORE_FLAGS);

        let mut flags = vec![0u8; EVENT_FLAGS_LEN as usize];
        for count in 0..=character.great_runes {
            let flag = 180 + count as usize;
            set_flag(&mut flags, flag / 8, 7 - (flag % 8) as u8);
        }
        if character.realm_of_shadow {
            set_flag(&mut flags, 1500, 5);
        }
        data.extend_from_slice(&flags);

        for size in [4u32, 16, 0, 8, 4] {
            put_u32(&mut data, size);
            pad(&mut data, size as usize);
        }
        pad(&mut data, BEFORE_NET_MAN as usize + 5);
        put_u32(&mut data, NET_MAN_TAG);
        pad(&mut data, BEFORE_ACTIVITIES as usize - 4);
        data.extend_from_slice(&character.activities);
        pad(&mut data, 0x20 - 7 + 0x32 + 0x80);
        data
    }

    fn profile(character: &TestCharacter, seconds: u32, map: [u8; 4]) -> Vec<u8> {
        let mut profile = vec![0u8; PROFILE_LEN];
        let name = utf16(character.name);
        profile[..name.len()].copy_from_slice(&name);
        profile[PROFILE_LEVEL..PROFILE_LEVEL + 4].copy_from_slice(&character.level.to_le_bytes());
        profile[PROFILE_SECONDS..PROFILE_SECONDS + 4].copy_from_slice(&seconds.to_le_bytes());
        profile[PROFILE_MAP..PROFILE_MAP + 4].copy_from_slice(&map);
        profile[PROFILE_BODY_TYPE] = 1;
        profile[PROFILE_ARCHETYPE] = character.archetype;
        profile[PROFILE_GIFT] = 3;
        profile
    }

    struct TestSlot {
        index: usize,
        active: bool,
        data: Vec<u8>,
        profile: Vec<u8>,
    }

    fn build_save(slots: &[TestSlot]) -> Vec<u8> {
        let mut body = Vec::new();
        let mut entries = Vec::new();
        for index in 0..SLOT_COUNT {
            let data = slots
                .iter()
                .find(|slot| slot.index == index)
                .map_or(&[][..], |slot| &slot.data);
            entries.push((HEADER_LEN + body.len(), 16 + data.len()));
            body.extend_from_slice(&[0xAB; 16]);
            body.extend_from_slice(data);
        }
        let mut summary = vec![0u8; 0x60010];
        for slot in slots {
            summary[ACTIVE_FLAGS + slot.index] = u8::from(slot.active);
            let at = PROFILES + slot.index * PROFILE_LEN;
            summary[at..at + PROFILE_LEN].copy_from_slice(&slot.profile);
        }
        entries.push((HEADER_LEN + body.len(), summary.len()));
        body.extend_from_slice(&summary);
        entries.push((HEADER_LEN + body.len(), 0x20));
        body.extend_from_slice(&[0; 0x20]);

        let mut header = vec![0u8; HEADER_LEN];
        header[..4].copy_from_slice(b"BND4");
        header[0x0C..0x10].copy_from_slice(&(ENTRY_COUNT as u32).to_le_bytes());
        header[0x10..0x18].copy_from_slice(&0x40u64.to_le_bytes());
        header[0x18..0x20].copy_from_slice(b"00000001");
        header[0x20..0x28].copy_from_slice(&(ENTRY_LEN as u64).to_le_bytes());
        header[0x28..0x30].copy_from_slice(&(HEADER_LEN as u64).to_le_bytes());
        for (index, (offset, size)) in entries.iter().enumerate() {
            let at = ENTRY_TABLE + index * ENTRY_LEN;
            header[at..at + 4].copy_from_slice(&0x50u32.to_le_bytes());
            header[at + 4..at + 8].copy_from_slice(&(-1i32).to_le_bytes());
            header[at + 8..at + 16].copy_from_slice(&(*size as u64).to_le_bytes());
            header[at + 16..at + 20].copy_from_slice(&(*offset as u32).to_le_bytes());
        }
        header.extend_from_slice(&body);
        header
    }

    fn standard_save() -> Vec<u8> {
        let main = TestCharacter::default();
        let deleted = TestCharacter {
            name: "Gone",
            ..TestCharacter::default()
        };
        let modded = TestCharacter {
            name: "Heavy",
            archetype: 11,
            map: CHURCH_OF_ELLEH,
            weapons: GAITEMS,
            projectiles: 8000,
            cycle: 0,
            great_runes: 0,
            realm_of_shadow: false,
            activities: [1, 0, 0, 0, 0, 0, 0],
            ..TestCharacter::default()
        };
        build_save(&[
            TestSlot {
                index: 0,
                active: true,
                data: slot_data(&main),
                profile: profile(&main, 40_000, STORMVEIL),
            },
            TestSlot {
                index: 1,
                active: false,
                data: slot_data(&deleted),
                profile: profile(&deleted, 9, STORMVEIL),
            },
            TestSlot {
                index: 2,
                active: true,
                data: vec![0; 0x1000],
                profile: profile(&main, 9, STORMVEIL),
            },
            TestSlot {
                index: 4,
                active: true,
                data: slot_data(&modded),
                profile: profile(&modded, 7, STORMVEIL),
            },
        ])
    }

    fn save_file(name: &str, bytes: Vec<u8>) -> SaveFile {
        let mut file = SaveFile::from_bytes(RAW_PATH, name, bytes);
        file.modified_at_ms = Some(1_762_812_000_000);
        file
    }

    fn text(value: &str) -> StatValue {
        StatValue::Text(value.to_owned())
    }

    #[test]
    fn reads_active_characters() {
        let files = vec![
            save_file("ER0000.sl2", standard_save()),
            SaveFile::from_bytes(
                "<winPublic>/Documents/Steam/RUNE/1",
                "achievements.ini",
                b"[x]".to_vec(),
            ),
        ];
        let slots = read_slots(&files);
        let ids: Vec<&str> = slots.iter().map(|slot| slot.id.as_str()).collect();
        assert_eq!(ids, ["character-0", "character-4"]);

        let slot = &slots[0];
        assert_eq!(slot.kind, SlotKind::Manual);
        assert_eq!(slot.title.as_deref(), Some("Tester"));
        assert_eq!(slot.saved_at_ms, Some(1_762_812_000_000));
        assert_eq!(slot.files, ["ER0000.sl2"]);
        assert_eq!(slot.stat(StatKind::Level), Some(&StatValue::Integer(56)));
        assert_eq!(
            slot.stat(StatKind::Playtime),
            Some(&StatValue::Seconds(45_296))
        );
        assert_eq!(slot.stat(StatKind::Money), Some(&StatValue::Integer(2873)));
        assert_eq!(slot.stat(StatKind::CharacterName), Some(&text("Tester")));
        assert_eq!(
            slot.stat(StatKind::CharacterClass),
            Some(&cataloged_label("elden_ring.class.samurai", "Samurai"))
        );
        assert_eq!(
            slot.stat(StatKind::Location),
            Some(&cataloged_label(
                "elden_ring.location.stormveil_castle",
                "Stormveil Castle"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Quest),
            Some(&cataloged_label(
                "elden_ring.quest.defeated_starscourge_radahn",
                "Defeated Starscourge Radahn"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Collectibles),
            Some(&StatValue::Progress {
                current: 2,
                total: 7
            })
        );
        assert_eq!(slot.stat(StatKind::Deaths), Some(&StatValue::Integer(124)));
        assert_eq!(
            slot.stat(StatKind::NewGamePlus),
            Some(&StatValue::Integer(1))
        );
        assert_eq!(
            slot.stat(StatKind::Content),
            Some(&cataloged_label(
                "elden_ring.content.shadow_of_the_erdtree",
                "Shadow of the Erdtree"
            ))
        );
        assert_eq!(slot.playthrough.as_ref().map(String::len), Some(8));
    }

    #[test]
    fn reads_slots_that_need_more_than_the_first_window() {
        let slots = read_slots(&[save_file("ER0000.sl2", standard_save())]);
        let slot = &slots[1];
        assert_eq!(slot.id, "character-4");
        assert_eq!(slot.stat(StatKind::CharacterClass), None);
        assert_eq!(
            slot.stat(StatKind::Location),
            Some(&cataloged_label("elden_ring.location.limgrave", "Limgrave"))
        );
        assert_eq!(slot.stat(StatKind::Quest), None);
        assert_eq!(
            slot.stat(StatKind::Collectibles),
            Some(&StatValue::Progress {
                current: 0,
                total: 7
            })
        );
        assert_eq!(slot.stat(StatKind::NewGamePlus), None);
        assert_eq!(slot.stat(StatKind::Deaths), Some(&StatValue::Integer(124)));
        assert_eq!(slot.stat(StatKind::Content), None);
        assert_ne!(slot.playthrough, slots[0].playthrough);
    }

    #[test]
    fn reads_from_disk_with_seeks() {
        let bytes = standard_save();
        let mut temp = tempfile::NamedTempFile::new().unwrap();
        temp.write_all(&bytes).unwrap();
        let on_disk = SaveFile {
            raw_path: RAW_PATH.to_owned(),
            relative_path: "ER0000.sl2".to_owned(),
            size: bytes.len() as u64,
            modified_at_ms: Some(1_762_812_000_000),
            content: FileContent::Path(temp.path().to_path_buf()),
        };
        assert_eq!(
            read_slots(&[on_disk]),
            read_slots(&[save_file("ER0000.sl2", bytes)])
        );
    }

    #[test]
    fn falls_back_to_the_load_screen_summary() {
        let character = TestCharacter::default();
        let mut data = slot_data(&character);
        let face = find(&data, b"FACE", 0).unwrap();
        data[face] = b'X';
        data.truncate(data.len() / 2);
        let save = build_save(&[TestSlot {
            index: 3,
            active: true,
            data,
            profile: profile(&character, 3_600, CHURCH_OF_ELLEH),
        }]);
        let slots = read_slots(&[save_file("ER0000.sl2", save)]);
        assert_eq!(slots.len(), 1);
        let slot = &slots[0];
        assert_eq!(slot.id, "character-3");
        assert_eq!(slot.stat(StatKind::Level), Some(&StatValue::Integer(56)));
        assert_eq!(
            slot.stat(StatKind::Playtime),
            Some(&StatValue::Seconds(3_600))
        );
        assert_eq!(slot.stat(StatKind::CharacterName), Some(&text("Tester")));
        assert_eq!(
            slot.stat(StatKind::Location),
            Some(&cataloged_label("elden_ring.location.limgrave", "Limgrave"))
        );
        assert_eq!(slot.stat(StatKind::Money), None);
        assert_eq!(slot.stat(StatKind::Deaths), None);

        let intact = build_save(&[TestSlot {
            index: 3,
            active: true,
            data: slot_data(&character),
            profile: profile(&character, 3_600, CHURCH_OF_ELLEH),
        }]);
        let intact = read_slots(&[save_file("ER0000.sl2", intact)]);
        assert_eq!(intact[0].playthrough, slot.playthrough);
        assert!(slot.playthrough.is_some());
    }

    #[test]
    fn names_seamless_coop_and_convergence_slots() {
        let coop = read_slots(&[save_file("ER0000.co2", standard_save())]);
        assert_eq!(coop[0].id, "co2-character-0");
        assert_eq!(
            coop[0].stat(StatKind::CharacterClass),
            Some(&cataloged_label("elden_ring.class.samurai", "Samurai"))
        );

        let convergence = read_slots(&[save_file("ER0000.cnv", standard_save())]);
        assert_eq!(convergence[0].id, "cnv-character-0");
        assert_eq!(convergence[0].stat(StatKind::CharacterClass), None);

        assert!(read_slots(&[save_file("ER0000.sl2.bak", standard_save())]).is_empty());
        assert!(read_slots(&[save_file("ER0001.sl2", standard_save())]).is_empty());
    }

    #[test]
    fn ignores_garbage_and_truncated_files() {
        let save = standard_save();
        let entries = read_entries(&save[..HEADER_LEN]).unwrap();
        let summary_at = entries[SUMMARY_ENTRY].offset as usize;
        for bytes in [
            Vec::new(),
            b"BND4".to_vec(),
            vec![0x5A; 0x4000],
            save[..HEADER_LEN].to_vec(),
            save[..summary_at + 0x100].to_vec(),
        ] {
            assert!(read_slots(&[save_file("ER0000.sl2", bytes)]).is_empty());
        }

        let mut bad_flags = save.clone();
        bad_flags[summary_at + ACTIVE_FLAGS] = 7;
        assert!(read_slots(&[save_file("ER0000.sl2", bad_flags)]).is_empty());

        let mut shrunk = save.clone();
        let slot_entry = ENTRY_TABLE + 4 * ENTRY_LEN + 8;
        shrunk[slot_entry..slot_entry + 8].copy_from_slice(&0x30000u64.to_le_bytes());
        let slots = read_slots(&[save_file("ER0000.sl2", shrunk)]);
        let slot = slots.iter().find(|slot| slot.id == "character-4").unwrap();
        assert_eq!(slot.stat(StatKind::Deaths), None);
        assert_eq!(slot.stat(StatKind::Playtime), Some(&StatValue::Seconds(7)));

        let mut huge = save;
        huge[slot_entry..slot_entry + 8].copy_from_slice(&u64::MAX.to_le_bytes());
        let slots = read_slots(&[save_file("ER0000.sl2", huge)]);
        assert_eq!(slots.len(), 2);
    }

    #[test]
    fn event_flags_follow_the_block_table() {
        let mut flags = vec![0u8; FLAGS_READ];
        flags[1500] = 0x20;
        flags[22] = 0x01 | 0x02 | 0x04 | 0x08;
        assert_eq!(event_flag(&flags, 62002), Some(true));
        assert_eq!(event_flag(&flags, 62003), Some(false));
        assert_eq!(event_flag(&flags, 9100), None);
        assert_eq!(great_rune_count(&flags), Some(3));
        assert_eq!(great_rune_count(&[0; 8]), None);
    }

    #[test]
    fn location_names() {
        assert_eq!(location(STORMVEIL), Some("Stormveil Castle"));
        assert_eq!(location(CHURCH_OF_ELLEH), Some("Limgrave"));
        assert_eq!(location([0, 20, 21, 60]), Some("The Lands Between"));
        assert_eq!(location([0, 99, 99, 61]), Some("Realm of Shadow"));
        assert_eq!(location([0xFF; 4]), None);
        assert!(maps::DUNGEONS
            .windows(2)
            .all(|pair| (pair[0].0, pair[0].1) < (pair[1].0, pair[1].1)));
        assert!(maps::TILES
            .windows(2)
            .all(|pair| (pair[0].0, pair[0].1, pair[0].2) < (pair[1].0, pair[1].1, pair[1].2)));
        assert!(maps::TILES
            .iter()
            .all(|tile| usize::from(tile.3) < maps::REGIONS.len()));
    }

    #[test]
    fn display_text() {
        assert_eq!(class_name(9), Some("Wretch"));
        assert_eq!(class_name(10), None);
        assert_eq!(
            main_story(&[2, 2, 2, 2, 2, 2, 2]),
            Some("Defeated Godfrey, First Elden Lord")
        );
        assert_eq!(
            main_story(&[1, 2, 1, 1, 1, 1]),
            Some("Defeated Godrick the Grafted")
        );
        assert_eq!(main_story(&[1, 1, 0, 0, 0, 0, 0]), None);
        assert_eq!(
            utf16_name(&[0x41, 0, 0x42, 0, 0, 0, 0x43, 0]).as_deref(),
            Some("AB")
        );
        assert_eq!(utf16_name(&[0, 0, 0x41, 0]), None);
    }
}
