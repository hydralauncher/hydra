//! CONTROL Resonant (Remedy, Northlight): every save is a set of `slot-N_<name>-<part>` files in
//! `remote/`, where `<name>` is `auto-0` … `auto-9` (rolling autosaves), `key-<hash>` (a save the
//! game keeps at a story moment) or `return`. All parts start with the `RMDB` magic. The small
//! `-header` part is plain: save time (Unix seconds), playtime in seconds and the path of the
//! world object the save was made at, whose first segment names the district
//! (`/zone_downtown/areas/oldest_house_area/…/save_spot_1`). The other parts are hashed binary.

use crate::games::{label, lookup, no_profile, Parser};
use crate::model::{SaveSlot, SlotKind, Stat, StatKind, StatValue};
use crate::source::SaveFile;
use crate::util::{u32_le, u64_le};

pub const PARSER: Parser = Parser {
    id: "control-resonant",
    version: 1,
    steam_app_ids: &["3669870"],
    read_slots,
    labels,
    read_profile: no_profile,
    stat_names: &[],
};

const LABEL_PREFIX: &str = "control_resonant";
const MAGIC: &[u8] = b"RMDB";
const HEADER_SUFFIX: &str = "-header";
const MAX_HEADER_BYTES: u64 = 4096;

const SAVED_AT: usize = 0x14;
const DISTRICT_HASH: usize = 0x20;
const PLAYTIME: usize = 0x29;
const PATH_LEN: usize = 0x2d;
const PATH: usize = 0x31;
const MAX_PATH: usize = 1024;

/// 2020-01-01 and 2100-01-01 in Unix seconds.
const SAVED_MIN: u64 = 1_577_836_800;
const SAVED_MAX: u64 = 4_102_444_800;
const MAX_PLAYTIME_SECONDS: u32 = 10_000_000;

/// District names follow the game's internal zone ids; the shipped names may differ.
const DISTRICTS: [(&str, &str); 8] = [
    ("zone_downtown", "Downtown"),
    ("zone_frontline", "Frontline"),
    ("zone_pattern", "The Pattern"),
    ("zone_twisted", "Twisted Zone"),
    ("zone_hiss", "Hiss Zone"),
    ("zone_mold", "Mold Zone"),
    ("zone_undercity", "Undercity"),
    ("oldest_house_interior", "The Oldest House"),
];

/// The header also stores the current district as a hash. Saves made inside a dungeon
/// (`/dungeon_watchtower/…`) carry the hash of the district around it.
const DISTRICT_HASHES: [(u32, &str); 7] = [
    (0xe790_cc70, "zone_downtown"),
    (0xd07d_807d, "zone_frontline"),
    (0x69af_dca2, "zone_pattern"),
    (0x0325_9f56, "zone_twisted"),
    (0x9c6c_ba01, "zone_hiss"),
    (0x7cc2_f8b0, "zone_mold"),
    (0xc284_a309, "zone_undercity"),
];

fn labels() -> Vec<(&'static str, &'static str)> {
    DISTRICTS
        .iter()
        .map(|&(_, text)| ("location", text))
        .collect()
}

fn read_slots(files: &[SaveFile]) -> Vec<SaveSlot> {
    let mut slots: Vec<SaveSlot> = Vec::new();
    let candidates = files.iter().filter_map(|file| {
        let stem = file.file_name().strip_suffix(HEADER_SUFFIX)?;
        save_name(stem)?;
        read_slot(file, stem, files)
    });
    for slot in candidates {
        match slots.iter_mut().find(|existing| existing.id == slot.id) {
            Some(existing) if existing.saved_at_ms < slot.saved_at_ms => *existing = slot,
            Some(_) => {}
            None => slots.push(slot),
        }
    }
    slots
}

/// `slot-0_auto-3`, `slot-0_key-107081994` or `slot-0_return`.
fn save_name(stem: &str) -> Option<(&str, &str)> {
    let (slot, name) = stem.split_once('_')?;
    let number = slot.strip_prefix("slot-")?;
    if number.is_empty() || number.len() > 2 || !number.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let numbered = |rest: &str| {
        !rest.is_empty() && rest.len() <= 10 && rest.bytes().all(|byte| byte.is_ascii_digit())
    };
    let known = name == "return"
        || name.strip_prefix("auto-").is_some_and(numbered)
        || name.strip_prefix("key-").is_some_and(numbered);
    known.then_some((slot, name))
}

