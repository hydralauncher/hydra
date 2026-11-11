//! Insomniac saves (Marvel's Spider-Man Remastered, Marvel's Spider-Man 2): one `.save` file per
//! slot, a DAT1 container (`1TAD`) whose sections hold Insomniac's self-describing serialized
//! objects: every field has a name (from the DAT1 string table), a type code and a value.
//! Remastered (DAT1 version 8) spreads its systems over ~25 sections, some of them packed
//! binary; Spider-Man 2 (version 9) stores one `Systems` tree with a named object per system.

use std::collections::HashMap;

use crate::games::{label, lookup, Parser};
use crate::model::{SaveSlot, SlotKind, Stat, StatKind, StatValue};
use crate::source::SaveFile;
use crate::util::u32_le;

pub const SPIDER_MAN_REMASTERED: Parser = Parser {
    id: "marvels-spider-man-remastered",
    version: 1,
    steam_app_ids: &["1817070"],
    read_slots: read_remastered_slots,
    labels: remastered_labels,
    read_profile: crate::games::no_profile,
    stat_names: &[],
};

pub const SPIDER_MAN_2: Parser = Parser {
    id: "marvels-spider-man-2",
    version: 1,
    steam_app_ids: &["2651280"],
    read_slots: read_spider_man_2_slots,
    labels: spider_man_2_labels,
    read_profile: crate::games::no_profile,
    stat_names: &[(StatKind::CharacterName, "Hero")],
};

const REMASTERED_LABEL_PREFIX: &str = "marvels_spider_man_remastered";
const SPIDER_MAN_2_LABEL_PREFIX: &str = "marvels_spider_man_2";

/// Indexed by the act number in a main story mission name, minus one.
const REMASTERED_ACTS: [&str; 3] = ["Act 1", "Act 2", "Act 3"];

const REMASTERED_DIFFICULTIES: [&str; 5] = [
    "Friendly Neighborhood",
    "Friendly",
    "Amazing",
    "Spectacular",
    "Ultimate",
];

const SPIDER_MAN_2_ACTS: [(&str, &str); 4] = [
    ("kAct1", "Act 1"),
    ("kAct2", "Act 2"),
    ("kAct3", "Act 3"),
    ("kPostGP", "Post-game"),
];

const SPIDER_MAN_2_DIFFICULTIES: [(&str, &str); 5] = [
    ("kSuperEasy", "Friendly Neighborhood"),
    ("kEasy", "Friendly"),
    ("kNormal", "Amazing"),
    ("kHard", "Spectacular"),
    ("kSuperHuman", "Ultimate"),
];

const HERO_CHARACTERS: [(&str, &str); 2] = [
    ("Spider-Man", "Peter Parker"),
    ("MilesMoralesHero", "Miles Morales"),
];

const CHARACTER_GROUPS: [(&str, &str); 2] = [
    ("kCharacter1", "Peter Parker"),
    ("kCharacter2", "Miles Morales"),
];

fn remastered_labels() -> Vec<(&'static str, &'static str)> {
    let acts = REMASTERED_ACTS.iter().map(|&act| ("act", act));
    let difficulties = REMASTERED_DIFFICULTIES
        .iter()
        .map(|&text| ("difficulty", text));
    acts.chain(difficulties).collect()
}

fn spider_man_2_labels() -> Vec<(&'static str, &'static str)> {
    let acts = SPIDER_MAN_2_ACTS.iter().map(|&(_, act)| ("act", act));
    let difficulties = SPIDER_MAN_2_DIFFICULTIES
        .iter()
        .map(|&(_, text)| ("difficulty", text));
    let heroes = HERO_CHARACTERS
        .iter()
        .chain(&CHARACTER_GROUPS)
        .map(|&(_, hero)| ("hero", hero));
    acts.chain(difficulties).chain(heroes).collect()
}

const MAX_SAVE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_SECTIONS: usize = 1024;
const MAX_DEPTH: usize = 64;
const MAX_VALUES: usize = 4_000_000;
const OBJECT_MAGIC: u32 = 0x0315_0044;
const NO_MISSION: i64 = 0xffff_ffff;

struct Progress {
    stats: Vec<Stat>,
    playthrough: Option<String>,
}

fn read_remastered_slots(files: &[SaveFile]) -> Vec<SaveSlot> {
    read_slots(files, remastered_slot_kind, remastered_progress)
}

fn read_spider_man_2_slots(files: &[SaveFile]) -> Vec<SaveSlot> {
    read_slots(files, spider_man_2_slot_kind, spider_man_2_progress)
}

