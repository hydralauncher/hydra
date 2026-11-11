use serde::{Deserialize, Serialize};

/// Bumped when the JSON shape changes in a way older readers cannot ignore.
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSummary {
    pub schema_version: u32,
    /// `id@version` of every parser that contributed, so a stored summary can be recomputed when one changes.
    pub parsers: Vec<String>,
    /// Stats about the whole snapshot rather than one slot, such as achievements unlocked.
    pub profile: Vec<Stat>,
    /// Newest first, with `Profile` slots last.
    pub slots: Vec<SaveSlot>,
}

impl SaveSummary {
    pub fn latest(&self) -> Option<&SaveSlot> {
        self.slots.first()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSlot {
    /// Stable inside one game, so both sides of a conflict can be matched slot by slot.
    pub id: String,
    pub kind: SlotKind,
    /// The name the game shows for this save, when it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved_at_ms: Option<i64>,
    /// Same value on every slot of one character or run, so the UI can tell two different runs apart.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playthrough: Option<String>,
    pub stats: Vec<Stat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<Thumbnail>,
    /// Relative paths of the snapshot files this slot was read from.
    pub files: Vec<String>,
}

impl SaveSlot {
    pub fn stat(&self, kind: StatKind) -> Option<&StatValue> {
        self.stats
            .iter()
            .find(|stat| stat.kind == kind)
            .map(|stat| &stat.value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SlotKind {
    Manual,
    Auto,
    Quick,
    /// A save the game makes before an irreversible choice.
    PointOfNoReturn,
    /// A save made after the credits.
    EndGame,
    /// Profile-wide progress that is not tied to one save slot.
    Profile,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stat {
    pub kind: StatKind,
    pub value: StatValue,
    /// The game's own name for this stat ("Eddies" for money), when it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<StatName>,
}

impl Stat {
    pub fn new(kind: StatKind, value: StatValue) -> Self {
        Self {
            kind,
            value,
            name: None,
        }
    }

    pub fn named(mut self, name: StatName) -> Self {
        self.name = Some(name);
        self
    }
}

/// The launcher translates `key`; `text` is the English fallback.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatName {
    pub key: String,
    pub text: String,
}

/// A closed vocabulary, so the launcher can label and order stats without per-game code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StatKind {
    Playtime,
    Level,
    Chapter,
    /// The in-game calendar day.
    InGameDay,
    Quest,
    /// Main story quests finished.
    QuestsCompleted,
    Objective,
    Location,
    Completion,
    Money,
    Difficulty,
    /// New Game+ cycle: 1 for the first NG+, 2 for NG+2. Absent on a first run.
    NewGamePlus,
    CharacterName,
    CharacterClass,
    Reputation,
    Collectibles,
    Deaths,
    Content,
    GameVersion,
    Achievements,
    /// Heart pieces or crystal hearts collected, as progress when the total is known.
    Hearts,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type", content = "value")]
pub enum StatValue {
    Integer(i64),
    /// Written by the game, shown as-is.
    Text(String),
    Seconds(u64),
    Percent(f64),
    Progress {
        current: u32,
        total: u32,
    },
    List(Vec<String>),
    /// The launcher translates `key`, and `text` is the English fallback.
    Label {
        key: String,
        text: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumbnail {
    /// Relative path of the snapshot file that holds the image.
    pub file: String,
    pub mime_type: String,
    /// Byte range inside `file` when the image is embedded in a larger save file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<ByteRange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ByteRange {
    pub offset: u64,
    pub length: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_and_new_kinds_serialize_for_the_launcher() {
        let label = StatValue::Label {
            key: "game.field.text".to_owned(),
            text: "Text".to_owned(),
        };
        assert_eq!(
            serde_json::to_value(&label).unwrap(),
            serde_json::json!({"type": "label", "value": {"key": "game.field.text", "text": "Text"}})
        );
        assert_eq!(
            serde_json::to_value(StatKind::InGameDay).unwrap(),
            serde_json::json!("inGameDay")
        );
    }
}
