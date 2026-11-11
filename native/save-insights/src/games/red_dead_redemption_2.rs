//! Red Dead Redemption 2: story saves are `SRDR3NNNN` files (slots 0-14 manual, 15 the autosave).
//! Only the 0x110-byte header is plain: a big-endian format version, the UTF-16LE title the game
//! shows ("<last mission> (17.0%) - 11/18/24 02:07:14", autosaves get a localized prefix) and a
//! big-endian Unix timestamp. The body is AES-ECB encrypted with a PC key no public tool documents,
//! so money, honor, playtime and the screenshot are out of reach. `PRDR3*` files are photo-mode
//! pictures, not saves.

use crate::games::{group_by_dir, Parser};
use crate::model::{SaveSlot, SlotKind, Stat, StatKind, StatValue};
use crate::source::SaveFile;

pub const PARSER: Parser = Parser {
    id: "red-dead-redemption-2",
    version: 1,
    steam_app_ids: &["1174180"],
    read_slots,
    labels: Vec::new,
    read_profile: crate::games::no_profile,
    stat_names: &[(StatKind::Quest, "Last mission")],
};

const SAVE_PREFIX: &str = "SRDR3";
const AUTOSAVE_SLOT: u32 = 15;
const HEADER_LEN: u64 = 0x110;
const TITLE_RANGE: std::ops::Range<usize> = 4..0x104;
const TIMESTAMP_AT: usize = 0x104;
/// PC release day; older header timestamps are garbage.
const MIN_TIMESTAMP: u32 = 1_572_912_000;
/// The header clock can be off by the DST bias, so an mtime this close is the better value; a
/// farther one means the file was copied.
const MAX_CLOCK_SKEW_MS: i64 = 2 * 60 * 60 * 1000;
const OPEN_PARENS: [char; 2] = ['(', '（'];
const CLOSE_PARENS: [char; 2] = [')', '）'];
const PERCENT_SIGNS: [char; 2] = ['%', '％'];

/// Stray copies of the profile folder are common on cracked installs; only the folder with the
/// newest save is the one the game uses.
fn read_slots(files: &[SaveFile]) -> Vec<SaveSlot> {
    group_by_dir(files)
        .into_iter()
        .map(|((_, dir), dir_files)| {
            let slots: Vec<SaveSlot> = dir_files
                .iter()
                .filter_map(|file| read_slot(file))
                .collect();
            (dir, slots)
        })
        .filter(|(_, slots)| !slots.is_empty())
        .max_by(|(a_dir, a), (b_dir, b)| {
            newest(a)
                .cmp(&newest(b))
                .then_with(|| b_dir.matches('/').count().cmp(&a_dir.matches('/').count()))
        })
        .map(|(_, slots)| slots)
        .unwrap_or_default()
}

fn newest(slots: &[SaveSlot]) -> Option<i64> {
    slots.iter().filter_map(|slot| slot.saved_at_ms).max()
}

fn slot_number(file_name: &str) -> Option<u32> {
    let digits = file_name.strip_prefix(SAVE_PREFIX)?;
    if digits.len() != 4 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

fn read_slot(file: &SaveFile) -> Option<SaveSlot> {
    let number = slot_number(file.file_name())?;
    let (id, kind) = match number {
        AUTOSAVE_SLOT => ("autosave".to_owned(), SlotKind::Auto),
        0..AUTOSAVE_SLOT => (format!("slot{}", number + 1), SlotKind::Manual),
        _ => (format!("slot{}", number + 1), SlotKind::Unknown),
    };
    let header = file
        .read_prefix(HEADER_LEN)
        .ok()
        .filter(|header| u32_be(header, 0).is_some_and(|version| (1..0x100).contains(&version)))
        .unwrap_or_default();
    let title = read_title(&header);

    let mut stats = Vec::new();
    if let Some(title) = &title {
        let (mission, completion) = split_title(title);
        if let Some(completion) = completion {
            stats.push(Stat::new(
                StatKind::Completion,
                StatValue::Percent(completion),
            ));
        }
        if let Some(mission) = mission {
            stats.push(Stat::new(StatKind::Quest, StatValue::Text(mission)));
        }
    }
    let header_ms = u32_be(&header, TIMESTAMP_AT)
        .filter(|&seconds| seconds >= MIN_TIMESTAMP)
        .map(|seconds| i64::from(seconds) * 1000);
    let saved_at_ms = match (header_ms, file.modified_at_ms) {
        (Some(header_ms), Some(modified_ms))
            if (header_ms - modified_ms).abs() <= MAX_CLOCK_SKEW_MS =>
        {
            Some(modified_ms)
        }
        (Some(header_ms), _) => Some(header_ms),
        (None, modified_ms) => modified_ms,
    };

    Some(SaveSlot {
        id,
        kind,
        title,
        saved_at_ms,
        playthrough: None,
        stats,
        thumbnail: None,
        files: vec![file.relative_path.clone()],
    })
}

fn u32_be(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(
        bytes.get(at..at.checked_add(4)?)?.try_into().ok()?,
    ))
}

