//! Cyberpunk 2077: one folder per save (`ManualSave-3/`) holding `metadata.<n>.json`,
//! `screenshot.png` and `sav.dat`. The JSON has level, playtime and quests; money is
//! only in `sav.dat`, inside the LZ4-compressed node tree.

use std::collections::HashMap;

use serde_json::Value;

use crate::games::{group_by_dir, label, lookup, newest_modified_at, Parser};
use crate::model::{SaveSlot, SlotKind, Stat, StatKind, StatValue};
use crate::source::SaveFile;
use crate::util::{crc32, find, i32_le, lz4, png_thumbnail, strip_bom, u32_le, u64_le};

pub const PARSER: Parser = Parser {
    id: "cyberpunk-2077",
    version: 1,
    steam_app_ids: &["1091500"],
    read_slots,
    labels,
    read_profile: crate::games::no_profile,
    stat_names: &[
        (StatKind::Money, "Eddies"),
        (StatKind::Reputation, "Street Cred"),
        (StatKind::QuestsCompleted, "Main jobs done"),
        (StatKind::CharacterClass, "Lifepath"),
    ],
};

const LABEL_PREFIX: &str = "cyberpunk_2077";

const LIFE_PATHS: [(&str, &str); 4] = [
    ("StreetKid", "Street Kid"),
    ("Nomad", "Nomad"),
    ("Corporate", "Corpo"),
    ("Corpo", "Corpo"),
];

const DIFFICULTIES: [(&str, &str); 5] = [
    ("Story", "Story"),
    ("Easy", "Easy"),
    ("Normal", "Normal"),
    ("Hard", "Hard"),
    ("VeryHard", "Very Hard"),
];

fn labels() -> Vec<(&'static str, &'static str)> {
    let life_paths = LIFE_PATHS.iter().map(|&(_, text)| ("life_path", text));
    let difficulties = DIFFICULTIES.iter().map(|&(_, text)| ("difficulty", text));
    life_paths.chain(difficulties).collect()
}

fn read_slots(files: &[SaveFile]) -> Vec<SaveSlot> {
    group_by_dir(files)
        .into_iter()
        .filter_map(|((_, dir), slot_files)| read_slot(dir, &slot_files))
        .collect()
}

fn read_slot(dir: &str, files: &[&SaveFile]) -> Option<SaveSlot> {
    let folder = dir.rsplit('/').next().unwrap_or(dir);
    let kind = slot_kind(folder)?;
    let metadata_file = files
        .iter()
        .find(|file| is_metadata_file(file.file_name()))?;
    let metadata = read_metadata(metadata_file)?;

    let mut stats = Vec::new();
    if let Some(level) = metadata.get("level").and_then(Value::as_f64) {
        stats.push(Stat::new(StatKind::Level, StatValue::Integer(level as i64)));
    }
    if let Some(seconds) = metadata.get("playTime").and_then(Value::as_f64) {
        stats.push(Stat::new(
            StatKind::Playtime,
            StatValue::Seconds(seconds.max(0.0) as u64),
        ));
    }
    let money = files
        .iter()
        .find(|file| file.file_name() == "sav.dat")
        .and_then(|file| read_money(file));
    if let Some(money) = money {
        stats.push(Stat::new(StatKind::Money, StatValue::Integer(money)));
    }
    if let Some(finished) = metadata.get("finishedQuests").and_then(Value::as_str) {
        let main_quests = finished
            .split_whitespace()
            .filter(|quest| is_main_quest(quest))
            .count();
        stats.push(Stat::new(
            StatKind::QuestsCompleted,
            StatValue::Integer(main_quests as i64),
        ));
    }
    if let Some(street_cred) = metadata.get("streetCred").and_then(Value::as_f64) {
        stats.push(Stat::new(
            StatKind::Reputation,
            StatValue::Integer(street_cred as i64),
        ));
    }
    if let Some(life_path) = metadata
        .get("lifePath")
        .and_then(Value::as_str)
        .and_then(|code| lookup(&LIFE_PATHS, code))
    {
        stats.push(Stat::new(
            StatKind::CharacterClass,
            label(LABEL_PREFIX, "life_path", life_path),
        ));
    }
    if let Some(difficulty) = metadata
        .get("difficulty")
        .and_then(Value::as_str)
        .and_then(|code| lookup(&DIFFICULTIES, code))
    {
        stats.push(Stat::new(
            StatKind::Difficulty,
            label(LABEL_PREFIX, "difficulty", difficulty),
        ));
    }

    Some(SaveSlot {
        id: folder.to_owned(),
        kind,
        title: None,
        saved_at_ms: newest_modified_at(files),
        playthrough: metadata
            .get("playthroughID")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map(str::to_owned),
        stats,
        thumbnail: files
            .iter()
            .find(|file| file.file_name() == "screenshot.png")
            .and_then(|file| png_thumbnail(file)),
        files: files
            .iter()
            .map(|file| file.relative_path.clone())
            .collect(),
    })
}