fn read_slots(
    files: &[SaveFile],
    slot_kind: fn(&str) -> Option<SlotKind>,
    progress: fn(&[Object<'_>]) -> Progress,
) -> Vec<SaveSlot> {
    let mut slots: Vec<SaveSlot> = Vec::new();
    for file in files {
        let Some(stem) = file.file_name().strip_suffix(".save") else {
            continue;
        };
        let Some(kind) = slot_kind(stem) else {
            continue;
        };
        let bytes = file.read_prefix(MAX_SAVE_BYTES).unwrap_or_default();
        let progress = Dat1::parse(&bytes).map(|dat1| progress(&dat1.objects()));
        let (stats, playthrough) =
            progress.map_or((Vec::new(), None), |p| (p.stats, p.playthrough));
        let slot = SaveSlot {
            id: stem.to_owned(),
            kind,
            title: None,
            saved_at_ms: file.modified_at_ms,
            playthrough,
            stats,
            thumbnail: None,
            files: vec![file.relative_path.clone()],
        };
        match slots.iter_mut().find(|existing| existing.id == slot.id) {
            Some(existing) if existing.saved_at_ms < slot.saved_at_ms => *existing = slot,
            Some(_) => {}
            None => slots.push(slot),
        }
    }
    slots
}

/// `slot0-s` is the slot's autosave, `slot0-s-manual-2` a manual save of that slot.
fn remastered_slot_kind(stem: &str) -> Option<SlotKind> {
    let rest = stem.strip_prefix("slot")?;
    let (slot, rest) = rest.split_once("-s")?;
    if !is_number(slot) {
        return None;
    }
    match rest {
        "" => Some(SlotKind::Auto),
        _ => rest
            .strip_prefix("-manual-")
            .filter(|n| is_number(n))
            .map(|_| SlotKind::Manual),
    }
}

/// `slot1-autosave` and `slot1-manual-0`.
fn spider_man_2_slot_kind(stem: &str) -> Option<SlotKind> {
    let (slot, rest) = stem.strip_prefix("slot")?.split_once('-')?;
    if !is_number(slot) {
        return None;
    }
    match rest {
        "autosave" => Some(SlotKind::Auto),
        _ => rest
            .strip_prefix("manual-")
            .filter(|n| is_number(n))
            .map(|_| SlotKind::Manual),
    }
}

fn is_number(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())
}

fn remastered_progress(objects: &[Object<'_>]) -> Progress {
    let mut stats = Vec::new();
    let save = objects
        .iter()
        .find(|object| object.get("GamePercent").is_some());
    let segments = objects.iter().find_map(|object| object.object("Segments"));
    let playthrough = segments.and_then(|segments| segment_of_type(segments, "Playthrough"));

    if let Some(percent) = save
        .and_then(|save| save.f64("GamePercent"))
        .and_then(completion_percent)
    {
        stats.push(Stat::new(StatKind::Completion, StatValue::Percent(percent)));
    }
    if let Some(seconds) = playthrough.and_then(segment_seconds) {
        stats.push(Stat::new(StatKind::Playtime, StatValue::Seconds(seconds)));
    }
    let active_mission = save
        .and_then(|save| save.i64("ActiveMissionHash"))
        .filter(|hash| *hash != 0 && *hash != NO_MISSION);
    let act = active_mission
        .zip(segments)
        .and_then(|(hash, segments)| mission_name(segments, hash))
        .and_then(story_act);
    if let Some(act) = act {
        stats.push(Stat::new(
            StatKind::Chapter,
            label(REMASTERED_LABEL_PREFIX, "act", act),
        ));
    }
    let difficulty = save.and_then(|save| {
        [save.i64("SlotDifficulty"), save.i64("Difficulty")]
            .into_iter()
            .flatten()
            .find(|level| *level != 0)
            .or(save.i64("SlotDifficulty"))
    });
    if let Some(name) = difficulty.and_then(remastered_difficulty_name) {
        stats.push(Stat::new(
            StatKind::Difficulty,
            label(REMASTERED_LABEL_PREFIX, "difficulty", name),
        ));
    }
    if save.and_then(|save| save.bool("NewGamePlus")) == Some(true) {
        stats.push(Stat::new(StatKind::NewGamePlus, StatValue::Integer(1)));
    }

    Progress {
        stats,
        playthrough: playthrough.and_then(segment_id),
    }
}

fn spider_man_2_progress(objects: &[Object<'_>]) -> Progress {
    let systems = systems(objects);
    let save_file = systems.get("SaveFile").copied();
    let hero = systems.get("HeroSystem").copied();
    let objectives = systems
        .get("ObjectiveSystem")
        .and_then(|system| system.object("SystemData"))
        .and_then(|data| data.object("Obj"));
    let playthrough = systems
        .get("DevstatsSegmentSystem")
        .and_then(|system| system.object("Segments"))
        .and_then(|segments| segment_of_type(segments, "Playthrough"));

    let mut stats = Vec::new();
    if let Some(level) = hero
        .and_then(|hero| hero.i64("DisplayLevel"))
        .filter(|level| *level > 0)
    {
        stats.push(Stat::new(StatKind::Level, StatValue::Integer(level)));
    }
    if let Some(percent) = save_file
        .and_then(|save| save.f64("GamePercent"))
        .and_then(completion_percent)
    {
        stats.push(Stat::new(StatKind::Completion, StatValue::Percent(percent)));
    }
    if let Some(seconds) = playthrough.and_then(segment_seconds) {
        stats.push(Stat::new(StatKind::Playtime, StatValue::Seconds(seconds)));
    }
    if let Some(act) = objectives
        .and_then(|data| data.str("CurrentAct"))
        .and_then(|code| lookup(&SPIDER_MAN_2_ACTS, code))
    {
        stats.push(Stat::new(
            StatKind::Chapter,
            label(SPIDER_MAN_2_LABEL_PREFIX, "act", act),
        ));
    }
    let difficulty = systems
        .get("DifficultySystem")
        .and_then(|system| system.str("Difficulty"));
    if let Some(name) = difficulty.and_then(|code| lookup(&SPIDER_MAN_2_DIFFICULTIES, code)) {
        stats.push(Stat::new(
            StatKind::Difficulty,
            label(SPIDER_MAN_2_LABEL_PREFIX, "difficulty", name),
        ));
    }
    let hero_name = objectives
        .and_then(current_hero_override)
        .and_then(|code| lookup(&HERO_CHARACTERS, code))
        .or_else(|| {
            hero.and_then(current_character_group)
                .and_then(|code| lookup(&CHARACTER_GROUPS, code))
        });
    if let Some(name) = hero_name {
        stats.push(Stat::new(
            StatKind::CharacterName,
            label(SPIDER_MAN_2_LABEL_PREFIX, "hero", name),
        ));
    }
    if let Some(collected) = systems
        .get("CollectibleSystemGame")
        .and_then(|system| collectibles(system))
    {
        stats.push(Stat::new(StatKind::Collectibles, collected));
    }
    if save_file.and_then(|save| save.bool("NewGamePlus")) == Some(true) {
        stats.push(Stat::new(StatKind::NewGamePlus, StatValue::Integer(1)));
    }

    Progress {
        stats,
        playthrough: playthrough.and_then(segment_id),
    }
}

/// Maps each system's `SaveName` to its `SaveData.Obj`, whether the `Systems` root decoded or
/// only the individual system objects did.
fn systems<'o, 'a>(objects: &'o [Object<'a>]) -> HashMap<&'a str, &'o Object<'a>> {
    let mut systems = HashMap::new();
    let mut add = |system: &'o Object<'a>| {
        let data = system
            .object("SaveData")
            .and_then(|data| data.object("Obj"));
        if let (Some(name), Some(data)) = (system.str("SaveName"), data) {
            systems.entry(name).or_insert(data);
        }
    };
    for object in objects {
        match object.object("Systems") {
            Some(root) => root.objects().for_each(&mut add),
            None => add(object),
        }
    }
    systems
}

fn segment_of_type<'o, 'a>(segments: &'o Object<'a>, kind: &str) -> Option<&'o Object<'a>> {
    segments
        .objects()
        .find(|segment| segment.str("SegmentType") == Some(kind))
}

fn segment_seconds(segment: &Object<'_>) -> Option<u64> {
    let seconds = segment.f64("Duration")?;
    (seconds.is_finite() && seconds >= 0.0).then_some(seconds as u64)
}

fn segment_id(segment: &Object<'_>) -> Option<String> {
    segment
        .str("SegmentId")
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
}

fn mission_name<'a>(segments: &Object<'a>, hash: i64) -> Option<&'a str> {
    segments
        .objects()
        .filter(|segment| segment.str("SegmentType") == Some("Mission"))
        .filter_map(|segment| segment.str("SegmentName"))
        .find(|name| i64::from(insomniac_crc32(name.as_bytes())) == hash)
}

