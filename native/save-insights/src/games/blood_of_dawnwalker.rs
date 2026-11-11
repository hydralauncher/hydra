//! The Blood of Dawnwalker: one `<Slot>.sav` per save (`ManualSave3`, `Autosave0`, `Quicksave1`,
//! `FinalAutosave`...), optionally with the save menu's `<Slot>.meta` (JSON) and `<Slot>.png`.
//! The `.sav` is compressed with Oodle Kraken, which this crate does not decode: it only defines
//! the slot, and every stat comes from the `.meta`.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::games::{newest_modified_at, Parser};
use crate::model::{SaveSlot, SlotKind, Stat, StatKind, StatValue};
use crate::source::SaveFile;
use crate::util::{png_thumbnail, strip_bom};

pub const PARSER: Parser = Parser {
    id: "the-blood-of-dawnwalker",
    version: 1,
    steam_app_ids: &["3751260"],
    read_slots,
    labels: Vec::new,
    read_profile: crate::games::no_profile,
    stat_names: &[],
};

const MAX_META_BYTES: u64 = 64 * 1024;
/// A `.meta` or `.png` written more than this apart from its `.sav` belongs to another save.
const SIDECAR_SKEW_MS: u64 = 5 * 60 * 1000;

#[derive(Default)]
struct SlotFiles<'a> {
    sav: Option<&'a SaveFile>,
    meta: Option<&'a SaveFile>,
    png: Option<&'a SaveFile>,
}

fn read_slots(files: &[SaveFile]) -> Vec<SaveSlot> {
    let mut groups: BTreeMap<(&str, &str, &str), SlotFiles> = BTreeMap::new();
    for file in files {
        let Some((stem, extension)) = file.file_name().rsplit_once('.') else {
            continue;
        };
        if slot_kind(stem).is_none() {
            continue;
        }
        let entry = groups
            .entry((file.raw_path.as_str(), file.parent_dir(), stem))
            .or_default();
        match extension.to_ascii_lowercase().as_str() {
            "sav" => entry.sav = Some(file),
            "meta" => entry.meta = Some(file),
            "png" => entry.png = Some(file),
            _ => {}
        }
    }

    let mut slots: BTreeMap<String, SaveSlot> = BTreeMap::new();
    for ((_, _, stem), slot_files) in groups {
        let Some(slot) = read_slot(stem, &slot_files) else {
            continue;
        };
        let keep_existing = slots
            .get(&slot.id)
            .is_some_and(|existing| existing.saved_at_ms >= slot.saved_at_ms);
        if !keep_existing {
            slots.insert(slot.id.clone(), slot);
        }
    }
    slots.into_values().collect()
}

fn read_slot(stem: &str, slot_files: &SlotFiles) -> Option<SaveSlot> {
    let kind = slot_kind(stem)?;
    let sav = slot_files.sav?;
    let meta = slot_files.meta.filter(|file| same_save(sav, file));
    let png = slot_files.png.filter(|file| same_save(sav, file));
    let used: Vec<&SaveFile> = [Some(sav), meta, png].into_iter().flatten().collect();
    Some(SaveSlot {
        id: stem.to_owned(),
        kind,
        title: None,
        saved_at_ms: newest_modified_at(&used),
        playthrough: None,
        stats: meta.and_then(read_meta).unwrap_or_default(),
        thumbnail: png.and_then(png_thumbnail),
        files: used.iter().map(|file| file.relative_path.clone()).collect(),
    })
}

fn slot_kind(stem: &str) -> Option<SlotKind> {
    let prefix = stem.trim_end_matches(|character: char| character.is_ascii_digit());
    let numbered = prefix.len() < stem.len();
    let lower = prefix.to_ascii_lowercase();
    match lower.as_str() {
        "manualsave" if numbered => Some(SlotKind::Manual),
        "quicksave" if numbered => Some(SlotKind::Quick),
        "autosave" if numbered => Some(SlotKind::Auto),
        _ if !numbered && lower.len() > "autosave".len() && lower.ends_with("autosave") => {
            Some(SlotKind::Auto)
        }
        _ => None,
    }
}

