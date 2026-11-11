//! 007 First Light (Glacier engine): one folder per save (`kntslotsavefile-0/`,
//! `kntprofilesavefile/`), each with `index.save` (an `SSaveGameHeader`) and `data.save`
//! (a zlib stream holding a `ZDynamicObject` tree). Both files are XORed with the 8 bytes
//! of the owner's SteamID64; the key is recovered from the known type name at the start
//! of `index.save`, so no account id is needed.

use crate::games::{group_by_dir, label, Parser};
use crate::model::{SaveSlot, SlotKind, Stat, StatKind, StatValue};
use crate::source::SaveFile;

pub const PARSER: Parser = Parser {
    id: "007-first-light",
    version: 1,
    steam_app_ids: &["3768760"],
    read_slots,
    labels,
    read_profile: crate::games::no_profile,
    stat_names: &[(StatKind::Chapter, "Mission")],
};

const LABEL_PREFIX: &str = "007_first_light";
const DIFFICULTIES: [&str; 3] = ["Novice", "Intended", "Purist"];

const INDEX_TYPE_NAME: &[u8] = b"SSaveGameHeader";
const INDEX_TYPE_NAME_AT: usize = 9;
const INDEX_MAX_BYTES: u64 = 64 * 1024;
const DATA_MAX_BYTES: u64 = 4 * 1024 * 1024;
const DATA_MAX_INFLATED: usize = 16 * 1024 * 1024;
const MAX_DEPTH: usize = 64;

const FIELD_VERSION: u32 = 0x4d8e_58c1;
const FIELD_DATA_SIZE: u32 = 0x9696_6a79;
const FIELD_TIMESTAMP: u32 = 0x2c4b_0382;
const FIELD_METADATA: u32 = 0x1650_f97c;
const FIELD_SAVE_TYPE: u32 = 0x8794_52db;

fn labels() -> Vec<(&'static str, &'static str)> {
    DIFFICULTIES
        .iter()
        .map(|&text| ("difficulty", text))
        .collect()
}

fn read_slots(files: &[SaveFile]) -> Vec<SaveSlot> {
    let mut slots: Vec<SaveSlot> = Vec::new();
    for ((_, dir), slot_files) in group_by_dir(files) {
        let Some(slot) = read_slot(dir, &slot_files) else {
            continue;
        };
        match slots.iter_mut().find(|known| known.id == slot.id) {
            Some(known) if known.saved_at_ms < slot.saved_at_ms => *known = slot,
            Some(_) => {}
            None => slots.push(slot),
        }
    }
    slots
}

enum Folder {
    Slot(u32),
    Profile,
}

fn folder_kind(folder: &str) -> Option<Folder> {
    let folder = folder.to_ascii_lowercase();
    if folder == "kntprofilesavefile" {
        return Some(Folder::Profile);
    }
    let number = folder.strip_prefix("kntslotsavefile-")?;
    if number.is_empty() || !number.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    number.parse().ok().map(Folder::Slot)
}

fn read_slot(dir: &str, files: &[&SaveFile]) -> Option<SaveSlot> {
    let folder_name = dir.rsplit('/').next().unwrap_or(dir);
    let folder = folder_kind(folder_name)?;
    let index_file = files
        .iter()
        .find(|file| file.file_name().eq_ignore_ascii_case("index.save"))?;
    let data_file = files
        .iter()
        .find(|file| file.file_name().eq_ignore_ascii_case("data.save"));

    let index_raw = index_file.read_prefix(INDEX_MAX_BYTES).ok()?;
    let key = derive_key(&index_raw)?;
    let header = parse_index(&xor(&index_raw, &key))?;
    let data = data_file.and_then(|file| read_data(file, &key, header.data_size));

    let (id, kind) = match folder {
        Folder::Slot(number) => (
            format!("slot{number}"),
            header.kind.unwrap_or(SlotKind::Unknown),
        ),
        Folder::Profile => ("profile".to_owned(), SlotKind::Profile),
    };
    let mut stats = Vec::new();
    if let Some(data) = &data {
        match folder {
            Folder::Slot(_) => slot_stats(data, &mut stats),
            Folder::Profile => profile_stats(data, &mut stats),
        }
    }
    if let Some(version) = header.version.and_then(version_text) {
        stats.push(Stat::new(StatKind::GameVersion, StatValue::Text(version)));
    }

    let mut slot_files = vec![index_file.relative_path.clone()];
    if let Some(file) = data_file {
        slot_files.push(file.relative_path.clone());
    }
    Some(SaveSlot {
        id,
        kind,
        title: None,
        saved_at_ms: header
            .timestamp
            .or_else(|| files.iter().filter_map(|file| file.modified_at_ms).max()),
        playthrough: None,
        stats,
        thumbnail: None,
        files: slot_files,
    })
}

