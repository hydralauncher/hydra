//! Achievement files that Steam emulators keep next to the save (RUNE and CODEX
//! `achievements.ini`, OnlineFix `Stats/achievements.ini`, GSE and Goldberg
//! `achievements.json`). They work for any game, so they back the profile stats.

use serde_json::Value;

use crate::model::{Stat, StatKind, StatValue};
use crate::source::SaveFile;

pub const ID: &str = "emulator-achievements";
pub const VERSION: u32 = 1;

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct Unlocks {
    count: u32,
    last_unlocked_at_s: Option<i64>,
}

pub fn read_profile(files: &[SaveFile]) -> Vec<Stat> {
    let best = files
        .iter()
        .filter_map(read_unlocks)
        .max_by_key(|unlocks| (unlocks.count, unlocks.last_unlocked_at_s));
    match best {
        Some(unlocks) if unlocks.count > 0 => {
            vec![Stat::new(
                StatKind::Achievements,
                StatValue::Integer(i64::from(unlocks.count)),
            )]
        }
        _ => Vec::new(),
    }
}

fn read_unlocks(file: &SaveFile) -> Option<Unlocks> {
    let name = file.file_name().to_ascii_lowercase();
    if name != "achievements.ini" && name != "achievements.json" {
        return None;
    }
    let bytes = file.read_prefix(MAX_FILE_BYTES).ok()?;
    let text = String::from_utf8_lossy(crate::util::strip_bom(&bytes)).into_owned();
    if name.ends_with(".json") {
        read_json(&text)
    } else {
        Some(read_ini(&text))
    }
}

fn read_json(text: &str) -> Option<Unlocks> {
    let Value::Object(entries) = serde_json::from_str::<Value>(text).ok()? else {
        return None;
    };
    let mut unlocks = Unlocks::default();
    for entry in entries.values() {
        if entry.get("earned").and_then(Value::as_bool) == Some(true) {
            unlocks.count += 1;
            let time = entry
                .get("earned_time")
                .and_then(Value::as_i64)
                .filter(|time| *time > 0);
            unlocks.last_unlocked_at_s = unlocks.last_unlocked_at_s.max(time);
        }
    }
    Some(unlocks)
}

/// Each `[section]` is one achievement, except the RUNE/CODEX `[SteamAchievements]` index.
fn read_ini(text: &str) -> Unlocks {
    let mut unlocks = Unlocks::default();
    let mut section: Option<(bool, Option<i64>)> = None;
    let mut flush = |section: &mut Option<(bool, Option<i64>)>| {
        if let Some((true, time)) = section.take() {
            unlocks.count += 1;
            unlocks.last_unlocked_at_s = unlocks
                .last_unlocked_at_s
                .max(time.filter(|time| *time > 0));
        }
    };
    for line in text.lines().map(str::trim) {
        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            flush(&mut section);
            section = (!name.eq_ignore_ascii_case("SteamAchievements")).then_some((false, None));
            continue;
        }
        let (Some(current), Some((key, value))) = (section.as_mut(), line.split_once('=')) else {
            continue;
        };
        match key.trim().to_ascii_lowercase().as_str() {
            "achieved" => current.0 = matches!(value.trim(), "1" | "true" | "True"),
            "unlocktime" | "timestamp" => current.1 = value.trim().parse().ok(),
            _ => {}
        }
    }
    flush(&mut section);
    unlocks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stat_count(stats: &[Stat]) -> Option<i64> {
        match stats.first()?.value {
            StatValue::Integer(count) => Some(count),
            _ => None,
        }
    }

    #[test]
    fn reads_rune_ini() {
        let ini = "[SteamAchievements]\r\n00000=A\r\n00001=B\r\nCount=2\r\n\r\n[A]\r\nAchieved=1\r\nUnlockTime=1700000000\r\n\r\n[B]\r\nAchieved=0\r\nUnlockTime=0\r\n";
        assert_eq!(
            read_ini(ini),
            Unlocks {
                count: 1,
                last_unlocked_at_s: Some(1_700_000_000)
            }
        );
    }

    #[test]
    fn reads_online_fix_ini() {
        let ini = "[ACH39]\nachieved=true\ntimestamp=100\n\n[ACH25]\nachieved=true\ntimestamp=300\n[ACH01]\nachieved=false\n";
        assert_eq!(
            read_ini(ini),
            Unlocks {
                count: 2,
                last_unlocked_at_s: Some(300)
            }
        );
    }

    #[test]
    fn reads_gse_json() {
        let json = r#"{"a":{"earned":true,"earned_time":5},"b":{"earned":false,"earned_time":0},"c":{"earned":true,"earned_time":9}}"#;
        assert_eq!(
            read_json(json),
            Some(Unlocks {
                count: 2,
                last_unlocked_at_s: Some(9)
            })
        );
    }

    #[test]
    fn keeps_the_file_with_most_unlocks() {
        let files = [
            SaveFile::from_bytes(
                "<winPublic>/Documents/Steam/RUNE/1",
                "achievements.ini",
                b"[A]\nAchieved=1\n".to_vec(),
            ),
            SaveFile::from_bytes(
                "<winAppData>/GSE Saves/1",
                "achievements.json",
                br#"{"a":{"earned":true},"b":{"earned":true}}"#.to_vec(),
            ),
            SaveFile::from_bytes("<base>", "save/achievements.json", b"not json".to_vec()),
        ];
        assert_eq!(stat_count(&read_profile(&files)), Some(2));
    }

    #[test]
    fn no_unlocks_means_no_stat() {
        let files = [SaveFile::from_bytes(
            "<base>",
            "achievements.ini",
            b"[A]\nAchieved=0\n".to_vec(),
        )];
        assert!(read_profile(&files).is_empty());
    }
}