/// Main story missions are named `GP_A<act>_...`.
fn story_act(mission: &str) -> Option<&'static str> {
    let act: usize = mission
        .strip_prefix("GP_A")?
        .split('_')
        .next()?
        .parse()
        .ok()?;
    REMASTERED_ACTS.get(act.checked_sub(1)?).copied()
}

/// `GamePercent` is a 0..1 fraction; integral values are stored as integers, and a few saves
/// hold a value that is already a percentage.
fn completion_percent(value: f64) -> Option<f64> {
    let percent = match value {
        v if (0.0..=1.0).contains(&v) => v * 100.0,
        v if v > 1.0 && v <= 100.0 => v,
        _ => return None,
    };
    Some((percent * 10.0).round() / 10.0)
}

fn remastered_difficulty_name(level: i64) -> Option<&'static str> {
    REMASTERED_DIFFICULTIES
        .get(usize::try_from(level).ok()?)
        .copied()
}

fn current_hero_override<'a>(objectives: &Object<'a>) -> Option<&'a str> {
    objectives
        .object("CurrentOverridesRestorePoint")?
        .object("OverrideTable")?
        .objects()
        .filter_map(|entry| {
            entry
                .object("ActivationOverride")?
                .object("Obj")?
                .str("HeroCharacter")
        })
        .next()
}

fn current_character_group<'a>(hero: &Object<'a>) -> Option<&'a str> {
    hero.object("InventoryActors")?
        .array("Inventories")?
        .iter()
        .filter_map(Value::as_object)
        .find_map(|actor| {
            actor
                .object("Inventory")?
                .object("Obj")?
                .object("AbilityState")?
                .str("CharacterGroup")
        })
}

/// Spider-Bots, photo ops, Sandman memories, Prowler tech and one more 10-item set whose name is
/// unknown. Another set of 250 is left out: it is only partly completed in 100% saves.
const COLLECTIBLE_TYPES: [&str; 5] = [
    "SpiderBots",
    "Photos",
    "Sandman",
    "ProwlerTech",
    "2170360408",
];

fn collectibles(system: &Object<'_>) -> Option<StatValue> {
    let types = system.object("TypeSaveData")?;
    let mut collected = 0u32;
    let mut total = 0u32;
    let mut complete_lists = true;
    let mut found = false;
    for name in COLLECTIBLE_TYPES {
        let key = if is_number(name) {
            name.to_owned()
        } else {
            insomniac_crc32(name.as_bytes()).to_string()
        };
        let Some(entry) = types.object(&key) else {
            complete_lists = false;
            continue;
        };
        found = true;
        collected = collected.saturating_add(
            entry
                .i64("NumCompleted")
                .and_then(|n| u32::try_from(n).ok())
                .unwrap_or(0),
        );
        match entry
            .object("InstanceSaveData")
            .map(|instances| instances.fields.len())
        {
            Some(count) if count > 0 => total = total.saturating_add(u32::try_from(count).ok()?),
            _ => complete_lists = false,
        }
    }
    if !found {
        return None;
    }
    Some(if complete_lists && total >= collected {
        StatValue::Progress {
            current: collected,
            total,
        }
    } else {
        StatValue::Integer(i64::from(collected))
    })
}

/// The CRC-32 Insomniac uses for name hashes: reflected 0xEDB88320, seeded with the polynomial, no final xor.
fn insomniac_crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xedb8_8320u32;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xedb8_8320
            } else {
                crc >> 1
            };
        }
    }
    crc
}

struct Dat1<'a> {
    bytes: &'a [u8],
    strings: (usize, usize),
    sections: Vec<(usize, usize)>,
}

impl<'a> Dat1<'a> {
    fn parse(bytes: &'a [u8]) -> Option<Self> {
        if bytes.get(..4)? != b"1TAD" {
            return None;
        }
        let count = usize::from(u16_le(bytes, 12)?);
        let extra = usize::from(u16_le(bytes, 14)?);
        if count == 0 || count > MAX_SECTIONS {
            return None;
        }
        let table_end = 16 + count * 12 + extra * 8;
        let mut first_offset = usize::MAX;
        let mut sections = Vec::with_capacity(count);
        for index in 0..count {
            let entry = 16 + index * 12;
            let offset = u32_le(bytes, entry + 4)? as usize;
            let size = u32_le(bytes, entry + 8)? as usize;
            first_offset = first_offset.min(offset);
            let end = offset.checked_add(size)?;
            if offset >= table_end && end <= bytes.len() {
                sections.push((offset, end));
            }
        }
        sections.sort_unstable();
        let strings_end = first_offset.min(bytes.len());
        (table_end <= strings_end).then_some(Self {
            bytes,
            strings: (table_end, strings_end),
            sections,
        })
    }

