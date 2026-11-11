//! Assassin's Creed Black Flag Resynced (Anvil): the game keeps its slots in Ubisoft
//! Connect storage and writes a plain `SaveStorageManifest-<user>-UPC.json` listing each
//! slot with its size and last save time (local time). `ACBlackFlag[AutoSave01].save` files
//! only exist under some emulators; their payload is XOR-masked Oodle Kraken, so they only
//! give slot names and mtimes.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::games::Parser;
use crate::model::{SaveSlot, SlotKind, Stat, StatKind, StatValue};
use crate::source::SaveFile;
use crate::util::strip_bom;

pub const PARSER: Parser = Parser {
    id: "assassins-creed-black-flag-resynced",
    version: 1,
    steam_app_ids: &["3751950"],
    read_slots,
    labels: Vec::new,
    read_profile: crate::games::no_profile,
    stat_names: &[],
};

const MANIFEST_MAX_BYTES: u64 = 1024 * 1024;
const QUARTER_HOUR_MS: i64 = 15 * 60 * 1000;
const MAX_OFFSET_MS: i64 = 14 * 60 * 60 * 1000;
const MAX_OFFSET_RESIDUAL_MS: i64 = 2 * 60 * 1000;

#[derive(Default)]
struct SlotParts {
    manifest_file: Option<String>,
    save_file: Option<String>,
    save_file_modified_at: Option<i64>,
    manifest_saved_at: Option<i64>,
}

fn read_slots(files: &[SaveFile]) -> Vec<SaveSlot> {
    let mut slots: BTreeMap<String, SlotParts> = BTreeMap::new();
    let manifest = files
        .iter()
        .filter(|file| is_manifest_name(file.file_name()))
        .filter_map(|file| read_manifest(file).map(|manifest| (file, manifest)))
        .max_by_key(|(file, manifest)| (file.modified_at_ms, manifest.newest_local_ms));

    let mut game_version = None;
    if let Some((file, manifest)) = &manifest {
        game_version = manifest.save_version.clone();
        let offset = file
            .modified_at_ms
            .zip(manifest.newest_local_ms)
            .and_then(|(modified, newest)| utc_offset_ms(modified, newest));
        for entry in &manifest.entries {
            let parts = slots.entry(entry.name.clone()).or_default();
            parts.manifest_file = Some(file.relative_path.clone());
            parts.manifest_saved_at = entry
                .saved_local_ms
                .zip(offset)
                .map(|(local, offset)| local + offset);
        }
    }
    for file in files {
        if let Some(name) = save_file_slot(file.file_name()) {
            let parts = slots.entry(name.to_owned()).or_default();
            parts.save_file = Some(file.relative_path.clone());
            parts.save_file_modified_at = file.modified_at_ms;
        }
    }

    slots
        .into_iter()
        .filter_map(|(name, parts)| {
            let kind = slot_kind(&name)?;
            let mut stats = Vec::new();
            if let Some(version) = game_version
                .as_ref()
                .filter(|_| parts.manifest_file.is_some())
            {
                stats.push(Stat::new(
                    StatKind::GameVersion,
                    StatValue::Text(version.clone()),
                ));
            }
            Some(SaveSlot {
                id: name,
                kind,
                title: None,
                saved_at_ms: parts.save_file_modified_at.or(parts.manifest_saved_at),
                playthrough: None,
                stats,
                thumbnail: None,
                files: parts
                    .manifest_file
                    .into_iter()
                    .chain(parts.save_file)
                    .collect(),
            })
        })
        .collect()
}

fn is_manifest_name(name: &str) -> bool {
    name.starts_with("SaveStorageManifest-") && name.ends_with(".json")
}

/// `ACBlackFlag[ManualSave03].save` holds slot `ManualSave03`.
fn save_file_slot(name: &str) -> Option<&str> {
    let inner = name.strip_suffix("].save")?;
    let (_, slot) = inner.rsplit_once('[')?;
    (!slot.is_empty()).then_some(slot)
}