fn same_save(sav: &SaveFile, sidecar: &SaveFile) -> bool {
    match (sav.modified_at_ms, sidecar.modified_at_ms) {
        (Some(sav_ms), Some(sidecar_ms)) => sav_ms.abs_diff(sidecar_ms) <= SIDECAR_SKEW_MS,
        _ => true,
    }
}

fn read_meta(file: &SaveFile) -> Option<Vec<Stat>> {
    let bytes = file.read_prefix(MAX_META_BYTES).ok()?;
    let root: Value = serde_json::from_slice(strip_bom(&bytes)).ok()?;
    let meta = root.get("Meta")?.as_object()?;
    let mut stats = Vec::new();
    if let Some(seconds) = meta
        .get("PlayTime")
        .and_then(Value::as_f64)
        .filter(|seconds| *seconds >= 0.0)
    {
        stats.push(Stat::new(
            StatKind::Playtime,
            StatValue::Seconds(seconds as u64),
        ));
    }
    if let Some(day) = meta.get("Day").and_then(Value::as_i64) {
        stats.push(Stat::new(StatKind::InGameDay, StatValue::Integer(day)));
    }
    if let Some(build) = meta
        .get("BuildVersion")
        .and_then(Value::as_u64)
        .filter(|build| *build > 0)
    {
        stats.push(Stat::new(
            StatKind::GameVersion,
            StatValue::Text(build.to_string()),
        ));
    }
    Some(stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RAW_PATH: &str = "<winLocalAppData>/Dawnwalker/Saved/SaveGames/*.sav";

    fn file(path: &str, bytes: Vec<u8>, modified_at_ms: i64) -> SaveFile {
        let mut file = SaveFile::from_bytes(RAW_PATH, path, bytes);
        file.modified_at_ms = Some(modified_at_ms);
        file
    }

    fn sav() -> Vec<u8> {
        let mut bytes = b"DSAV".to_vec();
        bytes.extend_from_slice(&[0xa5; 64]);
        bytes
    }

    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        png.extend_from_slice(&width.to_be_bytes());
        png.extend_from_slice(&height.to_be_bytes());
        png.extend_from_slice(&[8, 6, 0, 0, 0]);
        png
    }

    fn meta_json() -> Vec<u8> {
        let meta = serde_json::json!({ "Meta": {
            "Day": 3, "Quest": "47CD37C345A64E6A880933B7C5ABED80", "PlayTime": 1135,
            "SaveName": "Autosave1", "Date": "2026.09.03-15.58.51", "Type": 1,
            "BuildVersion": 256181, "GameVersion": 5, "SaveVersion": 134, "TypeString": "Auto"
        }});
        let mut bytes = b"\xef\xbb\xbf".to_vec();
        bytes.extend(serde_json::to_vec_pretty(&meta).unwrap());
        bytes
    }

    #[test]
    fn reads_the_meta_and_thumbnail_of_a_slot() {
        let files = [
            file("Autosave1.sav", sav(), 10_000),
            file("Autosave1.meta", meta_json(), 10_002),
            file("Autosave1.png", png_header(320, 135), 10_040),
        ];
        let slots = read_slots(&files);
        assert_eq!(slots.len(), 1);
        let slot = &slots[0];
        assert_eq!(slot.id, "Autosave1");
        assert_eq!(slot.kind, SlotKind::Auto);
        assert_eq!(slot.saved_at_ms, Some(10_040));
        assert_eq!(
            slot.stat(StatKind::Playtime),
            Some(&StatValue::Seconds(1135))
        );
        assert_eq!(slot.stat(StatKind::InGameDay), Some(&StatValue::Integer(3)));
        assert_eq!(
            slot.stat(StatKind::GameVersion),
            Some(&StatValue::Text("256181".into()))
        );
        assert_eq!(slot.stats.len(), 3);
        let thumbnail = slot.thumbnail.as_ref().unwrap();
        assert_eq!(thumbnail.file, "Autosave1.png");
        assert_eq!((thumbnail.width, thumbnail.height), (Some(320), Some(135)));
        assert_eq!(
            slot.files,
            ["Autosave1.sav", "Autosave1.meta", "Autosave1.png"]
        );
    }

    #[test]
    fn a_sav_alone_is_a_slot_without_stats() {
        let slots = read_slots(&[file("ManualSave7.sav", sav(), 1_000)]);
        assert_eq!(slots.len(), 1);
        let slot = &slots[0];
        assert_eq!(slot.id, "ManualSave7");
        assert_eq!(slot.kind, SlotKind::Manual);
        assert_eq!(slot.saved_at_ms, Some(1_000));
        assert!(slot.stats.is_empty());
        assert_eq!(slot.thumbnail, None);
        assert_eq!(slot.files, ["ManualSave7.sav"]);
    }

    #[test]
    fn stale_sidecars_and_older_duplicates_are_ignored() {
        let mut old_sav = file("Quicksave0.sav", sav(), 1_000);
        old_sav.raw_path = "<winLocalAppData>/Dawnwalker/Saved/SaveGames".into();
        let mut old_meta = file("Quicksave0.meta", meta_json(), 1_000);
        old_meta.raw_path = old_sav.raw_path.clone();
        let files = [
            old_sav,
            old_meta,
            file("Quicksave0.sav", sav(), 9_000_000),
            file("Quicksave0.meta", meta_json(), 1_000),
            file(
                "Quicksave0.png",
                png_header(320, 135),
                9_000_000 + SIDECAR_SKEW_MS as i64 + 1,
            ),
        ];
        let slots = read_slots(&files);
        assert_eq!(slots.len(), 1);
        let slot = &slots[0];
        assert_eq!(slot.kind, SlotKind::Quick);
        assert_eq!(slot.saved_at_ms, Some(9_000_000));
        assert_eq!(slot.files, ["Quicksave0.sav"]);
        assert!(slot.stats.is_empty());
        assert_eq!(slot.thumbnail, None);
    }

    #[test]
    fn garbage_meta_keeps_the_slot_without_stats() {
        let valid = meta_json();
        for bytes in [
            Vec::new(),
            b"{not json".to_vec(),
            b"[1, 2]".to_vec(),
            br#"{"Meta": 5}"#.to_vec(),
            br#"{"Meta": {"PlayTime": -4, "Day": "x", "BuildVersion": 0}}"#.to_vec(),
            valid[..valid.len() / 2].to_vec(),
            vec![0xff; 4096],
        ] {
            let files = [
                file("Autosave2.sav", sav(), 5),
                file("Autosave2.meta", bytes, 5),
            ];
            let slots = read_slots(&files);
            assert_eq!(slots.len(), 1);
            assert!(slots[0].stats.is_empty());
            assert_eq!(slots[0].files, ["Autosave2.sav", "Autosave2.meta"]);
        }
    }

    #[test]
    fn ignores_settings_and_files_without_a_sav() {
        let files = [
            file("RebelSettings.sav", b"GVAS".to_vec(), 1),
            file("RebelInput.sav", b"GVAS".to_vec(), 1),
            file("Autosave3.meta", meta_json(), 1),
            file("Autosave3.png", png_header(4, 4), 1),
        ];
        assert!(read_slots(&files).is_empty());
    }

    #[test]
    fn slot_kinds() {
        assert_eq!(slot_kind("ManualSave12"), Some(SlotKind::Manual));
        assert_eq!(slot_kind("Autosave0"), Some(SlotKind::Auto));
        assert_eq!(slot_kind("Quicksave4"), Some(SlotKind::Quick));
        assert_eq!(slot_kind("FinalAutosave"), Some(SlotKind::Auto));
        assert_eq!(slot_kind("ReturnToSafetyAutosave"), Some(SlotKind::Auto));
        assert_eq!(slot_kind("ManualSave"), None);
        assert_eq!(slot_kind("Autosave"), None);
        assert_eq!(slot_kind("RebelSettings"), None);
    }
}