fn slot_stats(root: &Value, stats: &mut Vec<Stat>) {
    let checkpoint = root.get("Checkpoint");
    let profile = root.get("ProfileInSlot");
    if let Some(seconds) = profile.and_then(|profile| profile.number("PlayTime")) {
        stats.push(Stat::new(
            StatKind::Playtime,
            StatValue::Seconds(seconds.max(0.0) as u64),
        ));
    }
    let checkpoint_name = checkpoint.and_then(|checkpoint| checkpoint.text("Checkpoint"));
    let unlocked = profile.and_then(|profile| profile.get("UnlockedCheckpoints"));
    if let Some(mission) = checkpoint_name
        .zip(unlocked)
        .and_then(|(name, unlocked)| mission_number(name, unlocked))
    {
        stats.push(Stat::new(
            StatKind::Chapter,
            StatValue::Integer(i64::from(mission)),
        ));
    }
    if let Some(objective) = checkpoint_name.and_then(checkpoint_label) {
        stats.push(Stat::new(StatKind::Objective, StatValue::Text(objective)));
    }
    if let Some(difficulty) = checkpoint
        .and_then(|checkpoint| checkpoint.number("Difficulty"))
        .and_then(difficulty_name)
    {
        stats.push(Stat::new(
            StatKind::Difficulty,
            label(LABEL_PREFIX, "difficulty", difficulty),
        ));
    }
    if let Some(Value::Array(collectibles)) =
        profile.and_then(|profile| profile.get("UnlockedCollectibles"))
    {
        stats.push(Stat::new(
            StatKind::Collectibles,
            StatValue::Integer(collectibles.len() as i64),
        ));
    }
}

fn profile_stats(root: &Value, stats: &mut Vec<Stat>) {
    if let Some(seconds) = root.number("PlayTime") {
        stats.push(Stat::new(
            StatKind::Playtime,
            StatValue::Seconds(seconds.max(0.0) as u64),
        ));
    }
    if let Some(Value::Array(unlocked)) = root.get("UnlockedCheckpoints") {
        let missions = mission_order(unlocked).len();
        if missions > 0 {
            stats.push(Stat::new(
                StatKind::Chapter,
                StatValue::Integer(missions as i64),
            ));
        }
    }
    if let Some(Value::Array(collectibles)) = root.get("UnlockedCollectibles") {
        stats.push(Stat::new(
            StatKind::Collectibles,
            StatValue::Integer(collectibles.len() as i64),
        ));
    }
}

/// Checkpoints are named `<MissionCodename>_<Checkpoint>` and unlock in story order,
/// so the codename's rank among unlocked codenames is the mission number.
fn mission_order(unlocked: &[Value]) -> Vec<&str> {
    let mut order: Vec<&str> = Vec::new();
    for value in unlocked {
        if let Value::Text(name) = value {
            let codename = name.split('_').next().unwrap_or(name);
            if !codename.is_empty() && !order.contains(&codename) {
                order.push(codename);
            }
        }
    }
    order
}

fn mission_number(checkpoint: &str, unlocked: &Value) -> Option<u32> {
    let Value::Array(unlocked) = unlocked else {
        return None;
    };
    let codename = checkpoint
        .split('_')
        .next()
        .filter(|codename| !codename.is_empty())?;
    let order = mission_order(unlocked);
    if order.is_empty() {
        return None;
    }
    // The slot copies the unlock list just before its own checkpoint is added, so a
    // codename missing from it is the mission that was just entered.
    let position = order
        .iter()
        .position(|name| *name == codename)
        .unwrap_or(order.len());
    u32::try_from(position + 1).ok()
}