fn slot_kind(name: &str) -> Option<SlotKind> {
    let (prefix, kind) = [
        ("AutoSave", SlotKind::Auto),
        ("ManualSave", SlotKind::Manual),
        ("QuickSave", SlotKind::Quick),
    ]
    .into_iter()
    .find(|(prefix, _)| name.starts_with(prefix))?;
    name[prefix.len()..]
        .bytes()
        .all(|byte| byte.is_ascii_digit())
        .then_some(kind)
}

struct ManifestEntry {
    name: String,
    saved_local_ms: Option<i64>,
}

struct Manifest {
    save_version: Option<String>,
    entries: Vec<ManifestEntry>,
    newest_local_ms: Option<i64>,
}

fn read_manifest(file: &SaveFile) -> Option<Manifest> {
    let bytes = file.read_prefix(MANIFEST_MAX_BYTES).ok()?;
    let root: Value = serde_json::from_slice(strip_bom(&bytes)).ok()?;
    let save_version = root
        .pointer("/Session/SaveVersion")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .map(str::to_owned);

    let mut entries = Vec::new();
    let mut newest_local_ms = None;
    for entry in root.get("Files")?.as_array()? {
        let operations = entry.get("LastOperations").and_then(Value::as_object);
        let times = operations
            .into_iter()
            .flat_map(|operations| operations.values())
            .chain(entry.get("FileNote"))
            .filter_map(Value::as_str)
            .filter_map(parse_local_time);
        newest_local_ms = newest_local_ms.max(times.max());

        let Some(name) = entry.get("FileName").and_then(Value::as_str) else {
            continue;
        };
        if entry.get("FileExists").and_then(Value::as_bool) == Some(false)
            || slot_kind(name).is_none()
        {
            continue;
        }
        entries.push(ManifestEntry {
            name: name.to_owned(),
            saved_local_ms: operations
                .and_then(|operations| operations.get("Save"))
                .and_then(Value::as_str)
                .and_then(parse_local_time),
        });
    }
    Some(Manifest {
        save_version,
        entries,
        newest_local_ms,
    })
}