fn read_title(header: &[u8]) -> Option<String> {
    let end = header.len().min(TITLE_RANGE.end);
    let units = header
        .get(TITLE_RANGE.start..end)?
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&pair| u16::from_le_bytes(pair))
        .take_while(|&unit| unit != 0);
    let title = char::decode_utf16(units)
        .collect::<Result<String, _>>()
        .ok()?;
    let title = title.trim();
    (!title.is_empty() && !title.chars().any(char::is_control)).then(|| title.to_owned())
}

/// Splits "(Autosave) Mission - Part II (58.6%) - 11/10/26 18:33:59" into the mission and the %.
fn split_title(title: &str) -> (Option<String>, Option<f64>) {
    let body = strip_leading_group(title.trim());
    match find_completion(body) {
        Some((open, completion)) => (non_empty(&body[..open]), Some(completion)),
        None => (non_empty(strip_date(body)), None),
    }
}

fn strip_leading_group(text: &str) -> &str {
    let Some(inner) = text.strip_prefix(OPEN_PARENS) else {
        return text;
    };
    let Some((close, paren)) = inner.char_indices().find(|(_, c)| CLOSE_PARENS.contains(c)) else {
        return text;
    };
    let rest = inner[close + paren.len_utf8()..].trim_start();
    if rest.is_empty() || parse_percent(&inner[..close]).is_some() {
        text
    } else {
        rest
    }
}

fn find_completion(text: &str) -> Option<(usize, f64)> {
    text.char_indices()
        .rev()
        .filter(|(_, c)| OPEN_PARENS.contains(c))
        .find_map(|(open, paren)| {
            let inner = &text[open + paren.len_utf8()..];
            let close = inner.find(CLOSE_PARENS)?;
            parse_percent(&inner[..close]).map(|completion| (open, completion))
        })
}

fn parse_percent(text: &str) -> Option<f64> {
    let text = text.trim();
    let number = text
        .strip_suffix(PERCENT_SIGNS)
        .or_else(|| text.strip_prefix(PERCENT_SIGNS))?
        .trim();
    if number.is_empty()
        || !number
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.' || byte == b',')
    {
        return None;
    }
    let value: f64 = number.replace(',', ".").parse().ok()?;
    (0.0..=100.0).contains(&value).then_some(value)
}

fn strip_date(text: &str) -> &str {
    match text.rsplit_once(" - ") {
        Some((head, tail))
            if tail.bytes().any(|byte| byte.is_ascii_digit())
                && tail
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || b"/.:- ".contains(&byte)) =>
        {
            head.trim_end()
        }
        _ => text,
    }
}

