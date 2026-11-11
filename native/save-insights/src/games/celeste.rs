//! Celeste: one plain XML file per save file (`0.celeste`, `1.celeste`, `2.celeste`) written by
//! .NET's XmlSerializer. Totals sit near the top; `<Areas>` holds one `AreaStats` per chapter with
//! an `AreaModeStats` per side (A, B, C). Everest mod saves (`N-mod*.celeste`) are ignored.

use crate::games::{label, newest_modified_at, Parser};
use crate::model::{SaveSlot, SlotKind, Stat, StatKind, StatValue};
use crate::source::SaveFile;

pub const PARSER: Parser = Parser {
    id: "celeste",
    version: 1,
    steam_app_ids: &["504230"],
    read_slots,
    labels,
    read_profile: crate::games::no_profile,
    stat_names: &[
        (StatKind::Collectibles, "Strawberries"),
        (StatKind::Hearts, "Crystal hearts"),
        (StatKind::QuestsCompleted, "Chapters cleared"),
    ],
};

const LABEL_PREFIX: &str = "celeste";
const MAX_SAVE_BYTES: u64 = 8 * 1024 * 1024;
const TICKS_PER_SECOND: u64 = 10_000_000;
const TOTAL_HEARTS: u32 = 24;

/// Indexed by area id: the chapter name per side. Prologue and Epilogue have no B or C side.
const AREAS: [[Option<&str>; 3]; 11] = [
    [Some("Prologue"), None, None],
    [
        Some("Forsaken City"),
        Some("Forsaken City B-Side"),
        Some("Forsaken City C-Side"),
    ],
    [
        Some("Old Site"),
        Some("Old Site B-Side"),
        Some("Old Site C-Side"),
    ],
    [
        Some("Celestial Resort"),
        Some("Celestial Resort B-Side"),
        Some("Celestial Resort C-Side"),
    ],
    [
        Some("Golden Ridge"),
        Some("Golden Ridge B-Side"),
        Some("Golden Ridge C-Side"),
    ],
    [
        Some("Mirror Temple"),
        Some("Mirror Temple B-Side"),
        Some("Mirror Temple C-Side"),
    ],
    [
        Some("Reflection"),
        Some("Reflection B-Side"),
        Some("Reflection C-Side"),
    ],
    [
        Some("The Summit"),
        Some("The Summit B-Side"),
        Some("The Summit C-Side"),
    ],
    [Some("Epilogue"), None, None],
    [Some("Core"), Some("Core B-Side"), Some("Core C-Side")],
    [Some("Farewell"), None, None],
];

/// Area ids of the numbered chapters 1 to 9 (Core is chapter 8, Farewell chapter 9).
const STORY_CHAPTERS: [usize; 9] = [1, 2, 3, 4, 5, 6, 7, 9, 10];

const MODES: [&str; 3] = ["Assist Mode", "Variant Mode", "Cheat Mode"];

fn labels() -> Vec<(&'static str, &'static str)> {
    let chapters = AREAS
        .iter()
        .flatten()
        .flatten()
        .map(|&text| ("chapter", text));
    chapters
        .chain(MODES.iter().map(|&text| ("mode", text)))
        .collect()
}

fn read_slots(files: &[SaveFile]) -> Vec<SaveSlot> {
    let mut slots: Vec<SaveSlot> = Vec::new();
    for file in files {
        let Some(number) = save_number(file.file_name()) else {
            continue;
        };
        let Some(slot) = read_slot(file, number) else {
            continue;
        };
        match slots.iter_mut().find(|existing| existing.id == slot.id) {
            Some(existing) if existing.saved_at_ms < slot.saved_at_ms => *existing = slot,
            Some(_) => {}
            None => slots.push(slot),
        }
    }
    slots
}

fn save_number(name: &str) -> Option<u32> {
    let number = name.strip_suffix(".celeste")?;
    if number.is_empty() || number.len() > 2 || !number.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    number.parse().ok()
}