/// The manifest is rewritten on every operation, so its mtime (UTC) minus its newest local
/// timestamp is the player's UTC offset, up to the few seconds the write takes.
fn utc_offset_ms(modified_at_ms: i64, newest_local_ms: i64) -> Option<i64> {
    let difference = modified_at_ms.checked_sub(newest_local_ms)?;
    let offset = (difference + QUARTER_HOUR_MS / 2).div_euclid(QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
    ((difference - offset).abs() <= MAX_OFFSET_RESIDUAL_MS && offset.abs() <= MAX_OFFSET_MS)
        .then_some(offset)
}

/// Finds `2026.11.10-22.15.47` (local time) anywhere in the text and returns it as if it were UTC.
fn parse_local_time(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    (0..bytes.len().saturating_sub(18))
        .find_map(|start| parse_local_time_at(bytes.get(start..start + 19)?))
}

fn parse_local_time_at(bytes: &[u8]) -> Option<i64> {
    let separators = [(4, b'.'), (7, b'.'), (10, b'-'), (13, b'.'), (16, b'.')];
    if separators
        .iter()
        .any(|&(at, separator)| bytes.get(at) != Some(&separator))
    {
        return None;
    }
    let number = |from: usize, len: usize| -> Option<i64> {
        let digits = bytes.get(from..from + len)?;
        if !digits.iter().all(u8::is_ascii_digit) {
            return None;
        }
        std::str::from_utf8(digits).ok()?.parse().ok()
    };
    let (year, month, day) = (number(0, 4)?, number(5, 2)?, number(8, 2)?);
    let (hour, minute, second) = (number(11, 2)?, number(14, 2)?, number(17, 2)?);
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let shifted_year = if month <= 2 { year - 1 } else { year };
    let era = shifted_year.div_euclid(400);
    let year_of_era = shifted_year - era * 400;
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    Some(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::SaveFile;

    const MANIFEST_PATH: &str =
        "<winLocalAppData>/Ubisoft/Assassin's Creed Black Flag Resynced/save";
    const EMULATOR_PATH: &str = "<custom><windows><winAppData>/Goldberg UplayEmu Saves/66088";
    const LOCAL_NEWEST: &str = "2025.11.10-04.30.31";
    const UTC_NEWEST_MS: i64 = 1_762_759_831_000;

    fn manifest_json() -> String {
        serde_json::json!({
            "Session": { "Build": "c1_d2_s3 (PC)", "User": "ABCD1234", "SaveStorage": "UPC", "SaveVersion": "TU4 (1.0.6)" },
            "Files": [
                { "FileName": "AutoSave01", "FileNote": "[2025.10.08-04.30.39] File discovered", "FileSize": 350000, "FileExists": true,
                  "LastOperations": { "LoadInfos": "2025.11.10-03.54.12", "Save": "2025.11.10-04.24.19" } },
                { "FileName": "ManualSave01", "FileNote": "[2025.10.26-02.57.28] File created", "FileSize": 230000, "FileExists": true,
                  "LastOperations": { "LoadInfos": "2025.11.10-03.54.12", "LoadContent": "2025.11.02-01.46.16" } },
                { "FileName": "ManualSave05", "FileNote": "[2025.10.27-00.26.15] File lost", "FileExists": false,
                  "LastOperations": { "LoadInfos": "2025.10.27-00.12.06" } },
                { "FileName": "Options", "FileNote": "[2025.10.08-04.27.09] File created", "FileSize": 12000, "FileExists": true,
                  "LastOperations": { "Save": LOCAL_NEWEST } }
            ]
        })
        .to_string()
    }

    fn manifest_file(name: &str, json: String, modified_at_ms: Option<i64>) -> SaveFile {
        let mut file = SaveFile::from_bytes(MANIFEST_PATH, name, json.into_bytes());
        file.modified_at_ms = modified_at_ms;
        file
    }

    fn save_file(name: &str, modified_at_ms: i64) -> SaveFile {
        let mut bytes = vec![0x24, 0, 0, 0];
        bytes.resize(64, 0);
        let mut file = SaveFile::from_bytes(EMULATOR_PATH, name, bytes);
        file.modified_at_ms = Some(modified_at_ms);
        file
    }

    #[test]
    fn reads_slots_from_the_manifest_in_utc() {
        let files = [manifest_file(
            "SaveStorageManifest-ABCD1234-UPC.json",
            manifest_json(),
            Some(UTC_NEWEST_MS + 434),
        )];
        let slots = read_slots(&files);
        assert_eq!(
            slots
                .iter()
                .map(|slot| slot.id.as_str())
                .collect::<Vec<_>>(),
            ["AutoSave01", "ManualSave01"]
        );

        let auto = &slots[0];
        assert_eq!(auto.kind, SlotKind::Auto);
        assert_eq!(auto.saved_at_ms, Some(UTC_NEWEST_MS - (6 * 60 + 12) * 1000));
        assert_eq!(
            auto.stat(StatKind::GameVersion),
            Some(&StatValue::Text("TU4 (1.0.6)".into()))
        );
        assert_eq!(auto.files, ["SaveStorageManifest-ABCD1234-UPC.json"]);

        assert_eq!(slots[1].kind, SlotKind::Manual);
        assert_eq!(slots[1].saved_at_ms, None);
    }

    #[test]
    fn prefers_save_file_mtimes_and_keeps_save_only_slots() {
        let files = [
            manifest_file(
                "SaveStorageManifest-ABCD1234-UPC.json",
                manifest_json(),
                Some(UTC_NEWEST_MS),
            ),
            save_file("ACBlackFlag[AutoSave01].save", 1_000),
            save_file("ACBlackFlag[AutoSave07].save", 2_000),
            save_file("ACBlackFlag[Options].save", 3_000),
        ];
        let slots = read_slots(&files);
        assert_eq!(slots.len(), 3);
        assert_eq!(slots[0].saved_at_ms, Some(1_000));
        assert_eq!(
            slots[0].files,
            [
                "SaveStorageManifest-ABCD1234-UPC.json",
                "ACBlackFlag[AutoSave01].save"
            ]
        );
        assert_eq!(slots[1].id, "AutoSave07");
        assert_eq!(slots[1].saved_at_ms, Some(2_000));
        assert!(slots[1].stats.is_empty());
    }

    #[test]
    fn leaves_time_unset_when_the_offset_is_not_a_time_zone() {
        let files = [manifest_file(
            "SaveStorageManifest-ABCD1234-UPC.json",
            manifest_json(),
            Some(UTC_NEWEST_MS + 7 * 60 * 1000),
        )];
        assert!(read_slots(&files)
            .iter()
            .all(|slot| slot.saved_at_ms.is_none()));

        let files = [manifest_file(
            "SaveStorageManifest-ABCD1234-UPC.json",
            manifest_json(),
            None,
        )];
        assert!(read_slots(&files)
            .iter()
            .all(|slot| slot.saved_at_ms.is_none()));
    }

    #[test]
    fn uses_the_newest_manifest() {
        let old = serde_json::json!({
            "Session": { "SaveVersion": "TU2 (1.0.2)" },
            "Files": [{ "FileName": "AutoSave03", "FileExists": true, "LastOperations": { "Save": "2025.08.01-23.40.25" } }]
        })
        .to_string();
        let files = [
            manifest_file("SaveStorageManifest-OLD-UPC.json", old, Some(1_000)),
            manifest_file(
                "SaveStorageManifest-ABCD1234-UPC.json",
                manifest_json(),
                Some(UTC_NEWEST_MS),
            ),
        ];
        let slots = read_slots(&files);
        assert_eq!(slots.len(), 2);
        assert!(slots
            .iter()
            .all(|slot| slot.stat(StatKind::GameVersion)
                == Some(&StatValue::Text("TU4 (1.0.6)".into()))));
    }

    #[test]
    fn ignores_garbage_and_truncated_manifests() {
        let json = manifest_json();
        for text in ["", "{", "[]", "{\"Files\": 3}", &json[..json.len() / 2]] {
            let files = [manifest_file(
                "SaveStorageManifest-X-UPC.json",
                text.to_owned(),
                Some(UTC_NEWEST_MS),
            )];
            assert!(read_slots(&files).is_empty(), "{text}");
        }
        let files = [manifest_file(
            "SaveStorageJournal-X-UPC.json",
            json,
            Some(UTC_NEWEST_MS),
        )];
        assert!(read_slots(&files).is_empty());
    }

    #[test]
    fn helpers() {
        assert_eq!(slot_kind("QuickSave"), Some(SlotKind::Quick));
        assert_eq!(slot_kind("AutoSave1x"), None);
        assert_eq!(slot_kind("Options"), None);
        assert_eq!(
            save_file_slot("ACBlackFlag[ManualSave03].save"),
            Some("ManualSave03")
        );
        assert_eq!(save_file_slot("ACBlackFlag[].save"), None);
        assert_eq!(save_file_slot("ManualSave03.save"), None);
        assert_eq!(
            parse_local_time("[2025.11.10-04.30.31] File created"),
            Some(UTC_NEWEST_MS - 10_800_000)
        );
        assert_eq!(parse_local_time("2025.13.10-04.30.31"), None);
        assert_eq!(parse_local_time("2025.11.10"), None);
        assert_eq!(utc_offset_ms(10_800_000 + 1_500, 0), Some(10_800_000));
        assert_eq!(utc_offset_ms(-3_600_000 + 900, 0), Some(-3_600_000));
        assert_eq!(utc_offset_ms(20 * 3_600_000, 0), None);
    }
}