fn non_empty(text: &str) -> Option<String> {
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const RAW_PATH: &str = "<winAppData>/.1911/Red Dead Redemption 2";

    fn header(version: u32, title: &str, timestamp: u32) -> Vec<u8> {
        let mut bytes = version.to_be_bytes().to_vec();
        for unit in title.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes.resize(TIMESTAMP_AT, 0);
        bytes.extend_from_slice(&timestamp.to_be_bytes());
        bytes.extend_from_slice(&[0; 4]);
        bytes.extend_from_slice(&0x1234_5678u32.to_be_bytes());
        bytes.extend((0..64u8).map(|byte| byte.wrapping_mul(37)));
        bytes
    }

    fn save(path: &str, title: &str, timestamp: u32) -> SaveFile {
        SaveFile::from_bytes(RAW_PATH, path, header(4, title, timestamp))
    }

    fn with_mtime(mut file: SaveFile, ms: i64) -> SaveFile {
        file.modified_at_ms = Some(ms);
        file
    }

    #[test]
    fn reads_manual_and_auto_slots() {
        let files = vec![
            save(
                "profile/SRDR30000",
                "Who Is Not Without Sin - Part II (21.4%) - 11/18/24 02:07:14",
                1_731_906_434,
            ),
            save(
                "profile/SRDR30015",
                "(Autosave) Who Is Not Without Sin - Part II (21.4%) - 11/18/24 02:09:00",
                1_731_906_540,
            ),
            SaveFile::from_bytes(
                RAW_PATH,
                "profile/PRDR31234567890",
                header(4, "PHOTO - 11/18/24", 1_731_906_000),
            ),
            SaveFile::from_bytes(RAW_PATH, "profile/Player", vec![1, 2, 3]),
            SaveFile::from_bytes(RAW_PATH, "profile/cfg.dat", vec![0; 64]),
        ];
        let slots = read_slots(&files);
        assert_eq!(slots.len(), 2);

        let manual = slots.iter().find(|slot| slot.id == "slot1").unwrap();
        assert_eq!(manual.kind, SlotKind::Manual);
        assert_eq!(
            manual.title.as_deref(),
            Some("Who Is Not Without Sin - Part II (21.4%) - 11/18/24 02:07:14")
        );
        assert_eq!(manual.saved_at_ms, Some(1_731_906_434_000));
        assert_eq!(
            manual.stat(StatKind::Completion),
            Some(&StatValue::Percent(21.4))
        );
        assert_eq!(
            manual.stat(StatKind::Quest),
            Some(&StatValue::Text("Who Is Not Without Sin - Part II".into()))
        );
        assert_eq!(manual.files, vec!["profile/SRDR30000".to_owned()]);

        let auto = slots.iter().find(|slot| slot.id == "autosave").unwrap();
        assert_eq!(auto.kind, SlotKind::Auto);
        assert_eq!(
            auto.stat(StatKind::Quest),
            Some(&StatValue::Text("Who Is Not Without Sin - Part II".into()))
        );
        assert!(auto.thumbnail.is_none());
    }

    #[test]
    fn splits_titles_in_several_layouts() {
        let cases: &[(&str, Option<&str>, Option<f64>)] = &[
            (
                "(Salvamento Automático) O Veterano - Parte II (58.6%) - 11/10/26 18:33:59",
                Some("O Veterano - Parte II"),
                Some(58.6),
            ),
            (
                "Black Belle (22.5%) - 10/05/26 13:04:37",
                Some("Black Belle"),
                Some(22.5),
            ),
            (
                "Ein Gauner (17,0 %) - 18.11.24 02:07:14",
                Some("Ein Gauner"),
                Some(17.0),
            ),
            (
                "Bir Görev (%17,0) - 18.11.24 02:07:14",
                Some("Bir Görev"),
                Some(17.0),
            ),
            (
                "（オートセーブ）任務（100.0％） - 2024/11/18 02:07:14",
                Some("任務"),
                Some(100.0),
            ),
            ("Tilly (97.1%)", Some("Tilly"), Some(97.1)),
            (
                "Bem-Aventurados os Mansos? (48.8%) - 10/29/26 18:15:33",
                Some("Bem-Aventurados os Mansos?"),
                Some(48.8),
            ),
            (
                "Mission - Part I - 11/18/24 02:07:14",
                Some("Mission - Part I"),
                None,
            ),
            (
                "Odd (Name) (150.0%) - 11/18/24",
                Some("Odd (Name) (150.0%)"),
                None,
            ),
            ("(42.0%)", None, Some(42.0)),
        ];
        for &(title, mission, completion) in cases {
            let (got_mission, got_completion) = split_title(title);
            assert_eq!(got_mission.as_deref(), mission, "{title}");
            assert_eq!(got_completion, completion, "{title}");
        }
    }

    #[test]
    fn slot_naming() {
        assert_eq!(slot_number("SRDR30000"), Some(0));
        assert_eq!(slot_number("SRDR30014"), Some(14));
        assert_eq!(slot_number("SRDR30015"), Some(15));
        assert_eq!(slot_number("SRDR3001"), None);
        assert_eq!(slot_number("SRDR30000_1"), None);
        assert_eq!(slot_number("SRDR30000.bak"), None);
        assert_eq!(slot_number("PRDR31234567890"), None);
        assert_eq!(slot_number("SRDR3+001"), None);

        let files = vec![
            save("SRDR30014", "A (1.0%)", 1_731_906_434),
            save("SRDR30020", "B (2.0%)", 1_731_906_434),
        ];
        let slots = read_slots(&files);
        let kinds: Vec<(&str, SlotKind)> = slots
            .iter()
            .map(|slot| (slot.id.as_str(), slot.kind))
            .collect();
        assert_eq!(
            kinds,
            vec![("slot15", SlotKind::Manual), ("slot21", SlotKind::Unknown)]
        );
    }

    #[test]
    fn truncated_or_garbage_headers_keep_the_slot_without_stats() {
        let files = vec![
            with_mtime(
                SaveFile::from_bytes(RAW_PATH, "p/SRDR30000", vec![0, 0, 0]),
                5_000,
            ),
            with_mtime(
                SaveFile::from_bytes(
                    RAW_PATH,
                    "p/SRDR30001",
                    header(0xdead_beef, "X (1.0%)", 1_731_906_434),
                ),
                6_000,
            ),
            with_mtime(
                SaveFile::from_bytes(RAW_PATH, "p/SRDR30002", header(4, "", 12)),
                7_000,
            ),
            with_mtime(SaveFile::from_bytes(RAW_PATH, "p/SRDR30003", vec![]), 8_000),
        ];
        let mut bad_utf16 = header(4, "", 1_731_906_434);
        bad_utf16[4..6].copy_from_slice(&0xd800u16.to_le_bytes());
        bad_utf16[6..8].copy_from_slice(&u16::from(b'A').to_le_bytes());
        let mut files = files;
        files.push(with_mtime(
            SaveFile::from_bytes(RAW_PATH, "p/SRDR30004", bad_utf16),
            9_000,
        ));

        let slots = read_slots(&files);
        assert_eq!(slots.len(), 5);
        for slot in &slots {
            assert_eq!(slot.title, None, "{}", slot.id);
            assert!(slot.stats.is_empty(), "{}", slot.id);
        }
        let saved_at = |id: &str| slots.iter().find(|slot| slot.id == id).unwrap().saved_at_ms;
        assert_eq!(saved_at("slot1"), Some(5_000));
        assert_eq!(saved_at("slot2"), Some(6_000));
        assert_eq!(saved_at("slot3"), Some(7_000));
        assert_eq!(saved_at("slot4"), Some(8_000));
        assert_eq!(saved_at("slot5"), Some(1_731_906_434_000));
    }

    #[test]
    fn prefers_a_close_mtime_over_the_header_clock() {
        let header_ms = 1_731_906_434_000;
        let files = vec![
            with_mtime(
                save("SRDR30000", "A (1.0%)", 1_731_906_434),
                header_ms - 3_599_000,
            ),
            with_mtime(
                save("SRDR30001", "B (2.0%)", 1_731_906_434),
                header_ms + 86_400_000,
            ),
        ];
        let slots = read_slots(&files);
        let saved_at = |id: &str| slots.iter().find(|slot| slot.id == id).unwrap().saved_at_ms;
        assert_eq!(saved_at("slot1"), Some(header_ms - 3_599_000));
        assert_eq!(saved_at("slot2"), Some(header_ms));
    }

    #[test]
    fn title_cut_before_the_timestamp_still_parses() {
        let full = header(4, "Tilly (97.1%) - 11/02/26 18:08:52", 1_731_906_434);
        let file = SaveFile::from_bytes(RAW_PATH, "SRDR30003", full[..60].to_vec());
        let slots = read_slots(&[file]);
        assert_eq!(
            slots[0].stat(StatKind::Completion),
            Some(&StatValue::Percent(97.1))
        );
        assert_eq!(slots[0].saved_at_ms, None);
    }

    #[test]
    fn uses_the_folder_with_the_newest_save() {
        let files = vec![
            save("profile/profile/SRDR30000", "Old (10.0%)", 1_731_000_000),
            save("profile/profile/SRDR30005", "Stray (20.0%)", 1_731_100_000),
            save("profile/SRDR30000", "Old (10.0%)", 1_731_000_000),
            save("profile/SRDR30015", "(Autosave) New (30.0%)", 1_731_200_000),
            save(
                "Red Dead Redemption 2/profile/SRDR30000",
                "Old (10.0%)",
                1_731_000_000,
            ),
        ];
        let slots = read_slots(&files);
        let ids: Vec<&str> = slots.iter().map(|slot| slot.id.as_str()).collect();
        assert_eq!(ids, vec!["slot1", "autosave"]);
        assert!(slots
            .iter()
            .all(|slot| slot.files[0].starts_with("profile/SRDR3")));

        let tie = vec![
            save("a/b/SRDR30000", "Same (10.0%)", 1_731_000_000),
            save("a/SRDR30000", "Same (10.0%)", 1_731_000_000),
        ];
        assert_eq!(read_slots(&tie)[0].files, vec!["a/SRDR30000".to_owned()]);
    }

    #[test]
    fn no_saves_means_no_slots() {
        let files = vec![SaveFile::from_bytes(
            RAW_PATH,
            "profile/ProfileSettings",
            vec![0; 16],
        )];
        assert!(read_slots(&files).is_empty());
    }
}