    fn name(&self, offset: usize) -> Option<&'a str> {
        let (start, end) = self.strings;
        if offset < start || offset >= end {
            return None;
        }
        let tail = &self.bytes[offset..end];
        let len = tail.iter().position(|&byte| byte == 0)?;
        std::str::from_utf8(&tail[..len]).ok()
    }

    /// Every serialized object found at the top level of a section. A section may hold several
    /// objects behind a small binary header; an object that fails to decode is skipped, and the
    /// scan then finds the objects nested inside it.
    fn objects(&self) -> Vec<Object<'a>> {
        let mut decoder = Decoder {
            dat1: self,
            budget: MAX_VALUES,
        };
        let mut objects = Vec::new();
        for &(start, end) in &self.sections {
            let mut at = start;
            while at + 16 <= end {
                if u32_le(self.bytes, at) == Some(0)
                    && u32_le(self.bytes, at + 4) == Some(OBJECT_MAGIC)
                {
                    if let Some((object, object_end)) =
                        decoder.object(at, 0).filter(|(_, e)| *e <= end)
                    {
                        objects.push(object);
                        at = object_end.max(at + 4);
                        continue;
                    }
                }
                at += 4;
            }
        }
        objects
    }
}

#[derive(Debug)]
enum Value<'a> {
    Unsigned(u64),
    Signed(i64),
    Float(f64),
    Bool(bool),
    Text(&'a str),
    Object(Object<'a>),
    Array(Vec<Value<'a>>),
    Null,
}

impl<'a> Value<'a> {
    fn as_f64(&self) -> Option<f64> {
        match *self {
            Value::Unsigned(value) => Some(value as f64),
            Value::Signed(value) => Some(value as f64),
            Value::Float(value) => Some(value),
            _ => None,
        }
    }

    fn as_i64(&self) -> Option<i64> {
        match *self {
            Value::Unsigned(value) => i64::try_from(value).ok(),
            Value::Signed(value) => Some(value),
            _ => None,
        }
    }

    fn as_object(&self) -> Option<&Object<'a>> {
        match self {
            Value::Object(object) => Some(object),
            _ => None,
        }
    }
}

#[derive(Debug, Default)]
struct Object<'a> {
    fields: Vec<(&'a str, Value<'a>)>,
}

impl<'a> Object<'a> {
    fn get(&self, name: &str) -> Option<&Value<'a>> {
        self.fields
            .iter()
            .find(|(field, _)| *field == name)
            .map(|(_, value)| value)
    }

    fn object(&self, name: &str) -> Option<&Object<'a>> {
        self.get(name)?.as_object()
    }

    fn objects(&self) -> impl Iterator<Item = &Object<'a>> {
        self.fields
            .iter()
            .filter_map(|(_, value)| value.as_object())
    }

    fn array(&self, name: &str) -> Option<&[Value<'a>]> {
        match self.get(name)? {
            Value::Array(items) => Some(items),
            _ => None,
        }
    }

    fn f64(&self, name: &str) -> Option<f64> {
        self.get(name)?.as_f64()
    }

    fn i64(&self, name: &str) -> Option<i64> {
        self.get(name)?.as_i64()
    }

    fn bool(&self, name: &str) -> Option<bool> {
        match self.get(name)? {
            Value::Bool(value) => Some(*value),
            Value::Unsigned(value) => Some(*value != 0),
            _ => None,
        }
    }

    fn str(&self, name: &str) -> Option<&'a str> {
        match self.get(name)? {
            Value::Text(text) => Some(text),
            _ => None,
        }
    }
}

struct Decoder<'d, 'a> {
    dat1: &'d Dat1<'a>,
    budget: usize,
}

impl<'a> Decoder<'_, 'a> {
    /// Header: u32 0, u32 magic, u32 field count, u32 byte length of what follows. Then one
    /// (u32 name hash, u16 flags, u8, u8 type) per field, one u32 name offset per field, and the
    /// values, which start 4-aligned and are otherwise packed.
    fn object(&mut self, at: usize, depth: usize) -> Option<(Object<'a>, usize)> {
        let bytes = self.dat1.bytes;
        if depth > MAX_DEPTH || u32_le(bytes, at)? != 0 || u32_le(bytes, at + 4)? != OBJECT_MAGIC {
            return None;
        }
        let count = u32_le(bytes, at + 8)? as usize;
        let start = at + 16;
        let end = start.checked_add(u32_le(bytes, at + 12)? as usize)?;
        if end > bytes.len() || count > (end - start) / 12 {
            return None;
        }
        let mut cursor = align4(start + count * 12);
        let mut fields = Vec::with_capacity(count);
        for index in 0..count {
            let entry = start + index * 8;
            let flags = u16_le(bytes, entry + 4)?;
            let kind = *bytes.get(entry + 7)?;
            let name_offset = u32_le(bytes, start + count * 8 + index * 4)? as usize;
            let name = self.dat1.name(name_offset).unwrap_or("");
            let items = usize::from(flags >> 4);
            let is_array = flags & 1 != 0 || items != 1;
            let value = if items == 0 && flags & 1 != 0 {
                cursor = self.value(cursor, kind, depth)?.1;
                Value::Array(Vec::new())
            } else if is_array {
                let mut values = Vec::with_capacity(items.min(end.saturating_sub(cursor)));
                for _ in 0..items {
                    let (value, next) = self.value(cursor, kind, depth)?;
                    values.push(value);
                    cursor = next;
                }
                Value::Array(values)
            } else {
                let (value, next) = self.value(cursor, kind, depth)?;
                cursor = next;
                value
            };
            if cursor > end {
                return None;
            }
            fields.push((name, value));
        }
        Some((Object { fields }, end))
    }

    fn value(&mut self, at: usize, kind: u8, depth: usize) -> Option<(Value<'a>, usize)> {
        self.budget = self.budget.checked_sub(1)?;
        let bytes = self.dat1.bytes;
        let raw = |len: usize| bytes.get(at..at.checked_add(len)?);
        Some(match kind {
            0x00 => (Value::Unsigned(u64::from(*raw(1)?.first()?)), at + 1),
            0x01 => (Value::Unsigned(u64::from(u16_le(bytes, at)?)), at + 2),
            0x02 => (Value::Unsigned(u64::from(u32_le(bytes, at)?)), at + 4),
            0x03 | 0x11 => (
                Value::Unsigned(u64::from_le_bytes(raw(8)?.try_into().ok()?)),
                at + 8,
            ),
            0x04 => (Value::Signed(i64::from(*raw(1)?.first()? as i8)), at + 1),
            0x05 => (Value::Signed(i64::from(u16_le(bytes, at)? as i16)), at + 2),
            0x06 => (Value::Signed(i64::from(u32_le(bytes, at)? as i32)), at + 4),
            0x07 => (
                Value::Signed(i64::from_le_bytes(raw(8)?.try_into().ok()?)),
                at + 8,
            ),
            0x08 => (
                Value::Float(f64::from(f32::from_le_bytes(raw(4)?.try_into().ok()?))),
                at + 4,
            ),
            0x09 => (
                Value::Float(f64::from_le_bytes(raw(8)?.try_into().ok()?)),
                at + 8,
            ),
            0x0a => {
                let len = u32_le(bytes, at)? as usize;
                let text = bytes.get(at + 16..(at + 16).checked_add(len)?)?;
                let text = std::str::from_utf8(text).unwrap_or("");
                (Value::Text(text), at + align4(16 + len + 1))
            }
            0x0d => {
                let (object, end) = self.object(at, depth + 1)?;
                (Value::Object(object), end)
            }
            0x0f => (Value::Bool(*raw(1)?.first()? != 0), at + 1),
            0x13 => (Value::Null, at + 1),
            _ => return None,
        })
    }
}