fn slot_kind(folder: &str) -> Option<SlotKind> {
    let (prefix, number) = folder.rsplit_once('-')?;
    if number.is_empty() || !number.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    Some(match prefix {
        "ManualSave" => SlotKind::Manual,
        "AutoSave" => SlotKind::Auto,
        "QuickSave" => SlotKind::Quick,
        "PointOfNoReturnSave" => SlotKind::PointOfNoReturn,
        "EndGameSave" => SlotKind::EndGame,
        _ => return None,
    })
}

fn is_metadata_file(name: &str) -> bool {
    name.strip_prefix("metadata.")
        .and_then(|rest| rest.strip_suffix(".json"))
        .is_some_and(|version| {
            !version.is_empty() && version.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn read_metadata(file: &SaveFile) -> Option<serde_json::Map<String, Value>> {
    let bytes = file.read_prefix(1024 * 1024).ok()?;
    let mut root: Value = serde_json::from_slice(strip_bom(&bytes)).ok()?;
    match root.pointer_mut("/Data/metadata")?.take() {
        Value::Object(metadata) => Some(metadata),
        _ => None,
    }
}

fn is_main_quest(id: &str) -> bool {
    id.len() == 4 && id.starts_with('q') && id[1..].bytes().all(|byte| byte.is_ascii_digit())
}

const CHUNK_TABLE_MAGIC: &[u8] = b"FZLC";
const CHUNK_MAGIC: &[u8] = b"4ZLX";
const NODE_TABLE_MAGIC: &[u8] = b"EDON";
const MAX_CHUNKS: usize = 4096;
const MAX_NODES: usize = 200_000;
const PLAYER_INVENTORY_ID: u64 = 1;
const SIMPLE_ITEM_LEN: usize = 29;

struct Chunk {
    offset: usize,
    compressed_len: usize,
    decompressed_len: usize,
    decompressed_start: usize,
}

struct Node {
    name: String,
    next: i32,
    child: i32,
    offset: usize,
    size: usize,
}

struct SaveData<'a> {
    raw: &'a [u8],
    chunks: Vec<Chunk>,
    cache: HashMap<usize, Vec<u8>>,
}

impl SaveData<'_> {
    fn slice(&mut self, start: usize, len: usize) -> Option<Vec<u8>> {
        let end = start.checked_add(len)?;
        let mut out = Vec::with_capacity(len);
        let first = self
            .chunks
            .iter()
            .position(|chunk| start < chunk.decompressed_start + chunk.decompressed_len)?;
        for index in first..self.chunks.len() {
            let (chunk_start, chunk_len) = {
                let chunk = &self.chunks[index];
                (chunk.decompressed_start, chunk.decompressed_len)
            };
            if chunk_start >= end {
                break;
            }
            let data = self.chunk(index)?;
            let from = start.saturating_sub(chunk_start);
            let to = (end - chunk_start).min(chunk_len);
            out.extend_from_slice(data.get(from..to)?);
        }
        (out.len() == len).then_some(out)
    }

    fn chunk(&mut self, index: usize) -> Option<&Vec<u8>> {
        if !self.cache.contains_key(&index) {
            let chunk = &self.chunks[index];
            let body = self
                .raw
                .get(chunk.offset..chunk.offset.checked_add(chunk.compressed_len)?)?;
            if body.get(..4)? != CHUNK_MAGIC {
                return None;
            }
            let data = lz4::decompress_block(body.get(8..)?, chunk.decompressed_len)?;
            self.cache.insert(index, data);
        }
        self.cache.get(&index)
    }
}

fn read_money(file: &SaveFile) -> Option<i64> {
    let raw = file.read().ok()?;
    if raw.get(..4)? != b"VASC" {
        return None;
    }
    let table = find(&raw[..raw.len().min(256)], CHUNK_TABLE_MAGIC, 0)?;
    let chunk_count = u32_le(&raw, table + 4)? as usize;
    if chunk_count == 0 || chunk_count > MAX_CHUNKS {
        return None;
    }

    let mut chunks = Vec::with_capacity(chunk_count);
    let mut decompressed_start = 0;
    for index in 0..chunk_count {
        let entry = table + 8 + index * 12;
        let chunk = Chunk {
            offset: u32_le(&raw, entry)? as usize,
            compressed_len: u32_le(&raw, entry + 4)? as usize,
            decompressed_len: u32_le(&raw, entry + 8)? as usize,
            decompressed_start,
        };
        decompressed_start += chunk.decompressed_len;
        chunks.push(chunk);
    }
    let data_base = chunks[0].offset;
    let last = chunks.last()?;
    let nodes = read_nodes(&raw, last.offset + last.compressed_len, data_base)?;

    let mut data = SaveData {
        raw: &raw,
        chunks,
        cache: HashMap::new(),
    };
    let inventory = nodes.iter().find(|node| node.name == "inventory")?;
    let header = data.slice(inventory.offset, 20.min(inventory.size))?;
    let sub_inventory_id = u64_le(&header, 8)?;
    let item_count = u32_le(&header, 16)? as usize;
    if sub_inventory_id != PLAYER_INVENTORY_ID {
        return None;
    }

    let money_id = tweak_db_id("Items.money");
    let mut child = inventory.child;
    for _ in 0..item_count {
        let node = nodes.get(usize::try_from(child).ok()?)?;
        if node.name == "itemData" && node.size == SIMPLE_ITEM_LEN {
            let item = data.slice(node.offset, node.size)?;
            if u64_le(&item, 4)? == money_id {
                return Some(i64::from(u32_le(&item, SIMPLE_ITEM_LEN - 4)?));
            }
        }
        child = node.next;
    }
    None
}

fn read_nodes(raw: &[u8], search_from: usize, data_base: usize) -> Option<Vec<Node>> {
    let table = find(raw, NODE_TABLE_MAGIC, search_from)?;
    let mut cursor = table + 4;
    let count = usize::try_from(read_packed_int(raw, &mut cursor)?).ok()?;
    if count > MAX_NODES {
        return None;
    }
    let mut nodes = Vec::with_capacity(count);
    for _ in 0..count {
        let name_len = read_packed_int(raw, &mut cursor)?.unsigned_abs() as usize;
        let name = raw.get(cursor..cursor.checked_add(name_len)?)?;
        cursor += name_len;
        let offset = usize::try_from(i32_le(raw, cursor + 8)?).ok()?;
        nodes.push(Node {
            name: String::from_utf8_lossy(name).into_owned(),
            next: i32_le(raw, cursor)?,
            child: i32_le(raw, cursor + 4)?,
            offset: offset.checked_sub(data_base)?,
            size: usize::try_from(i32_le(raw, cursor + 12)?).ok()?,
        });
        cursor += 16;
    }
    Some(nodes)
}

/// REDengine's packed int: the first byte holds the sign (0x80), a continue bit (0x40) and 6 value bits.
fn read_packed_int(raw: &[u8], cursor: &mut usize) -> Option<i64> {
    let first = *raw.get(*cursor)?;
    *cursor += 1;
    let mut value = i64::from(first & 0x3f);
    let mut shift = 6;
    let mut more = first & 0x40 != 0;
    while more {
        if shift > 34 {
            return None;
        }
        let byte = *raw.get(*cursor)?;
        *cursor += 1;
        value |= i64::from(byte & 0x7f) << shift;
        shift += 7;
        more = byte & 0x80 != 0;
    }
    Some(if first & 0x80 != 0 { -value } else { value })
}

fn tweak_db_id(path: &str) -> u64 {
    u64::from(crc32(path.as_bytes())) | (path.len() as u64) << 32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::cataloged_label;
    use crate::source::SaveFile;

    const RAW_PATH: &str = "<home>/Saved Games/CD Projekt Red/Cyberpunk 2077";

    fn metadata_json() -> String {
        serde_json::json!({
            "Data": { "metadata": {
                "name": "ManualSave-2",
                "level": 21.0,
                "streetCred": 33.0,
                "playTime": 45296.7,
                "lifePath": "Nomad",
                "difficulty": "VeryHard",
                "finishedQuests": "q000 q001 mq012 sts_wat_01 q003 q101",
                "playthroughID": "abc123",
            }}
        })
        .to_string()
    }

    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        png.extend_from_slice(&width.to_be_bytes());
        png.extend_from_slice(&height.to_be_bytes());
        png.extend_from_slice(&[8, 6, 0, 0, 0]);
        png
    }

    fn packed_len(len: usize) -> u8 {
        assert!(len < 64);
        0x80 | len as u8
    }

    /// Builds a sav.dat with one stored LZ4 chunk: an inventory node (player sub-inventory, 2 items)
    /// followed by two itemData children, the second one holding `money` eddies.
    fn sav_dat(money: u32) -> Vec<u8> {
        let mut payload = Vec::new();
        payload.extend_from_slice(&36u32.to_le_bytes());
        payload.extend_from_slice(&1u32.to_le_bytes());
        payload.extend_from_slice(&PLAYER_INVENTORY_ID.to_le_bytes());
        payload.extend_from_slice(&2u32.to_le_bytes());
        let mut item = |id: u64, quantity: u32| {
            let mut bytes = vec![0u8; SIMPLE_ITEM_LEN];
            bytes[4..12].copy_from_slice(&id.to_le_bytes());
            bytes[SIMPLE_ITEM_LEN - 4..].copy_from_slice(&quantity.to_le_bytes());
            payload.extend_from_slice(&bytes);
        };
        item(tweak_db_id("Items.Grenade"), 3);
        item(tweak_db_id("Items.money"), money);

        let data_base = 64usize;
        let mut chunk = CHUNK_MAGIC.to_vec();
        chunk.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        chunk.push(0xf0);
        let mut rest = payload.len() - 15;
        while rest >= 255 {
            chunk.push(255);
            rest -= 255;
        }
        chunk.push(rest as u8);
        chunk.extend_from_slice(&payload);

        let mut raw = b"VASC".to_vec();
        raw.extend_from_slice(&[0; 8]);
        raw.extend_from_slice(CHUNK_TABLE_MAGIC);
        raw.extend_from_slice(&1u32.to_le_bytes());
        raw.extend_from_slice(&(data_base as u32).to_le_bytes());
        raw.extend_from_slice(&(chunk.len() as u32).to_le_bytes());
        raw.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        raw.resize(data_base, 0);
        raw.extend_from_slice(&chunk);

        raw.extend_from_slice(NODE_TABLE_MAGIC);
        raw.push(3);
        let mut node = |name: &str, next: i32, child: i32, offset: usize, size: usize| {
            raw.push(packed_len(name.len()));
            raw.extend_from_slice(name.as_bytes());
            for value in [next, child, (data_base + offset) as i32, size as i32] {
                raw.extend_from_slice(&value.to_le_bytes());
            }
        };
        node("inventory", -1, 1, 0, 20);
        node("itemData", 2, -1, 20, SIMPLE_ITEM_LEN);
        node("itemData", -1, -1, 20 + SIMPLE_ITEM_LEN, SIMPLE_ITEM_LEN);
        raw
    }

    fn slot_files(folder: &str, money: u32) -> Vec<SaveFile> {
        vec![
            SaveFile::from_bytes(
                RAW_PATH,
                &format!("{folder}/metadata.9.json"),
                metadata_json().into_bytes(),
            ),
            SaveFile::from_bytes(
                RAW_PATH,
                &format!("{folder}/screenshot.png"),
                png_header(320, 180),
            ),
            SaveFile::from_bytes(RAW_PATH, &format!("{folder}/sav.dat"), sav_dat(money)),
        ]
    }

    #[test]
    fn reads_a_manual_save() {
        let mut files = slot_files("ManualSave-2", 48_250);
        files.push(SaveFile::from_bytes(RAW_PATH, "user.gls", b"x".to_vec()));
        let slots = read_slots(&files);
        assert_eq!(slots.len(), 1);

        let slot = &slots[0];
        assert_eq!(slot.id, "ManualSave-2");
        assert_eq!(slot.kind, SlotKind::Manual);
        assert_eq!(slot.playthrough.as_deref(), Some("abc123"));
        assert_eq!(slot.stat(StatKind::Level), Some(&StatValue::Integer(21)));
        assert_eq!(
            slot.stat(StatKind::Playtime),
            Some(&StatValue::Seconds(45296))
        );
        assert_eq!(
            slot.stat(StatKind::Money),
            Some(&StatValue::Integer(48_250))
        );
        assert_eq!(
            slot.stat(StatKind::QuestsCompleted),
            Some(&StatValue::Integer(4))
        );
        assert_eq!(
            slot.stat(StatKind::Reputation),
            Some(&StatValue::Integer(33))
        );
        assert_eq!(
            slot.stat(StatKind::CharacterClass),
            Some(&cataloged_label("cyberpunk_2077.life_path.nomad", "Nomad"))
        );
        assert_eq!(
            slot.stat(StatKind::Difficulty),
            Some(&cataloged_label(
                "cyberpunk_2077.difficulty.very_hard",
                "Very Hard"
            ))
        );
        let thumbnail = slot.thumbnail.as_ref().unwrap();
        assert_eq!(thumbnail.file, "ManualSave-2/screenshot.png");
        assert_eq!((thumbnail.width, thumbnail.height), (Some(320), Some(180)));
    }

    #[test]
    fn keeps_metadata_stats_when_sav_dat_is_unreadable() {
        let mut files = slot_files("AutoSave-0", 1);
        files[2] = SaveFile::from_bytes(RAW_PATH, "AutoSave-0/sav.dat", b"VASC garbage".to_vec());
        let slots = read_slots(&files);
        assert_eq!(slots[0].kind, SlotKind::Auto);
        assert_eq!(slots[0].stat(StatKind::Money), None);
        assert_eq!(
            slots[0].stat(StatKind::Level),
            Some(&StatValue::Integer(21))
        );
    }

    #[test]
    fn ignores_folders_that_are_not_save_slots() {
        let files = vec![SaveFile::from_bytes(
            RAW_PATH,
            "cache/metadata.9.json",
            metadata_json().into_bytes(),
        )];
        assert!(read_slots(&files).is_empty());
    }

    #[test]
    fn slot_kinds() {
        assert_eq!(
            slot_kind("PointOfNoReturnSave-0"),
            Some(SlotKind::PointOfNoReturn)
        );
        assert_eq!(slot_kind("EndGameSave-1"), Some(SlotKind::EndGame));
        assert_eq!(slot_kind("QuickSave-12"), Some(SlotKind::Quick));
        assert_eq!(slot_kind("ManualSave-"), None);
        assert_eq!(slot_kind("Screenshots-1"), None);
    }
}