fn read_slot(file: &SaveFile, number: u32) -> Option<SaveSlot> {
    let bytes = file.read_prefix(MAX_SAVE_BYTES).ok()?;
    let xml = std::str::from_utf8(crate::util::strip_bom(&bytes)).ok()?;
    let root = xml.find("<SaveData")?;
    let areas_at = xml[root..]
        .find("<Areas>")
        .map_or(xml.len(), |offset| root + offset);
    let totals = &xml[root..areas_at];
    let totals = &totals[..totals.find("<CurrentSession").unwrap_or(totals.len())];

    let mut stats = Vec::new();
    let areas = read_areas(&xml[areas_at..]);
    if let Some((area, mode)) = last_area(totals) {
        if let Some(text) = AREAS
            .get(area)
            .and_then(|sides| sides.get(mode).copied().flatten())
        {
            stats.push(Stat::new(
                StatKind::Chapter,
                label(LABEL_PREFIX, "chapter", text),
            ));
        }
    }
    if let Some(ticks) = element(totals, "Time").and_then(|text| text.parse::<u64>().ok()) {
        stats.push(Stat::new(
            StatKind::Playtime,
            StatValue::Seconds(ticks / TICKS_PER_SECOND),
        ));
    }
    if !areas.is_empty() {
        let cleared = STORY_CHAPTERS
            .iter()
            .filter(|&&id| {
                areas
                    .iter()
                    .any(|area| area.id == id && area.a_side_completed)
            })
            .count();
        stats.push(Stat::new(
            StatKind::QuestsCompleted,
            StatValue::Progress {
                current: cleared as u32,
                total: STORY_CHAPTERS.len() as u32,
            },
        ));
    }
    if let Some(strawberries) =
        element(totals, "TotalStrawberries").and_then(|text| text.parse().ok())
    {
        stats.push(Stat::new(
            StatKind::Collectibles,
            StatValue::Integer(strawberries),
        ));
    }
    if !areas.is_empty() {
        let hearts: u32 = areas.iter().map(|area| area.hearts).sum();
        stats.push(Stat::new(
            StatKind::Hearts,
            StatValue::Progress {
                current: hearts.min(TOTAL_HEARTS),
                total: TOTAL_HEARTS,
            },
        ));
    }
    if let Some(deaths) = element(totals, "TotalDeaths").and_then(|text| text.parse().ok()) {
        stats.push(Stat::new(StatKind::Deaths, StatValue::Integer(deaths)));
    }
    for (tag, text) in [
        ("AssistMode", MODES[0]),
        ("VariantMode", MODES[1]),
        ("CheatMode", MODES[2]),
    ] {
        if element(totals, tag) == Some("true") {
            stats.push(Stat::new(
                StatKind::Difficulty,
                label(LABEL_PREFIX, "mode", text),
            ));
            break;
        }
    }
    if stats.is_empty() {
        return None;
    }

    Some(SaveSlot {
        id: format!("file-{}", number + 1),
        kind: SlotKind::Auto,
        title: element(totals, "Name")
            .map(unescape)
            .filter(|name| !name.trim().is_empty()),
        saved_at_ms: newest_modified_at(&[file]),
        playthrough: None,
        stats,
        thumbnail: None,
        files: vec![file.relative_path.clone()],
    })
}

struct Area {
    id: usize,
    a_side_completed: bool,
    hearts: u32,
}

/// Vanilla chapters only: modded level sets carry an `SID` outside `Celeste/`.
fn read_areas(xml: &str) -> Vec<Area> {
    let mut areas = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<AreaStats ") {
        rest = &rest[start..];
        let Some(head_end) = rest.find('>') else {
            break;
        };
        let head = &rest[..head_end];
        let body_end = rest[head_end..]
            .find("</AreaStats>")
            .map_or(rest.len(), |offset| head_end + offset);
        let body = &rest[head_end..body_end];
        let vanilla = attribute(head, "SID").is_none_or(|sid| sid.starts_with("Celeste/"));
        if let (true, Some(id)) = (
            vanilla,
            attribute(head, "ID").and_then(|id| id.parse().ok()),
        ) {
            let modes: Vec<&str> = body
                .split("<AreaModeStats ")
                .skip(1)
                .map(|mode| &mode[..mode.find('>').unwrap_or(mode.len())])
                .collect();
            if id < AREAS.len() {
                areas.push(Area {
                    id,
                    a_side_completed: modes
                        .first()
                        .is_some_and(|mode| attribute(mode, "Completed") == Some("true")),
                    hearts: modes
                        .iter()
                        .take(3)
                        .filter(|mode| attribute(mode, "HeartGem") == Some("true"))
                        .count() as u32,
                });
            }
        }
        rest = &rest[body_end.min(rest.len())..];
        if rest.len() <= "</AreaStats>".len() {
            break;
        }
        rest = &rest[1..];
    }
    areas
}