fn align4(value: usize) -> usize {
    (value + 3) & !3
}

fn u16_le(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        bytes.get(at..at.checked_add(2)?)?.try_into().ok()?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::cataloged_label;

    const REMASTERED_PATH: &str =
        "<winDocuments>/Marvel's Spider-Man Remastered/<storeUserId>/slot*.save";
    const SPIDER_MAN_2_PATH: &str = "<winDocuments>/Marvel's Spider-Man 2/<storeUserId>";

    enum V {
        U8(u8),
        U32(u32),
        F32(f32),
        F64(f64),
        Bool(bool),
        Str(&'static str),
        Obj(Vec<(&'static str, V)>),
        EmptyArray,
    }

    type Fields = Vec<(&'static str, V)>;

    fn kind(value: &V) -> u8 {
        match value {
            V::U8(_) => 0x00,
            V::U32(_) => 0x02,
            V::F32(_) => 0x08,
            V::F64(_) => 0x09,
            V::Bool(_) => 0x0f,
            V::Str(_) => 0x0a,
            V::Obj(_) => 0x0d,
            V::EmptyArray => 0x13,
        }
    }

    fn collect_names(fields: &Fields, names: &mut Vec<&'static str>) {
        for (name, value) in fields {
            if !names.contains(name) {
                names.push(name);
            }
            if let V::Obj(children) = value {
                collect_names(children, names);
            }
        }
    }

    struct Writer {
        out: Vec<u8>,
        names: HashMap<&'static str, u32>,
        version: u32,
    }

    impl Writer {
        fn object(&mut self, fields: &Fields) {
            self.out.extend_from_slice(&0u32.to_le_bytes());
            self.out.extend_from_slice(&OBJECT_MAGIC.to_le_bytes());
            self.out
                .extend_from_slice(&(fields.len() as u32).to_le_bytes());
            let len_at = self.out.len();
            self.out.extend_from_slice(&0u32.to_le_bytes());
            let start = self.out.len();
            for (name, value) in fields {
                let flags: u16 = match value {
                    V::EmptyArray if self.version >= 9 => 1,
                    V::EmptyArray => 0,
                    _ => 1 << 4,
                };
                self.out
                    .extend_from_slice(&insomniac_crc32(name.as_bytes()).to_le_bytes());
                self.out.extend_from_slice(&flags.to_le_bytes());
                self.out.extend_from_slice(&[0, kind(value)]);
            }
            for (name, _) in fields {
                let offset = self.names[name];
                self.out.extend_from_slice(&offset.to_le_bytes());
            }
            self.pad();
            for (_, value) in fields {
                self.value(value);
            }
            self.pad();
            let len = (self.out.len() - start) as u32;
            self.out[len_at..len_at + 4].copy_from_slice(&len.to_le_bytes());
        }

        fn value(&mut self, value: &V) {
            match value {
                V::U8(v) => self.out.push(*v),
                V::U32(v) => self.out.extend_from_slice(&v.to_le_bytes()),
                V::F32(v) => self.out.extend_from_slice(&v.to_le_bytes()),
                V::F64(v) => self.out.extend_from_slice(&v.to_le_bytes()),
                V::Bool(v) => self.out.push(u8::from(*v)),
                V::Str(text) => {
                    let start = self.out.len();
                    self.out
                        .extend_from_slice(&(text.len() as u32).to_le_bytes());
                    self.out.extend_from_slice(&[0xaa; 12]);
                    self.out.extend_from_slice(text.as_bytes());
                    self.out.push(0);
                    while !(self.out.len() - start).is_multiple_of(4) {
                        self.out.push(0);
                    }
                }
                V::Obj(fields) => self.object(fields),
                V::EmptyArray if self.version >= 9 => self.out.push(0),
                V::EmptyArray => {}
            }
        }

        fn pad(&mut self) {
            while !self.out.len().is_multiple_of(4) {
                self.out.push(0);
            }
        }
    }

    /// Builds a DAT1 file; each section is a binary prefix followed by serialized objects.
    fn dat1(version: u32, sections: Vec<(&[u8], Vec<Fields>)>) -> Vec<u8> {
        let mut names = Vec::new();
        for (_, objects) in &sections {
            objects
                .iter()
                .for_each(|fields| collect_names(fields, &mut names));
        }
        let table_end = 16 + sections.len() * 12;
        let mut strings = Vec::new();
        let mut offsets = HashMap::new();
        for name in names {
            offsets.insert(name, (table_end + strings.len()) as u32);
            strings.extend_from_slice(name.as_bytes());
            strings.push(0);
        }
        let mut writer = Writer {
            out: vec![0; table_end],
            names: offsets,
            version,
        };
        writer.out.extend_from_slice(&strings);
        let mut table = Vec::new();
        for (tag, (prefix, objects)) in sections.iter().enumerate() {
            while !writer.out.len().is_multiple_of(16) {
                writer.out.push(0);
            }
            let offset = writer.out.len();
            writer.out.extend_from_slice(prefix);
            objects.iter().for_each(|fields| writer.object(fields));
            table.push((
                tag as u32 + 1,
                offset as u32,
                (writer.out.len() - offset) as u32,
            ));
        }
        let mut out = writer.out;
        let total = out.len() as u32;
        out[..4].copy_from_slice(b"1TAD");
        out[4..8].copy_from_slice(&version.to_le_bytes());
        out[8..12].copy_from_slice(&total.to_le_bytes());
        out[12..14].copy_from_slice(&(sections.len() as u16).to_le_bytes());
        for (index, (tag, offset, size)) in table.into_iter().enumerate() {
            let entry = 16 + index * 12;
            out[entry..entry + 4].copy_from_slice(&tag.to_le_bytes());
            out[entry + 4..entry + 8].copy_from_slice(&offset.to_le_bytes());
            out[entry + 8..entry + 12].copy_from_slice(&size.to_le_bytes());
        }
        out
    }

    fn segment(id: &'static str, name: &'static str, kind: &'static str, seconds: f32) -> V {
        V::Obj(vec![
            ("SegmentId", V::Str(id)),
            ("SegmentName", V::Str(name)),
            ("SegmentType", V::Str(kind)),
            ("Duration", V::F32(seconds)),
        ])
    }

    fn remastered_save(slot_difficulty: u8, difficulty: u8) -> Vec<u8> {
        let segments = vec![
            (
                "Segments",
                V::Obj(vec![
                    (
                        "2709238609",
                        segment("PLAYTHROUGH-1", "Playthrough", "Playthrough", 30_538.96),
                    ),
                    (
                        "1314948469",
                        segment("A1", "GP_A1_SWING_TUTORIAL", "Mission", 30_538.96),
                    ),
                    ("2710302160", segment("A2", "GP_A2_ESU", "Mission", 4.26)),
                ]),
            ),
            ("PrimarySegment", V::U8(0)),
        ];
        let header = vec![
            ("CurrentLightingMode", V::Str("kNight")),
            ("CurrentLevel", V::U8(0)),
        ];
        let save = vec![
            ("SaveFilename", V::EmptyArray),
            ("GamePercent", V::F32(0.4768)),
            ("ActiveMissionHash", V::U32(insomniac_crc32(b"GP_A2_ESU"))),
            ("SlotDifficulty", V::U8(slot_difficulty)),
            ("Difficulty", V::U8(difficulty)),
            ("NewGamePlus", V::Bool(true)),
        ];
        dat1(
            8,
            vec![
                (&1u32.to_le_bytes(), vec![segments]),
                (b"2EMG", vec![header, save]),
            ],
        )
    }

    fn system(name: &'static str, fields: Fields) -> V {
        V::Obj(vec![
            ("SaveName", V::Str(name)),
            (
                "SaveData",
                V::Obj(vec![
                    ("Type", V::Str("SystemSave")),
                    ("Obj", V::Obj(fields)),
                ]),
            ),
        ])
    }

    fn collectible_type(completed: u8, instances: usize) -> V {
        let keys = ["a", "b", "c", "d"];
        let instances = keys[..instances]
            .iter()
            .map(|key| (*key, V::Obj(vec![("Completed", V::Bool(true))])))
            .collect();
        V::Obj(vec![
            ("InstanceSaveData", V::Obj(instances)),
            ("NumCompleted", V::U8(completed)),
        ])
    }

    fn hero_override(hero: &'static str) -> V {
        V::Obj(vec![(
            "OverrideTable",
            V::Obj(vec![(
                "1408043239",
                V::Obj(vec![(
                    "ActivationOverride",
                    V::Obj(vec![
                        ("Type", V::Str("ObjectiveActivationOverrideCharacterSwap")),
                        ("Obj", V::Obj(vec![("HeroCharacter", V::Str(hero))])),
                    ]),
                )]),
            )]),
        )])
    }

    fn spider_man_2_save() -> Vec<u8> {
        let objectives = vec![(
            "SystemData",
            V::Obj(vec![
                ("Type", V::Str("ObjSysSaveDataGame")),
                (
                    "Obj",
                    V::Obj(vec![
                        ("CurrentAct", V::Str("kAct2")),
                        (
                            "CurrentOverridesRestorePoint",
                            hero_override("MilesMoralesHero"),
                        ),
                    ]),
                ),
            ]),
        )];
        let segments = vec![(
            "Segments",
            V::Obj(vec![(
                "1",
                segment("PLAYTHROUGH-2", "Playthrough", "Playthrough", 47_088.0),
            )]),
        )];
        let collectibles = vec![(
            "TypeSaveData",
            V::Obj(vec![
                ("1323218430", collectible_type(2, 4)),
                ("906931902", collectible_type(1, 3)),
                ("2248887741", collectible_type(0, 2)),
                ("1602058874", collectible_type(1, 1)),
                ("2170360408", collectible_type(1, 2)),
                ("1022187135", collectible_type(3, 4)),
            ]),
        )];
        let save_file = vec![
            ("Visible", V::Bool(true)),
            ("CurrentCheckpointName", V::Str("CHK_TEST")),
            ("OpenWorldReminderHistory", V::EmptyArray),
            ("GamePercent", V::F32(0.4453)),
            ("NewGamePlus", V::Bool(false)),
        ];
        let systems = vec![
            ("293463016", system("SaveFile", save_file)),
            (
                "13674975",
                system(
                    "HeroSystem",
                    vec![
                        ("SpiderAssaultEnergy", V::F32(1.5)),
                        ("DisplayLevel", V::U8(39)),
                    ],
                ),
            ),
            ("564532639", system("ObjectiveSystem", objectives)),
            (
                "1454753605",
                system(
                    "DifficultySystem",
                    vec![("Difficulty", V::Str("kSuperEasy"))],
                ),
            ),
            ("485125355", system("DevstatsSegmentSystem", segments)),
            (
                "1537534723",
                system(
                    "SpeedrunTimeKeeper",
                    vec![("SpeedrunTime", V::F64(66_344.2))],
                ),
            ),
            ("402541154", system("CollectibleSystemGame", collectibles)),
        ];
        dat1(9, vec![(b"", vec![vec![("Systems", V::Obj(systems))]])])
    }

    #[test]
    fn reads_a_remastered_manual_save() {
        let files = vec![
            SaveFile::from_bytes(
                REMASTERED_PATH,
                "slot0-s-manual-2.save",
                remastered_save(3, 0),
            ),
            SaveFile::from_bytes(REMASTERED_PATH, "slot0-s (2).save", remastered_save(3, 0)),
            SaveFile::from_bytes(REMASTERED_PATH, "-userprefs.save", remastered_save(3, 0)),
        ];
        let slots = read_remastered_slots(&files);
        assert_eq!(slots.len(), 1);
        let slot = &slots[0];
        assert_eq!(slot.id, "slot0-s-manual-2");
        assert_eq!(slot.kind, SlotKind::Manual);
        assert_eq!(slot.playthrough.as_deref(), Some("PLAYTHROUGH-1"));
        assert_eq!(
            slot.stat(StatKind::Completion),
            Some(&StatValue::Percent(47.7))
        );
        assert_eq!(
            slot.stat(StatKind::Playtime),
            Some(&StatValue::Seconds(30_538))
        );
        assert_eq!(
            slot.stat(StatKind::Chapter),
            Some(&cataloged_label(
                "marvels_spider_man_remastered.act.act_2",
                "Act 2"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Difficulty),
            Some(&cataloged_label(
                "marvels_spider_man_remastered.difficulty.spectacular",
                "Spectacular"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::NewGamePlus),
            Some(&StatValue::Integer(1))
        );
        assert_eq!(slot.files, vec!["slot0-s-manual-2.save".to_owned()]);
    }

    #[test]
    fn remastered_difficulty_uses_the_field_that_is_set() {
        let slots = read_remastered_slots(&[SaveFile::from_bytes(
            REMASTERED_PATH,
            "slot1-s.save",
            remastered_save(0, 2),
        )]);
        assert_eq!(slots[0].kind, SlotKind::Auto);
        assert_eq!(
            slots[0].stat(StatKind::Difficulty),
            Some(&cataloged_label(
                "marvels_spider_man_remastered.difficulty.amazing",
                "Amazing"
            ))
        );
        let slots = read_remastered_slots(&[SaveFile::from_bytes(
            REMASTERED_PATH,
            "slot1-s.save",
            remastered_save(0, 0),
        )]);
        assert_eq!(
            slots[0].stat(StatKind::Difficulty),
            Some(&cataloged_label(
                "marvels_spider_man_remastered.difficulty.friendly_neighborhood",
                "Friendly Neighborhood"
            ))
        );
    }

    #[test]
    fn reads_a_spider_man_2_autosave() {
        let files = vec![
            SaveFile::from_bytes(
                SPIDER_MAN_2_PATH,
                "slot1-autosave.save",
                spider_man_2_save(),
            ),
            SaveFile::from_bytes(
                SPIDER_MAN_2_PATH,
                "prefs-autosave.save",
                spider_man_2_save(),
            ),
            SaveFile::from_bytes(SPIDER_MAN_2_PATH, "1.jpg", b"\xff\xd8".to_vec()),
        ];
        let slots = read_spider_man_2_slots(&files);
        assert_eq!(slots.len(), 1);
        let slot = &slots[0];
        assert_eq!(slot.id, "slot1-autosave");
        assert_eq!(slot.kind, SlotKind::Auto);
        assert_eq!(slot.playthrough.as_deref(), Some("PLAYTHROUGH-2"));
        assert_eq!(slot.stat(StatKind::Level), Some(&StatValue::Integer(39)));
        assert_eq!(
            slot.stat(StatKind::Completion),
            Some(&StatValue::Percent(44.5))
        );
        assert_eq!(
            slot.stat(StatKind::Playtime),
            Some(&StatValue::Seconds(47_088))
        );
        assert_eq!(
            slot.stat(StatKind::Chapter),
            Some(&cataloged_label("marvels_spider_man_2.act.act_2", "Act 2"))
        );
        assert_eq!(
            slot.stat(StatKind::Difficulty),
            Some(&cataloged_label(
                "marvels_spider_man_2.difficulty.friendly_neighborhood",
                "Friendly Neighborhood"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::CharacterName),
            Some(&cataloged_label(
                "marvels_spider_man_2.hero.miles_morales",
                "Miles Morales"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Collectibles),
            Some(&StatValue::Progress {
                current: 5,
                total: 12
            })
        );
        assert_eq!(slot.stat(StatKind::NewGamePlus), None);
    }

    #[test]
    fn spider_man_2_systems_survive_a_broken_neighbour() {
        let mut bytes = spider_man_2_save();
        let hash = insomniac_crc32(b"SpiderAssaultEnergy").to_le_bytes();
        let entry = bytes.windows(4).position(|window| window == hash).unwrap();
        bytes[entry + 7] = 0x7e;
        let slots = read_spider_man_2_slots(&[SaveFile::from_bytes(
            SPIDER_MAN_2_PATH,
            "slot2-manual-0.save",
            bytes,
        )]);
        let slot = &slots[0];
        assert_eq!(slot.kind, SlotKind::Manual);
        assert_eq!(slot.stat(StatKind::Level), None);
        assert_eq!(
            slot.stat(StatKind::Completion),
            Some(&StatValue::Percent(44.5))
        );
        assert_eq!(
            slot.stat(StatKind::Difficulty),
            Some(&cataloged_label(
                "marvels_spider_man_2.difficulty.friendly_neighborhood",
                "Friendly Neighborhood"
            ))
        );
    }

    #[test]
    fn decodes_v8_and_v9_values() {
        for version in [8, 9] {
            let fields = vec![
                ("Visible", V::Bool(true)),
                ("State", V::Str("kNotStarted")),
                ("History", V::EmptyArray),
                ("Index", V::U32(5)),
                (
                    "Zone",
                    V::Obj(vec![
                        ("Group", V::Str("kCharacter2")),
                        ("Time", V::F64(94_701.6)),
                    ]),
                ),
                ("Tail", V::U8(3)),
            ];
            let bytes = dat1(version, vec![(b"", vec![fields])]);
            let dat1 = Dat1::parse(&bytes).unwrap();
            let objects = dat1.objects();
            assert_eq!(objects.len(), 1, "version {version}");
            let object = &objects[0];
            assert_eq!(object.bool("Visible"), Some(true));
            assert_eq!(object.str("State"), Some("kNotStarted"));
            assert_eq!(object.array("History").map(<[_]>::len), Some(0));
            assert_eq!(object.i64("Index"), Some(5));
            let zone = object.object("Zone").unwrap();
            assert_eq!(zone.str("Group"), Some("kCharacter2"));
            assert_eq!(zone.f64("Time"), Some(94_701.6));
            assert_eq!(object.i64("Tail"), Some(3));
        }
    }

    #[test]
    fn keeps_the_newest_copy_of_a_slot() {
        let mut older =
            SaveFile::from_bytes(REMASTERED_PATH, "slot0-s.save", remastered_save(2, 0));
        older.modified_at_ms = Some(1_000);
        let mut newer = SaveFile::from_bytes(REMASTERED_PATH, "slot0-s.save", b"1TAD".to_vec());
        newer.modified_at_ms = Some(2_000);
        let slots = read_remastered_slots(&[older, newer]);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].saved_at_ms, Some(2_000));
        assert!(slots[0].stats.is_empty());
    }

    #[test]
    fn garbage_and_truncated_files_give_slots_without_a_crash() {
        let save = spider_man_2_save();
        let files = vec![
            SaveFile::from_bytes(
                SPIDER_MAN_2_PATH,
                "slot1-autosave.save",
                b"not a save".to_vec(),
            ),
            SaveFile::from_bytes(
                SPIDER_MAN_2_PATH,
                "slot1-manual-0.save",
                save[..save.len() / 2].to_vec(),
            ),
        ];
        let slots = read_spider_man_2_slots(&files);
        assert_eq!(slots.len(), 2);
        assert!(slots.iter().all(|slot| slot.stats.is_empty()));
        for len in (0..save.len()).step_by(7) {
            let file = SaveFile::from_bytes(
                SPIDER_MAN_2_PATH,
                "slot1-autosave.save",
                save[..len].to_vec(),
            );
            assert_eq!(read_spider_man_2_slots(&[file]).len(), 1);
        }
        let remastered = remastered_save(2, 0);
        for len in (0..remastered.len()).step_by(5) {
            let file =
                SaveFile::from_bytes(REMASTERED_PATH, "slot0-s.save", remastered[..len].to_vec());
            assert_eq!(read_remastered_slots(&[file]).len(), 1);
        }
    }

    #[test]
    fn crc_matches_insomniac_name_hashes() {
        assert_eq!(insomniac_crc32(b""), 0xedb8_8320);
        assert_eq!(insomniac_crc32(b"SpiderBots"), 1_323_218_430);
    }

    #[test]
    fn slot_kinds() {
        assert_eq!(remastered_slot_kind("slot0-s"), Some(SlotKind::Auto));
        assert_eq!(
            remastered_slot_kind("slot3-s-manual-12"),
            Some(SlotKind::Manual)
        );
        assert_eq!(remastered_slot_kind("slot1-s (2)"), None);
        assert_eq!(remastered_slot_kind("-userprefs"), None);
        assert_eq!(remastered_slot_kind("slot-s"), None);
        assert_eq!(
            spider_man_2_slot_kind("slot1-autosave"),
            Some(SlotKind::Auto)
        );
        assert_eq!(
            spider_man_2_slot_kind("slot4-manual-0"),
            Some(SlotKind::Manual)
        );
        assert_eq!(spider_man_2_slot_kind("prefs-autosave"), None);
        assert_eq!(spider_man_2_slot_kind("slot1-manual-"), None);
    }

    #[test]
    fn completion_scales() {
        assert_eq!(completion_percent(0.4768), Some(47.7));
        assert_eq!(completion_percent(1.0), Some(100.0));
        assert_eq!(completion_percent(50.0), Some(50.0));
        assert_eq!(completion_percent(-1.0), None);
        assert_eq!(completion_percent(f64::NAN), None);
    }

    #[test]
    fn act_and_hero_names() {
        assert_eq!(lookup(&SPIDER_MAN_2_ACTS, "kAct3"), Some("Act 3"));
        assert_eq!(lookup(&SPIDER_MAN_2_ACTS, "kPostGP"), Some("Post-game"));
        assert_eq!(lookup(&SPIDER_MAN_2_ACTS, "kActX"), None);
        assert_eq!(story_act("GP_A3_FINALE"), Some("Act 3"));
        assert_eq!(story_act("GP_A4_X"), None);
        assert_eq!(story_act("GP_A0_X"), None);
        assert_eq!(story_act("GP_A10_X"), None);
        assert_eq!(story_act("OM_DEMONS_STORY_LI"), None);
        assert_eq!(remastered_difficulty_name(4), Some("Ultimate"));
        assert_eq!(remastered_difficulty_name(-1), None);
        assert_eq!(lookup(&HERO_CHARACTERS, "Spider-Man"), Some("Peter Parker"));
        assert_eq!(
            lookup(&CHARACTER_GROUPS, "kCharacter2"),
            Some("Miles Morales")
        );
    }
}