fn checkpoint_label(checkpoint: &str) -> Option<String> {
    let (_, rest) = checkpoint.split_once('_')?;
    let mut label = String::new();
    for word in rest.split('_').filter(|word| !word.is_empty()) {
        if !label.is_empty() {
            label.push(' ');
        }
        let mut previous: Option<char> = None;
        for character in word.chars() {
            if previous.is_some_and(|previous| previous.is_ascii_lowercase())
                && character.is_ascii_uppercase()
            {
                label.push(' ');
            }
            label.push(character);
            previous = Some(character);
        }
    }
    (!label.is_empty()).then_some(label)
}

fn difficulty_name(value: f64) -> Option<&'static str> {
    let index = usize::try_from(value as i64).ok()?;
    DIFFICULTIES.get(index).copied()
}

/// The header stores the build as `major * 1_000_000 + minor * 1_000 + patch`.
fn version_text(version: u32) -> Option<String> {
    if version < 1_000_000 {
        return None;
    }
    Some(format!(
        "{}.{}.{}",
        version / 1_000_000,
        version / 1_000 % 1_000,
        version % 1_000
    ))
}

fn derive_key(index: &[u8]) -> Option<[u8; 8]> {
    let mut key: [Option<u8>; 8] = [None; 8];
    for (offset, &plain) in INDEX_TYPE_NAME.iter().enumerate() {
        let at = INDEX_TYPE_NAME_AT + offset;
        let byte = index.get(at)? ^ plain;
        match key[at % 8] {
            Some(known) if known != byte => return None,
            _ => key[at % 8] = Some(byte),
        }
    }
    let key = key.map(|byte| byte.unwrap_or(0));
    let name_len = (INDEX_TYPE_NAME.len() as u32 | 0x8000_0000).to_le_bytes();
    let decoded_len: Vec<u8> = (5..9)
        .map(|at| index.get(at).map_or(0, |byte| byte ^ key[at % 8]))
        .collect();
    (decoded_len == name_len).then_some(key)
}

fn xor(bytes: &[u8], key: &[u8; 8]) -> Vec<u8> {
    bytes
        .iter()
        .enumerate()
        .map(|(at, byte)| byte ^ key[at % 8])
        .collect()
}

struct Header {
    version: Option<u32>,
    data_size: Option<usize>,
    timestamp: Option<i64>,
    kind: Option<SlotKind>,
}

fn parse_index(bytes: &[u8]) -> Option<Header> {
    let Value::Struct(fields) = parse_document(bytes)? else {
        return None;
    };
    let field = |hash: u32| {
        fields
            .iter()
            .find(|(field, _)| *field == hash)
            .map(|(_, value)| value)
    };
    let number = |hash: u32| match field(hash) {
        Some(Value::Number(number)) => Some(*number),
        _ => None,
    };
    let save_type = match field(FIELD_METADATA) {
        Some(Value::Struct(metadata)) => metadata
            .iter()
            .find(|(hash, _)| *hash == FIELD_SAVE_TYPE)
            .and_then(|(_, value)| match value {
                Value::Text(text) => Some(text.as_str()),
                _ => None,
            }),
        _ => None,
    };
    Some(Header {
        version: number(FIELD_VERSION)
            .filter(|value| *value >= 0.0 && *value <= f64::from(u32::MAX))
            .map(|value| value as u32),
        data_size: number(FIELD_DATA_SIZE)
            .filter(|value| *value > 0.0)
            .map(|value| value as usize),
        timestamp: number(FIELD_TIMESTAMP)
            .filter(|seconds| (1_500_000_000.0..4_000_000_000.0).contains(seconds))
            .map(|seconds| seconds as i64 * 1000),
        kind: save_type.map(save_kind),
    })
}

fn save_kind(save_type: &str) -> SlotKind {
    let name = save_type
        .strip_prefix("ESaveType_")
        .unwrap_or(save_type)
        .to_ascii_lowercase();
    match name.as_str() {
        "autosave" => SlotKind::Auto,
        "quicksave" => SlotKind::Quick,
        "manualsave" | "manual" | "save" => SlotKind::Manual,
        "localprofile" | "profile" => SlotKind::Profile,
        _ => SlotKind::Unknown,
    }
}

