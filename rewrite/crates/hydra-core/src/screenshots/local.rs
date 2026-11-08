//! LocalScreenshot (types/screenshot.types.ts) and the helpers around it:
//! local-screenshot-owner.ts, local-screenshot-game.ts, screenshot-draft.ts.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::preferences::normalize_description;

/// A screenshot taken in Hydra, as stored in the `screenshots` sublevel
/// (keyed by `clientId`). Fields Electron adds later survive in `extra`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalScreenshot {
    pub client_id: String,
    pub owner_id: Option<String>,
    pub shop: String,
    pub object_id: Option<String>,
    pub game_title: String,
    pub custom_game_title: Option<String>,
    pub path: String,
    pub captured_at: i64,
    pub width: u32,
    pub height: u32,
    /// local | queued | uploading | uploaded | failed | deleted
    pub state: String,
    pub is_spoiler: bool,
    /// PUBLIC | FRIENDS | PRIVATE
    pub visibility: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comments_enabled: Option<bool>,
    pub screenshot_id: Option<String>,
    /// PENDING | APPROVED | BLOCKED
    pub moderation_status: Option<String>,
    pub moderation_reason: Option<String>,
    pub upload_progress: Option<f64>,
    pub last_error: Option<String>,
    pub game_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_marker_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upload_quality: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upload_quality_fallback: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upload_client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upload_attempts: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upload_game_waits: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upload_moderation_waits: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upload_capacity_waits: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upload_rate_limit_waits: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_upload_attempt_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uploaded_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_complete_screenshot_id: Option<String>,
    /// ScreenshotTextModeration: { title?, description? }
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_moderation: Option<Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

pub mod state {
    pub const LOCAL: &str = "local";
    pub const QUEUED: &str = "queued";
    pub const UPLOADING: &str = "uploading";
    pub const UPLOADED: &str = "uploaded";
    pub const FAILED: &str = "failed";
    pub const DELETED: &str = "deleted";
}

impl LocalScreenshot {
    /// isActiveUploadState
    pub fn is_active_upload(&self) -> bool {
        self.state == state::QUEUED || self.state == state::UPLOADING
    }

    /// isLocalScreenshotPending: not uploaded nor deleted.
    pub fn is_pending(&self) -> bool {
        self.state != state::UPLOADED && self.state != state::DELETED
    }

    /// isPublishedLocalScreenshot
    pub fn is_published(&self) -> bool {
        self.state == state::UPLOADED
            && self
                .screenshot_id
                .as_deref()
                .is_some_and(|id| !id.is_empty())
    }

    /// matchesLocalScreenshotGame
    pub fn matches_game(&self, shop: &str, object_id: &str) -> bool {
        self.shop == shop && self.object_id.as_deref() == Some(object_id)
    }

    /// isLocalScreenshotFileForGame: a file Hydra still keeps for the game.
    pub fn is_file_for_game(&self, shop: &str, object_id: &str) -> bool {
        self.matches_game(shop, object_id)
            && matches!(
                self.state.as_str(),
                state::LOCAL | state::QUEUED | state::UPLOADING | state::FAILED | state::UPLOADED
            )
    }

    /// isUnpublishedLocalFile
    pub fn is_unpublished_file(&self) -> bool {
        self.state != state::UPLOADED && self.state != state::DELETED
    }

    /// isLocalScreenshotVisibleToOwner: captured signed out, or by this user.
    pub fn is_visible_to(&self, owner_id: Option<&str>) -> bool {
        self.owner_id.is_none() || self.owner_id.as_deref() == owner_id
    }
}

/// getPublishedScreenshotIds: the server ids of this user's uploaded (or
/// deleted after upload) screenshots of a game.
pub fn published_screenshot_ids(
    screenshots: &[LocalScreenshot],
    shop: &str,
    object_id: &str,
    owner_id: &str,
) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for screenshot in screenshots {
        let Some(id) = screenshot
            .screenshot_id
            .as_deref()
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        if screenshot.shop == shop
            && screenshot.object_id.as_deref() == Some(object_id)
            && screenshot.owner_id.as_deref() == Some(owner_id)
            && (screenshot.state == state::UPLOADED || screenshot.state == state::DELETED)
            && !ids.iter().any(|existing| existing == id)
        {
            ids.push(id.to_string());
        }
    }
    ids
}

/// findLocalScreenshotGameObjectId: back-fill a missing objectId when exactly
/// one library game of the same shop has the screenshot's title.
pub fn find_game_object_id(screenshot: &LocalScreenshot, games: &[Value]) -> Option<String> {
    if screenshot.object_id.is_some() {
        return None;
    }
    let matches: Vec<&str> = games
        .iter()
        .filter(|game| game.get("isDeleted").and_then(Value::as_bool) != Some(true))
        .filter(|game| game.get("shop").and_then(Value::as_str) == Some(screenshot.shop.as_str()))
        .filter(|game| {
            game.get("title").and_then(Value::as_str) == Some(screenshot.game_title.as_str())
        })
        .filter_map(|game| game.get("objectId").and_then(Value::as_str))
        .collect();
    (matches.len() == 1).then(|| matches[0].to_string())
}