fn read_slot(header_file: &SaveFile, stem: &str, files: &[SaveFile]) -> Option<SaveSlot> {
    let header = header_file.read_prefix(MAX_HEADER_BYTES).ok()?;
    if header.get(..4)? != MAGIC {
        return None;
    }
    let saved_at =
        u64_le(&header, SAVED_AT).filter(|seconds| (SAVED_MIN..SAVED_MAX).contains(seconds));
    let playtime = u32_le(&header, PLAYTIME).filter(|&seconds| seconds < MAX_PLAYTIME_SECONDS);
    let path = world_path(&header);

    let mut stats = Vec::new();
    if let Some(seconds) = playtime {
        stats.push(Stat::new(
            StatKind::Playtime,
            StatValue::Seconds(u64::from(seconds)),
        ));
    }
    let district = path
        .and_then(|path| path.trim_start_matches('/').split('/').next())
        .and_then(|zone| lookup(&DISTRICTS, zone))
        .or_else(|| {
            let zone = lookup(&DISTRICT_HASHES, u32_le(&header, DISTRICT_HASH)?)?;
            lookup(&DISTRICTS, zone)
        });
    if let Some(text) = district {
        stats.push(Stat::new(
            StatKind::Location,
            label(LABEL_PREFIX, "location", text),
        ));
    }
    if stats.is_empty() {
        return None;
    }

    let (slot, _) = save_name(stem)?;
    let prefix = format!("{stem}-");
    let mut slot_files: Vec<String> = files
        .iter()
        .filter(|file| {
            file.raw_path == header_file.raw_path
                && file.parent_dir() == header_file.parent_dir()
                && file.file_name().starts_with(&prefix)
        })
        .map(|file| file.relative_path.clone())
        .collect();
    slot_files.sort();

    Some(SaveSlot {
        id: stem.to_owned(),
        kind: SlotKind::Auto,
        title: None,
        saved_at_ms: saved_at
            .and_then(|seconds| i64::try_from(seconds).ok())
            .map(|seconds| seconds * 1000)
            .or(header_file.modified_at_ms),
        playthrough: Some(slot.to_owned()),
        stats,
        thumbnail: None,
        files: slot_files,
    })
}