fn last_area(totals: &str) -> Option<(usize, usize)> {
    let start = totals.find("<LastArea ")?;
    let head = &totals[start..];
    let head = &head[..head.find('>')?];
    let area = attribute(head, "ID")?.parse().ok()?;
    let mode = match attribute(head, "Mode")? {
        "Normal" => 0,
        "BSide" => 1,
        "CSide" => 2,
        _ => return None,
    };
    Some((area, mode))
}

fn element<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = start + xml[start..].find(&format!("</{tag}>"))?;
    Some(xml[start..end].trim())
}

fn attribute<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    let needle = format!(" {name}=\"");
    let start = head.find(&needle)? + needle.len();
    let end = start + head[start..].find('"')?;
    Some(&head[start..end])
}

fn unescape(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::cataloged_label;

    const RAW_PATH: &str = "<base>/Saves/*.celeste";

    fn mode(completed: bool, heart: bool) -> String {
        format!(
            r#"<AreaModeStats TotalStrawberries="0" Completed="{completed}" Deaths="3" HeartGem="{heart}"><Strawberries /><Checkpoints /></AreaModeStats>"#
        )
    }

    fn area(id: usize, sid: Option<&str>, sides: [(bool, bool); 3]) -> String {
        let sid = sid
            .map(|sid| format!(r#" SID="{sid}""#))
            .unwrap_or_default();
        let modes: String = sides
            .iter()
            .map(|&(completed, heart)| mode(completed, heart))
            .collect();
        format!(r#"<AreaStats ID="{id}" Cassette="false"{sid}><Modes>{modes}</Modes></AreaStats>"#)
    }

    fn save(name: &str, last: (u32, &str), assist: bool, areas: &str) -> Vec<u8> {
        format!(
            "\u{feff}<?xml version=\"1.0\"?>\n<SaveData xmlns:xsi=\"x\">\n  <Version>1.4.0.0</Version>\n  <Name>{name}</Name>\n  <Time>301230000000</Time>\n  <CheatMode>false</CheatMode>\n  <AssistMode>{assist}</AssistMode>\n  <VariantMode>false</VariantMode>\n  <UnlockedAreas>4</UnlockedAreas>\n  <TotalDeaths>1120</TotalDeaths>\n  <TotalStrawberries>57</TotalStrawberries>\n  <LastArea ID=\"{}\" Mode=\"{}\" />\n  <CurrentSession Level=\"3\"><Strawberries><EntityID Key=\"1:2\" /></Strawberries><Name>Not this</Name></CurrentSession>\n  <Areas>{areas}</Areas>\n  <TotalStrawberries>999</TotalStrawberries>\n</SaveData>",
            last.0, last.1
        )
        .into_bytes()
    }

    fn file(number: u32, bytes: Vec<u8>, modified_at_ms: Option<i64>) -> SaveFile {
        let mut file = SaveFile::from_bytes(RAW_PATH, &format!("{number}.celeste"), bytes);
        file.modified_at_ms = modified_at_ms;
        file
    }

    fn areas() -> String {
        let none = (false, false);
        [
            area(0, None, [(true, false), none, none]),
            area(1, None, [(true, true), (true, true), none]),
            area(2, None, [(true, false), none, none]),
            area(3, None, [(false, false), none, none]),
            area(
                4,
                Some("SomeMod/1-Map"),
                [(true, true), (true, true), (true, true)],
            ),
        ]
        .concat()
    }

    #[test]
    fn reads_a_save_file() {
        let slots = read_slots(&[file(
            0,
            save("Madeline &amp; Theo", (3, "Normal"), false, &areas()),
            Some(5),
        )]);
        assert_eq!(slots.len(), 1);
        let slot = &slots[0];
        assert_eq!((slot.id.as_str(), slot.kind), ("file-1", SlotKind::Auto));
        assert_eq!(slot.title.as_deref(), Some("Madeline & Theo"));
        assert_eq!(slot.saved_at_ms, Some(5));
        assert_eq!(
            slot.stat(StatKind::Chapter),
            Some(&cataloged_label(
                "celeste.chapter.celestial_resort",
                "Celestial Resort"
            ))
        );
        assert_eq!(
            slot.stat(StatKind::Playtime),
            Some(&StatValue::Seconds(30_123))
        );
        assert_eq!(
            slot.stat(StatKind::QuestsCompleted),
            Some(&StatValue::Progress {
                current: 2,
                total: 9
            })
        );
        assert_eq!(
            slot.stat(StatKind::Collectibles),
            Some(&StatValue::Integer(57))
        );
        assert_eq!(
            slot.stat(StatKind::Hearts),
            Some(&StatValue::Progress {
                current: 2,
                total: 24
            })
        );
        assert_eq!(slot.stat(StatKind::Deaths), Some(&StatValue::Integer(1120)));
        assert_eq!(slot.stat(StatKind::Difficulty), None);
    }

    #[test]
    fn side_and_assist_mode() {
        let slots = read_slots(&[file(2, save("A", (6, "BSide"), true, &areas()), None)]);
        assert_eq!(slots[0].id, "file-3");
        assert_eq!(
            slots[0].stat(StatKind::Chapter),
            Some(&cataloged_label(
                "celeste.chapter.reflection_b_side",
                "Reflection B-Side"
            ))
        );
        assert_eq!(
            slots[0].stat(StatKind::Difficulty),
            Some(&cataloged_label("celeste.mode.assist_mode", "Assist Mode"))
        );
    }

    #[test]
    fn side_a_chapter_without_b_side_drops_the_chapter() {
        let slots = read_slots(&[file(0, save("A", (10, "BSide"), false, &areas()), None)]);
        assert_eq!(slots[0].stat(StatKind::Chapter), None);
        assert!(slots[0].stat(StatKind::Playtime).is_some());
    }

    #[test]
    fn mod_files_and_settings_are_ignored() {
        let bytes = save("A", (1, "Normal"), false, &areas());
        let files = [
            SaveFile::from_bytes(RAW_PATH, "settings.celeste", bytes.clone()),
            SaveFile::from_bytes(RAW_PATH, "0-modsavedata.celeste", bytes.clone()),
            SaveFile::from_bytes(RAW_PATH, "modsettings-Everest.celeste", bytes),
        ];
        assert!(read_slots(&files).is_empty());
    }

    #[test]
    fn newest_copy_of_a_file_wins() {
        let older = file(0, save("Old", (1, "Normal"), false, ""), Some(1));
        let mut newer = file(0, save("New", (2, "Normal"), false, ""), Some(2));
        newer.raw_path = "<winAppData>/GSE Saves/504230".to_owned();
        let slots = read_slots(&[older, newer]);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].title.as_deref(), Some("New"));
    }

    #[test]
    fn garbage_and_truncated_files_give_nothing_or_less() {
        assert!(read_slots(&[file(0, b"not xml".to_vec(), None)]).is_empty());
        assert!(read_slots(&[file(0, vec![0xff, 0xfe, 0x00], None)]).is_empty());
        let full = save("A", (3, "Normal"), false, &areas());
        for cut in (0..full.len()).step_by(37) {
            let _ = read_slots(&[file(0, full[..cut].to_vec(), None)]);
        }
    }

    #[test]
    fn save_numbers() {
        assert_eq!(save_number("0.celeste"), Some(0));
        assert_eq!(save_number("12.celeste"), Some(12));
        assert_eq!(save_number("settings.celeste"), None);
        assert_eq!(save_number("0-modsave-Everest.celeste"), None);
        assert_eq!(save_number(".celeste"), None);
    }
}