fn read_data(file: &SaveFile, key: &[u8; 8], size: Option<usize>) -> Option<Value> {
    let raw = file.read_prefix(DATA_MAX_BYTES).ok()?;
    let limit = size.unwrap_or(DATA_MAX_INFLATED).min(DATA_MAX_INFLATED);
    let inflated =
        miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(&xor(&raw, key), limit).ok()?;
    parse_document(&inflated)
}

#[derive(Debug, Clone, PartialEq)]
enum Value {
    Object(Vec<(String, Value)>),
    Array(Vec<Value>),
    Struct(Vec<(u32, Value)>),
    Text(String),
    Number(f64),
    Bool(bool),
}

impl Value {
    fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(entries) => entries
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value),
            _ => None,
        }
    }

    fn number(&self, key: &str) -> Option<f64> {
        match self.get(key)? {
            Value::Number(number) => Some(*number),
            _ => None,
        }
    }

    fn text(&self, key: &str) -> Option<&str> {
        match self.get(key)? {
            Value::Text(text) => Some(text),
            _ => None,
        }
    }
}

#[derive(Clone, Copy)]
enum Primitive {
    Variant,
    Text,
    Bool,
    F64,
    F32,
    I64,
    U64,
    I32,
    U32,
    I16,
    U16,
    I8,
    U8,
    Unknown,
}

impl Primitive {
    fn from_name(name: &str) -> Self {
        match name {
            "ZVariant" => Primitive::Variant,
            "ZString" => Primitive::Text,
            "bool" => Primitive::Bool,
            "float64" => Primitive::F64,
            "float32" => Primitive::F32,
            "int64" => Primitive::I64,
            "uint64" => Primitive::U64,
            "int32" => Primitive::I32,
            "uint32" => Primitive::U32,
            "int16" => Primitive::I16,
            "uint16" => Primitive::U16,
            "int8" => Primitive::I8,
            "uint8" => Primitive::U8,
            _ if name.starts_with('E') => Primitive::Text,
            _ => Primitive::Unknown,
        }
    }
}

#[derive(Clone)]
enum Shape {
    Struct(Vec<(u32, usize)>),
    Dynamic(usize),
    Pair(usize, usize),
    Array(usize),
    Primitive(Primitive),
}

/// Glacier's tagged binary serializer: a type is defined inline the first time it is used
/// (kind 1 struct, 2 array, 3 primitive) and referenced by index after (kind 0); a string
/// with the high length bit set is new, otherwise the length is an index into earlier strings.
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
    strings: Vec<String>,
    types: Vec<Shape>,
}

fn parse_document(bytes: &[u8]) -> Option<Value> {
    let mut reader = Reader {
        bytes,
        at: 4,
        strings: Vec::new(),
        types: Vec::new(),
    };
    let root = reader.type_ref(0)?;
    reader.value(root, 0)
}