fn world_path(header: &[u8]) -> Option<&str> {
    let len = usize::try_from(u32_le(header, PATH_LEN)?).ok()?;
    if len == 0 || len > MAX_PATH {
        return None;
    }
    let bytes = header.get(PATH..PATH.checked_add(len)?)?;
    if !bytes.iter().all(|byte| byte.is_ascii_graphic()) {
        return None;
    }
    std::str::from_utf8(bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::cataloged_label;

    const RAW: &str = "<root>/userdata/<storeUserId>/3669870/remote";

    fn header(saved_at: u64, district_hash: u32, playtime: u32, path: &str) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(MAGIC);
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&0x1234_5678u32.to_le_bytes());
        bytes.extend_from_slice(&0x10u32.to_le_bytes());
        bytes.extend_from_slice(&saved_at.to_le_bytes());
        bytes.extend_from_slice(&42u32.to_le_bytes());
        bytes.extend_from_slice(&district_hash.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.push(0);
        bytes.extend_from_slice(&playtime.to_le_bytes());
        bytes.extend_from_slice(&(path.len() as u32).to_le_bytes());
        bytes.extend_from_slice(path.as_bytes());
        bytes.extend_from_slice(&[0xaa; 8]);
        bytes.extend_from_slice(&[0; 16]);
        assert_eq!(bytes[PLAYTIME..PLAYTIME + 4], playtime.to_le_bytes());
        bytes
    }

    fn files_for(stem: &str, header_bytes: Vec<u8>) -> Vec<SaveFile> {
        let mut files = vec![SaveFile::from_bytes(
            RAW,
            &format!("{stem}-header"),
            header_bytes,
        )];
        for part in ["player", "persi-global", "bundle-container"] {
            files.push(SaveFile::from_bytes(
                RAW,
                &format!("{stem}-{part}"),
                b"RMDB".to_vec(),
            ));
        }
        files
    }

    #[test]
    fn reads_playtime_time_and_district_from_the_path() {
        let files = files_for(
            "slot-0_auto-3",
            header(
                1_700_000_000,
                0x69af_dca2,
                36_000,
                "/zone_downtown/areas/oldest_house_area/world_systems/save_spots/save_spot_1",
            ),
        );
        let slots = read_slots(&files);
        assert_eq!(slots.len(), 1);
        let slot = &slots[0];
        assert_eq!(slot.id, "slot-0_auto-3");
        assert_eq!(slot.kind, SlotKind::Auto);
        assert_eq!(slot.saved_at_ms, Some(1_700_000_000_000));
        assert_eq!(slot.playthrough.as_deref(), Some("slot-0"));
        assert_eq!(
            slot.stat(StatKind::Playtime),
            Some(&StatValue::Seconds(36_000))
        );
        assert_eq!(
            slot.stat(StatKind::Location),
            Some(&cataloged_label(
                "control_resonant.location.downtown",
                "Downtown"
            ))
        );
        assert_eq!(slot.files.len(), 4);
    }

    #[test]
    fn dungeon_saves_fall_back_to_the_district_hash() {
        let files = files_for(
            "slot-0_key-1246823124",
            header(
                1_700_000_000,
                0xd07d_807d,
                8_968,
                "/dungeon_watchtower/Quests/dq_s3p1a_evacuation/key_moment_save",
            ),
        );
        let slot = &read_slots(&files)[0];
        assert_eq!(
            slot.stat(StatKind::Location),
            Some(&cataloged_label(
                "control_resonant.location.frontline",
                "Frontline"
            ))
        );
    }

    #[test]
    fn oldest_house_interior_is_its_own_place() {
        let files = files_for(
            "slot-0_return",
            header(
                1_700_000_000,
                0xe790_cc70,
                71_012,
                "/oldest_house_interior/quests/dq_s3p6_midpoint_collapse/key_moment_save",
            ),
        );
        assert_eq!(
            read_slots(&files)[0].stat(StatKind::Location),
            Some(&cataloged_label(
                "control_resonant.location.the_oldest_house",
                "The Oldest House"
            ))
        );
    }

    #[test]
    fn unknown_place_keeps_playtime_only() {
        let files = files_for(
            "slot-1_auto-0",
            header(1_700_000_000, 0, 461, "/dungeon_jrpg/save_spot"),
        );
        let slot = &read_slots(&files)[0];
        assert_eq!(slot.stat(StatKind::Location), None);
        assert_eq!(
            slot.stat(StatKind::Playtime),
            Some(&StatValue::Seconds(461))
        );
        assert_eq!(slot.playthrough.as_deref(), Some("slot-1"));
    }

    #[test]
    fn ignores_other_files_and_bad_headers() {
        let mut files = vec![
            SaveFile::from_bytes(RAW, "preferences_data", b"RMDB".to_vec()),
            SaveFile::from_bytes(RAW, "slot-0_auto-0-header", b"XXXX".to_vec()),
            SaveFile::from_bytes(
                RAW,
                "slot-0_banana-header",
                header(1_700_000_000, 0, 1, "/zone_mold/x"),
            ),
        ];
        files.push(SaveFile::from_bytes(
            RAW,
            "slot-0_auto-1-header",
            vec![b'R', b'M'],
        ));
        assert!(read_slots(&files).is_empty());
    }

    #[test]
    fn out_of_range_values_are_dropped() {
        let files = files_for(
            "slot-0_auto-0",
            header(
                12,
                0x7cc2_f8b0,
                u32::MAX,
                "/zone_mold/areas/area_molding_valley/save_spot",
            ),
        );
        let slot = &read_slots(&files)[0];
        assert_eq!(slot.stat(StatKind::Playtime), None);
        assert_eq!(slot.saved_at_ms, None);
        assert_eq!(
            slot.stat(StatKind::Location),
            Some(&cataloged_label(
                "control_resonant.location.mold_zone",
                "Mold Zone"
            ))
        );
    }

    #[test]
    fn newest_copy_of_a_save_wins_across_locations() {
        let path = "/zone_downtown/areas/save_spot_1";
        let mut files = files_for("slot-0_auto-1", header(1_794_000_000, 0, 100, path));
        let mut emulator = files_for("slot-0_auto-1", header(1_794_000_500, 0, 200, path));
        for file in &mut emulator {
            file.raw_path = "<winPublic>/Documents/Steam/RUNE/3669870".to_owned();
        }
        files.extend(emulator);
        let slots = read_slots(&files);
        assert_eq!(slots.len(), 1);
        assert_eq!(
            slots[0].stat(StatKind::Playtime),
            Some(&StatValue::Seconds(200))
        );
    }
}