/// LocalScreenshotUploadOptions / LocalScreenshotDraft (every field optional
/// in a draft; `custom_game_title` / `description` use Some(None) for null).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Draft {
    pub is_spoiler: Option<bool>,
    pub visibility: Option<String>,
    pub comments_enabled: Option<bool>,
    pub custom_game_title: Option<Option<String>>,
    pub description: Option<Option<String>>,
}

/// buildLocalScreenshotDraftPatch: drafts only change local or failed
/// screenshots; the custom title only for custom games.
pub fn apply_draft(current: &mut LocalScreenshot, draft: &Draft) -> bool {
    if current.state != state::LOCAL && current.state != state::FAILED {
        return false;
    }
    if let Some(value) = draft.is_spoiler {
        current.is_spoiler = value;
    }
    if let Some(value) = &draft.visibility {
        current.visibility = value.clone();
    }
    if let Some(value) = draft.comments_enabled {
        current.comments_enabled = Some(value);
    }
    if let Some(value) = &draft.custom_game_title {
        if current.shop == "custom" {
            current.custom_game_title = value
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string);
        }
    }
    if let Some(value) = &draft.description {
        current.description = normalize_description(value.as_deref());
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn shot(state: &str) -> LocalScreenshot {
        LocalScreenshot {
            client_id: "c1".into(),
            shop: "steam".into(),
            object_id: Some("10".into()),
            game_title: "Game".into(),
            state: state.into(),
            visibility: "PUBLIC".into(),
            ..Default::default()
        }
    }

    #[test]
    fn round_trips_electron_records() {
        let stored = json!({
            "clientId": "c1", "ownerId": null, "shop": "steam", "objectId": "10",
            "gameTitle": "Game", "customGameTitle": null, "path": "C:\\a.jpeg",
            "capturedAt": 1700000000000i64, "width": 1920, "height": 1080, "state": "local",
            "isSpoiler": false, "visibility": "PUBLIC", "screenshotId": null,
            "moderationStatus": null, "moderationReason": null, "uploadProgress": null,
            "lastError": null, "gameSessionId": "s", "rootMarkerId": "m",
            "previewPath": "p.jpeg", "futureField": { "x": 1 }
        });
        let parsed: LocalScreenshot = serde_json::from_value(stored.clone()).unwrap();
        assert_eq!(parsed.root_marker_id.as_deref(), Some("m"));
        assert_eq!(parsed.extra.get("futureField"), Some(&json!({ "x": 1 })));
        assert_eq!(serde_json::to_value(&parsed).unwrap(), stored);
    }

    #[test]
    fn drafts_only_touch_editable_screenshots() {
        let mut current = shot("local");
        let draft = Draft {
            is_spoiler: Some(true),
            custom_game_title: Some(Some(" X ".into())),
            description: Some(Some(" hi\n there ".into())),
            ..Default::default()
        };
        assert!(apply_draft(&mut current, &draft));
        assert!(current.is_spoiler);
        assert_eq!(current.custom_game_title, None); // not a custom game
        // the line break becomes a space; the space after it stays
        assert_eq!(current.description.as_deref(), Some("hi  there"));

        let mut custom = LocalScreenshot {
            shop: "custom".into(),
            ..shot("failed")
        };
        assert!(apply_draft(&mut custom, &draft));
        assert_eq!(custom.custom_game_title.as_deref(), Some("X"));

        let mut uploaded = shot("uploaded");
        assert!(!apply_draft(&mut uploaded, &draft));
        assert!(!uploaded.is_spoiler);
    }

    #[test]
    fn owner_and_game_helpers() {
        let mut mine = shot("uploaded");
        mine.owner_id = Some("u1".into());
        mine.screenshot_id = Some("s1".into());
        assert!(mine.is_visible_to(Some("u1")) && !mine.is_visible_to(Some("u2")));
        assert!(shot("local").is_visible_to(None));
        let mut deleted = mine.clone();
        deleted.state = "deleted".into();
        let ids =
            published_screenshot_ids(&[mine.clone(), deleted, shot("local")], "steam", "10", "u1");
        assert_eq!(ids, vec!["s1"]);
        assert!(mine.is_file_for_game("steam", "10") && !mine.is_unpublished_file());

        let mut missing = shot("local");
        missing.object_id = None;
        let games = vec![
            json!({ "shop": "steam", "title": "Game", "objectId": "10", "isDeleted": false }),
            json!({ "shop": "steam", "title": "Game", "objectId": "11", "isDeleted": true }),
        ];
        assert_eq!(find_game_object_id(&missing, &games).as_deref(), Some("10"));
        let games = vec![
            json!({ "shop": "steam", "title": "Game", "objectId": "10" }),
            json!({ "shop": "steam", "title": "Game", "objectId": "11" }),
        ];
        assert_eq!(find_game_object_id(&missing, &games), None);
    }
}