impl Reader<'_> {
    fn take(&mut self, len: usize) -> Option<&[u8]> {
        let end = self.at.checked_add(len)?;
        let slice = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(slice)
    }

    fn array<const N: usize>(&mut self) -> Option<[u8; N]> {
        self.take(N)?.try_into().ok()
    }

    fn u32(&mut self) -> Option<u32> {
        self.array().map(u32::from_le_bytes)
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.at)
    }

    fn string(&mut self) -> Option<String> {
        let header = self.u32()?;
        if header & 0x8000_0000 == 0 {
            return self.strings.get(header as usize).cloned();
        }
        let text =
            String::from_utf8_lossy(self.take((header & 0x7fff_ffff) as usize)?).into_owned();
        self.strings.push(text.clone());
        Some(text)
    }

    fn type_ref(&mut self, depth: usize) -> Option<usize> {
        if depth > MAX_DEPTH {
            return None;
        }
        let [kind] = self.array()?;
        if kind == 0 {
            let index = self.u32()? as usize;
            return (index < self.types.len()).then_some(index);
        }
        let name = self.string()?;
        let index = self.types.len();
        self.types.push(Shape::Primitive(Primitive::Unknown));
        let shape = match kind {
            1 => {
                self.u32()?;
                let count = self.u32()? as usize;
                if count > self.remaining() {
                    return None;
                }
                let mut fields = Vec::with_capacity(count);
                for _ in 0..count {
                    let hash = self.u32()?;
                    fields.push((hash, self.type_ref(depth + 1)?));
                }
                match (name.as_str(), fields.as_slice()) {
                    ("ZDynamicObject", [(_, value)]) => Shape::Dynamic(*value),
                    ("SDynamicObjectKeyValuePair", [(_, key), (_, value)]) => {
                        Shape::Pair(*key, *value)
                    }
                    _ => Shape::Struct(fields),
                }
            }
            2 => Shape::Array(self.type_ref(depth + 1)?),
            3 => Shape::Primitive(Primitive::from_name(&name)),
            _ => return None,
        };
        self.types[index] = shape;
        Some(index)
    }

    fn value(&mut self, type_index: usize, depth: usize) -> Option<Value> {
        if depth > MAX_DEPTH {
            return None;
        }
        match self.types.get(type_index)?.clone() {
            Shape::Dynamic(inner) => self.value(inner, depth + 1),
            Shape::Struct(fields) => {
                let mut values = Vec::with_capacity(fields.len());
                for (hash, field_type) in fields {
                    values.push((hash, self.value(field_type, depth + 1)?));
                }
                Some(Value::Struct(values))
            }
            Shape::Pair(key, value) => Some(Value::Object(vec![self.pair(key, value, depth)?])),
            Shape::Array(element) => {
                let count = self.u32()? as usize;
                if count > self.remaining() {
                    return None;
                }
                if let Some(Shape::Pair(key, value)) = self.types.get(element).cloned() {
                    let mut entries = Vec::with_capacity(count);
                    for _ in 0..count {
                        entries.push(self.pair(key, value, depth)?);
                    }
                    return Some(Value::Object(entries));
                }
                let mut items = Vec::with_capacity(count);
                for _ in 0..count {
                    items.push(self.value(element, depth + 1)?);
                }
                Some(Value::Array(items))
            }
            Shape::Primitive(primitive) => self.primitive(primitive, depth),
        }
    }

    fn pair(&mut self, key: usize, value: usize, depth: usize) -> Option<(String, Value)> {
        let Value::Text(key) = self.value(key, depth + 1)? else {
            return None;
        };
        Some((key, self.value(value, depth + 1)?))
    }

    fn primitive(&mut self, primitive: Primitive, depth: usize) -> Option<Value> {
        let number = match primitive {
            Primitive::Variant => {
                let inner = self.type_ref(depth + 1)?;
                return self.value(inner, depth + 1);
            }
            Primitive::Text => return self.string().map(Value::Text),
            Primitive::Bool => return self.array::<1>().map(|[byte]| Value::Bool(byte != 0)),
            Primitive::Unknown => return None,
            Primitive::F64 => f64::from_le_bytes(self.array()?),
            Primitive::F32 => f64::from(f32::from_le_bytes(self.array()?)),
            Primitive::I64 => i64::from_le_bytes(self.array()?) as f64,
            Primitive::U64 => u64::from_le_bytes(self.array()?) as f64,
            Primitive::I32 => f64::from(i32::from_le_bytes(self.array()?)),
            Primitive::U32 => f64::from(u32::from_le_bytes(self.array()?)),
            Primitive::I16 => f64::from(i16::from_le_bytes(self.array()?)),
            Primitive::U16 => f64::from(u16::from_le_bytes(self.array()?)),
            Primitive::I8 => f64::from(i8::from_le_bytes(self.array()?)),
            Primitive::U8 => f64::from(u8::from_le_bytes(self.array()?)),
        };
        Some(Value::Number(number))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::cataloged_label;
    use crate::source::SaveFile;

    const RAW_PATH: &str = "<winPublic>/Documents/Steam/RUNE/3768760";
    const KEY: [u8; 8] = [0x5a, 0x13, 0xc4, 0x07, 0x01, 0x00, 0x10, 0x01];

    #[derive(Default)]
    struct Writer {
        bytes: Vec<u8>,
        strings: Vec<String>,
        types: Vec<String>,
    }

    impl Writer {
        fn new() -> Self {
            let mut writer = Writer::default();
            writer.bytes.extend_from_slice(&3u32.to_le_bytes());
            writer
        }

        fn u32(&mut self, value: u32) {
            self.bytes.extend_from_slice(&value.to_le_bytes());
        }

        fn string(&mut self, text: &str) {
            if let Some(index) = self.strings.iter().position(|known| known == text) {
                self.u32(index as u32);
            } else {
                self.u32(text.len() as u32 | 0x8000_0000);
                self.bytes.extend_from_slice(text.as_bytes());
                self.strings.push(text.to_owned());
            }
        }

        /// Returns true when the type was new, so the caller writes its body.
        fn type_ref(&mut self, kind: u8, name: &str) -> bool {
            if let Some(index) = self.types.iter().position(|known| known == name) {
                self.bytes.push(0);
                self.u32(index as u32);
                false
            } else {
                self.bytes.push(kind);
                self.string(name);
                self.types.push(name.to_owned());
                true
            }
        }

        fn object_type(&mut self) {
            if self.type_ref(2, "TArray<SDynamicObjectKeyValuePair>")
                && self.type_ref(1, "SDynamicObjectKeyValuePair")
            {
                self.u32(0);
                self.u32(2);
                self.u32(0x1552_e435);
                self.type_ref(3, "ZString");
                self.u32(0x1d77_5834);
                self.type_ref(0, "ZDynamicObject");
            }
        }

        fn root(&mut self) {
            self.type_ref(1, "ZDynamicObject");
            self.u32(0);
            self.u32(1);
            self.u32(0x5180_e750);
            self.type_ref(3, "ZVariant");
        }

        fn object(&mut self, entries: &[(&str, Field)]) {
            self.object_type();
            self.u32(entries.len() as u32);
            for (key, field) in entries {
                self.string(key);
                self.field(field);
            }
        }

        fn field(&mut self, field: &Field) {
            match field {
                Field::Number(value) => {
                    self.type_ref(3, "float64");
                    self.bytes.extend_from_slice(&value.to_le_bytes());
                }
                Field::Text(text) => {
                    self.type_ref(3, "ZString");
                    self.string(text);
                }
                Field::Object(entries) => self.object(entries),
                Field::List(items) => {
                    if self.type_ref(2, "TArray<ZDynamicObject>") {
                        self.type_ref(0, "ZDynamicObject");
                    }
                    self.u32(items.len() as u32);
                    for item in items {
                        self.field(item);
                    }
                }
            }
        }
    }

    enum Field {
        Number(f64),
        Text(String),
        Object(Vec<(&'static str, Field)>),
        List(Vec<Field>),
    }

    fn text(value: &str) -> Field {
        Field::Text(value.to_owned())
    }

    fn texts(values: &[&str]) -> Field {
        Field::List(values.iter().map(|value| text(value)).collect())
    }

    fn index_save(version: u32, data_size: u32, timestamp: i64, save_type: &str) -> Vec<u8> {
        let mut writer = Writer::new();
        writer.type_ref(1, "SSaveGameHeader");
        writer.u32(0);
        writer.u32(4);
        writer.u32(FIELD_VERSION);
        writer.type_ref(3, "uint32");
        writer.u32(FIELD_DATA_SIZE);
        writer.type_ref(0, "uint32");
        writer.u32(FIELD_TIMESTAMP);
        writer.type_ref(3, "int64");
        writer.u32(FIELD_METADATA);
        writer.type_ref(1, "SSaveGameMetaData");
        writer.u32(0);
        writer.u32(2);
        writer.u32(0x67c1_c70f);
        writer.type_ref(3, "ZString");
        writer.u32(FIELD_SAVE_TYPE);
        writer.type_ref(3, "ESaveType");
        writer.u32(version);
        writer.u32(data_size);
        writer.bytes.extend_from_slice(&timestamp.to_le_bytes());
        writer.string("UI_SAVETYPE_AUTOSAVE");
        writer.string(save_type);
        xor(&writer.bytes, &KEY)
    }

    fn data_save(root: Vec<(&'static str, Field)>) -> (Vec<u8>, u32) {
        let mut writer = Writer::new();
        writer.root();
        writer.object(&root);
        let compressed = miniz_oxide::deflate::compress_to_vec_zlib(&writer.bytes, 6);
        (xor(&compressed, &KEY), writer.bytes.len() as u32)
    }

    fn slot_data() -> Vec<(&'static str, Field)> {
        vec![
            (
                "Checkpoint",
                Field::Object(vec![
                    ("Version", text("1.0")),
                    ("Timestamp", Field::Number(1_700_000_000.0)),
                    ("Difficulty", Field::Number(2.0)),
                    ("Checkpoint", text("Rose_Chateau_Staff_Entrance")),
                ]),
            ),
            (
                "ProfileInSlot",
                Field::Object(vec![
                    ("PlayTime", Field::Number(39_563.0)),
                    (
                        "UnlockedCheckpoints",
                        texts(&[
                            "Clover_Intro",
                            "Clover_Shoreline",
                            "Lotus_Start",
                            "Rose_Arrival",
                            "Rose_Chateau_Staff_Entrance",
                        ]),
                    ),
                    ("UnlockedCollectibles", texts(&["a", "b", "c"])),
                ]),
            ),
        ]
    }

    fn folder_files(
        folder: &str,
        data: Vec<(&'static str, Field)>,
        save_type: &str,
    ) -> Vec<SaveFile> {
        let (data, size) = data_save(data);
        vec![
            SaveFile::from_bytes(
                RAW_PATH,
                &format!("remote/{folder}/index.save"),
                index_save(1_003_002, size, 1_700_000_000, save_type),
            ),
            SaveFile::from_bytes(RAW_PATH, &format!("remote/{folder}/data.save"), data),
        ]
    }

    #[test]
    fn reads_an_autosave_slot() {
        let slots = read_slots(&folder_files(
            "kntslotsavefile-0",
            slot_data(),
            "ESaveType_AutoSave",
        ));
        assert_eq!(slots.len(), 1);
        let slot = &slots[0];
        assert_eq!(slot.id, "slot0");
        assert_eq!(slot.kind, SlotKind::Auto);
        assert_eq!(slot.saved_at_ms, Some(1_700_000_000_000));
        assert_eq!(
            slot.stat(StatKind::Playtime),
            Some(&StatValue::Seconds(39_563))
        );
        assert_eq!(slot.stat(StatKind::Chapter), Some(&StatValue::Integer(3)));
        assert_eq!(
            slot.stat(StatKind::Objective),
            Some(&StatValue::Text("Chateau Staff Entrance".into()))
        );
        assert_eq!(
            slot.stat(StatKind::Difficulty),
            Some(&cataloged_label(
                "007_first_light.difficulty.purist",
                "Purist"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Collectibles),
            Some(&StatValue::Integer(3))
        );
        assert_eq!(
            slot.stat(StatKind::GameVersion),
            Some(&StatValue::Text("1.3.2".into()))
        );
        assert_eq!(slot.files.len(), 2);
    }

    #[test]
    fn reads_the_profile_and_skips_backups_and_settings() {
        let profile = vec![
            ("PlayTime", Field::Number(40_000.0)),
            (
                "UnlockedCheckpoints",
                texts(&["Clover_Intro", "Lotus_Start", "Lotus_End", "Rose_Arrival"]),
            ),
            ("UnlockedCollectibles", texts(&["a"])),
        ];
        let mut files = folder_files("KntProfileSaveFile", profile, "ESaveType_LocalProfile");
        files.extend(folder_files(
            "kntprofilesavefile-bck-0",
            vec![],
            "ESaveType_LocalProfile",
        ));
        files.extend(folder_files(
            "localprofile",
            vec![],
            "ESaveType_LocalProfile",
        ));
        let slots = read_slots(&files);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].id, "profile");
        assert_eq!(slots[0].kind, SlotKind::Profile);
        assert_eq!(
            slots[0].stat(StatKind::Playtime),
            Some(&StatValue::Seconds(40_000))
        );
        assert_eq!(
            slots[0].stat(StatKind::Chapter),
            Some(&StatValue::Integer(3))
        );
        assert_eq!(
            slots[0].stat(StatKind::Collectibles),
            Some(&StatValue::Integer(1))
        );
    }

    #[test]
    fn keeps_the_newest_copy_of_a_slot_seen_in_two_locations() {
        let mut files = folder_files("kntslotsavefile-0", slot_data(), "ESaveType_AutoSave");
        let (data, size) = data_save(slot_data());
        let other = "<winAppData>/GSE Saves/3768760";
        files.push(SaveFile::from_bytes(
            other,
            "remote/KntSlotSaveFile-0/index.save",
            index_save(1_003_002, size, 1_794_400_000, "ESaveType_AutoSave"),
        ));
        files.push(SaveFile::from_bytes(
            other,
            "remote/KntSlotSaveFile-0/data.save",
            data,
        ));
        let slots = read_slots(&files);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].saved_at_ms, Some(1_794_400_000_000));
        assert_eq!(slots[0].files[0], "remote/KntSlotSaveFile-0/index.save");
    }

    #[test]
    fn keeps_header_fields_when_data_is_damaged() {
        let mut files = folder_files("kntslotsavefile-2", slot_data(), "ESaveType_AutoSave");
        let mut damaged = match &files[1].content {
            crate::source::FileContent::Bytes(bytes) => bytes.to_vec(),
            _ => unreachable!(),
        };
        damaged.truncate(damaged.len() / 2);
        files[1] = SaveFile::from_bytes(RAW_PATH, "remote/kntslotsavefile-2/data.save", damaged);
        let slots = read_slots(&files);
        assert_eq!(slots[0].id, "slot2");
        assert_eq!(slots[0].stat(StatKind::Playtime), None);
        assert_eq!(
            slots[0].stat(StatKind::GameVersion),
            Some(&StatValue::Text("1.3.2".into()))
        );
    }

    #[test]
    fn rejects_garbage_and_truncated_index() {
        let mut files = folder_files("kntslotsavefile-0", slot_data(), "ESaveType_AutoSave");
        files[0] = SaveFile::from_bytes(
            RAW_PATH,
            "remote/kntslotsavefile-0/index.save",
            vec![0xab; 382],
        );
        assert!(read_slots(&files).is_empty());

        let index = index_save(1_003_002, 10, 1_700_000_000, "ESaveType_AutoSave");
        for len in [0, 8, 20, 40, index.len() - 1] {
            files[0] = SaveFile::from_bytes(
                RAW_PATH,
                "remote/kntslotsavefile-0/index.save",
                index[..len].to_vec(),
            );
            assert!(read_slots(&files).is_empty(), "len {len}");
        }
    }

    #[test]
    fn helpers() {
        assert!(matches!(
            folder_kind("KntSlotSaveFile-12"),
            Some(Folder::Slot(12))
        ));
        assert!(folder_kind("kntslotsavefile-").is_none());
        assert!(folder_kind("systemdata").is_none());
        assert_eq!(version_text(1_000_000).as_deref(), Some("1.0.0"));
        assert_eq!(version_text(12), None);
        assert_eq!(
            checkpoint_label("Lotus_Adv_Training_MI6_Auditorium_3").as_deref(),
            Some("Adv Training MI6 Auditorium 3")
        );
        assert_eq!(
            checkpoint_label("Dahlia_Adv_Drive_LeavingAleph").as_deref(),
            Some("Adv Drive Leaving Aleph")
        );
        assert_eq!(checkpoint_label("Orchid"), None);
        let unlocked = Value::Array(vec![
            Value::Text("Clover_Intro".into()),
            Value::Text("Lotus_Start".into()),
        ]);
        assert_eq!(mission_number("Lotus_End", &unlocked), Some(2));
        assert_eq!(mission_number("Rose_Boat_Start", &unlocked), Some(3));
        assert_eq!(
            mission_number("Rose_Boat_Start", &Value::Array(vec![])),
            None
        );
        assert_eq!(save_kind("ESaveType_QuickSave"), SlotKind::Quick);
        assert_eq!(difficulty_name(0.0), Some("Novice"));
        assert_eq!(difficulty_name(7.0), None);
        assert_eq!(difficulty_name(-1.0), None);
    }
}
