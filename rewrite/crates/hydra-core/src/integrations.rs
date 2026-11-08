//! Store integrations, the logic without UI: the Steam card's view state and
//! sync progress (settings-steam-state.ts, settings-integration-progress.ts),
//! shouldAutoStartSteamSync, the Steam OpenID return parsing
//! (steam-openid-return.ts), the imported-games cleanup rules
//! (steam-imported-games.ts), the Epic card's presentation
//! (settings-epic-state.ts) and the RetroAchievements connect errors
//! (retroachievements-integration.ts).

use serde_json::{Map, Value};

type Obj = Map<String, Value>;

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn flag(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool) == Some(true)
}

// ---- Steam --------------------------------------------------------------

/// GET /profile/integrations/steam
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SteamStatus {
    pub connected: bool,
    pub snapshot_preserved: bool,
    pub steam_id64: String,
    pub username: String,
    pub avatar_url: String,
    pub last_synced_at: Option<String>,
    /// latestSyncRun.status: PENDING | RUNNING | SUCCEEDED | FAILED
    pub latest_sync_run_status: Option<String>,
    pub latest_sync_run_id: Option<String>,
}

impl SteamStatus {
    pub fn parse(value: &Value) -> Self {
        let run = value.get("latestSyncRun").filter(|r| r.is_object());
        Self {
            connected: flag(value, "connected"),
            snapshot_preserved: flag(value, "snapshotPreserved"),
            steam_id64: text(value, "steamId64").unwrap_or_default().to_string(),
            username: text(value, "username").unwrap_or_default().to_string(),
            avatar_url: text(value, "avatarUrl").unwrap_or_default().to_string(),
            last_synced_at: text(value, "lastSyncedAt").map(str::to_string),
            latest_sync_run_status: run.and_then(|r| text(r, "status")).map(str::to_string),
            latest_sync_run_id: run.and_then(|r| text(r, "id")).map(str::to_string),
        }
    }

    /// The account fields the card shows (connected or a preserved snapshot).
    pub fn has_account(&self) -> bool {
        self.connected || self.snapshot_preserved
    }

    /// getLatestSyncRunStatus
    pub fn latest_run_status(&self) -> Option<&str> {
        if self.has_account() {
            self.latest_sync_run_status.as_deref()
        } else {
            None
        }
    }
}

/// SteamSyncPhase
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SteamPhase {
    Starting,
    Library,
    Achievements,
    Publishing,
    Merging,
    Executables,
    Finishing,
}

impl SteamPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Library => "library",
            Self::Achievements => "achievements",
            Self::Publishing => "publishing",
            Self::Merging => "merging",
            Self::Executables => "executables",
            Self::Finishing => "finishing",
        }
    }
}

/// SteamSyncState
#[derive(Clone, Debug, PartialEq)]
pub enum SteamSync {
    Idle {
        requires_reconnect: bool,
    },
    Running {
        sync_run_id: String,
        phase: SteamPhase,
        games_found: u64,
        games_processed: u64,
    },
    Cancelling {
        sync_run_id: String,
    },
}

impl Default for SteamSync {
    fn default() -> Self {
        Self::Idle {
            requires_reconnect: false,
        }
    }
}

impl SteamSync {
    pub fn is_syncing(&self) -> bool {
        !matches!(self, Self::Idle { .. })
    }
    pub fn requires_reconnect(&self) -> bool {
        matches!(
            self,
            Self::Idle {
                requires_reconnect: true
            }
        )
    }
}

/// SteamIntegrationViewState
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SteamView {
    Disconnected,
    Connected,
    ReconnectRequired,
    SnapshotPreserved,
}

/// getSteamIntegrationPresentation: (view, status key, tone)
pub fn steam_presentation(
    status: &SteamStatus,
    sync: &SteamSync,
) -> (SteamView, &'static str, &'static str) {
    let view = if !status.connected {
        if status.snapshot_preserved {
            SteamView::SnapshotPreserved
        } else {
            SteamView::Disconnected
        }
    } else if sync.requires_reconnect() {
        SteamView::ReconnectRequired
    } else {
        SteamView::Connected
    };
    match view {
        SteamView::ReconnectRequired => (view, "steam_status_reconnect_required", "warning"),
        SteamView::Connected => (view, "steam_status_connected", "success"),
        SteamView::SnapshotPreserved => (view, "steam_status_snapshot_preserved", "warning"),
        SteamView::Disconnected => (view, "integration_status_not_connected", "neutral"),
    }
}

/// getSteamProgressPresentation
#[derive(Clone, Debug, PartialEq)]
pub struct SteamProgress {
    /// None: indeterminate
    pub percentage: Option<f64>,
    pub show_count: bool,
    pub label_key: &'static str,
}

pub fn steam_progress(sync: &SteamSync) -> Option<SteamProgress> {
    let (phase, found, processed) = match sync {
        SteamSync::Idle { .. } => return None,
        SteamSync::Cancelling { .. } => {
            return Some(SteamProgress {
                percentage: None,
                show_count: false,
                label_key: "steam_syncing",
            });
        }
        SteamSync::Running {
            phase,
            games_found,
            games_processed,
            ..
        } => (*phase, *games_found, *games_processed),
    };
    let label_key = match phase {
        SteamPhase::Publishing => "steam_sync_uploading",
        SteamPhase::Merging => "steam_sync_updating_library",
        SteamPhase::Executables => "steam_sync_scanning_games",
        SteamPhase::Finishing => "steam_sync_finishing",
        _ => "steam_syncing",
    };
    let range = match phase {
        SteamPhase::Achievements => Some((0.0, 60.0)),
        SteamPhase::Publishing => Some((60.0, 70.0)),
        SteamPhase::Merging => Some((70.0, 95.0)),
        SteamPhase::Executables => Some((95.0, 100.0)),
        SteamPhase::Finishing => Some((100.0, 100.0)),
        _ => None,
    };
    let known_total = found > 0;
    let Some((start, end)) = range.filter(|_| phase != SteamPhase::Achievements || known_total)
    else {
        return Some(SteamProgress {
            percentage: None,
            show_count: false,
            label_key,
        });
    };
    let fraction = if known_total {
        (processed as f64 / found as f64).clamp(0.0, 1.0)
    } else {
        0.0
    };
    Some(SteamProgress {
        percentage: Some(start + (end - start) * fraction),
        show_count: known_total
            && matches!(
                phase,
                SteamPhase::Achievements | SteamPhase::Merging | SteamPhase::Executables
            ),
        label_key,
    })
}

/// shouldAutoStartSteamSync
pub fn should_auto_start_steam_sync(
    connected: bool,
    last_synced_at: Option<&str>,
    latest_sync_run_status: Option<&str>,
    local_idle: bool,
    requires_reconnect: bool,
) -> bool {
    if !connected || !local_idle || requires_reconnect {
        return false;
    }
    match latest_sync_run_status {
        Some("PENDING") => true,
        Some("FAILED" | "RUNNING") => false,
        _ => last_synced_at.is_none(),
    }
}

/// isSteamReconnectRequired
pub fn is_steam_reconnect_required(message: Option<&str>) -> bool {
    matches!(
        message,
        Some("steam-session-required" | "steam-account-mismatch")
    )
}

/// getSteamErrorMessage (connect/disconnect): the settings key.
pub fn steam_error_key(message: Option<&str>, fallback: &'static str) -> &'static str {
    let lower = message.unwrap_or_default().to_lowercase();
    if [
        "last-authentication",
        "last_authentication",
        "last-auth",
        "last authentication",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        return "steam_last_auth_method";
    }
    if lower.contains("already-linked") {
        return "steam_account_already_linked";
    }
    fallback
}

/// getSteamSyncErrorMessage: the settings key.
pub fn steam_sync_error_key(message: Option<&str>) -> &'static str {
    match message.unwrap_or_default() {
        "steam-sync-in-progress" => "steam_sync_in_progress",
        "steam-profile-private" | "profile/steam-profile-private" => "steam_error_private_profile",
        "steam-upstream-unavailable" | "profile/steam-upstream-unavailable" => {
            "steam_error_steam_unavailable"
        }
        "steam-rate-limited" | "profile/steam-rate-limited" => "steam_error_rate_limited",
        "steam-session-required" => "steam_error_session_required",
        "steam-account-mismatch" => "steam_error_account_mismatch",
        _ => "steam_sync_failed",
    }
}

/// SteamOpenIdReturn
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OpenIdReturn {
    Success,
    /// "already-linked" | "generic"
    Error(&'static str),
}

pub const STEAM_CONNECTED_DEEP_LINK: &str = "hydralauncher://steam-connected";

/// parseSteamOpenIdReturn: the window's navigation that ends the flow.
pub fn parse_steam_openid_return(href: &str) -> Option<OpenIdReturn> {
    let url = reqwest::Url::parse(href).ok()?;
    let param = |key: &str| {
        url.query_pairs()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
    };
    let error = param("error")
        .filter(|e| !e.is_empty())
        .or_else(|| param("oauth_error").filter(|e| !e.is_empty()));
    let is_deep_link = url.scheme() == "hydralauncher" && url.host_str() == Some("steam-connected");
    let search = url.query().map(|q| format!("?{q}")).unwrap_or_default();
    // URL.pathname / search keep percent-encoding; decode like the haystack test sees it
    let haystack = format!(
        "{} {} {}",
        url.path(),
        search,
        error.as_deref().unwrap_or_default()
    )
    .to_lowercase();
    if haystack.contains("already-linked") {
        return Some(OpenIdReturn::Error("already-linked"));
    }
    if error.is_some() && is_deep_link {
        return Some(OpenIdReturn::Error("generic"));
    }
    if is_deep_link || param("oauth_linked_provider").as_deref() == Some("steam") {
        return Some(OpenIdReturn::Success);
    }
    None
}

/// parseSteamOpenIdErrorBody: a JSON error page the API rendered instead
/// of redirecting.
pub fn parse_steam_openid_error_body(body: &str) -> Option<OpenIdReturn> {
    let parsed: Value = serde_json::from_str(body).ok()?;
    let message = parsed.get("message")?.as_str()?;
    message
        .to_lowercase()
        .contains("already-linked")
        .then_some(OpenIdReturn::Error("already-linked"))
}

fn has_local_steam_install(game: &Obj) -> bool {
    game.get("executablePath")
        .and_then(Value::as_str)
        .is_some_and(|s| !s.is_empty())
        || game
            .get("installedSizeInBytes")
            .and_then(Value::as_f64)
            .is_some_and(|n| n != 0.0)
        || game
            .get("trackingExecutablePaths")
            .and_then(Value::as_array)
            .is_some_and(|a| !a.is_empty())
}

fn number(game: &Obj, key: &str) -> f64 {
    game.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

fn obj_text<'a>(game: &'a Obj, key: &str) -> Option<&'a str> {
    game.get(key).and_then(Value::as_str)
}

fn obj_flag(game: &Obj, key: &str) -> bool {
    game.get(key).and_then(Value::as_bool) == Some(true)
}

/// shouldRemoveImportedSteamGame
pub fn should_remove_imported_steam_game(game: &Obj, steam_only: &[String]) -> bool {
    if obj_text(game, "shop") != Some("steam") || obj_flag(game, "isDeleted") {
        return false;
    }
    if number(game, "playTimeInMilliseconds") > 0.0 {
        return false;
    }
    let object_id = obj_text(game, "objectId").unwrap_or_default();
    if steam_only.iter().any(|id| id == object_id) {
        return true;
    }
    if has_local_steam_install(game) {
        return false;
    }
    obj_text(game, "source") == Some("steam")
}

/// hasImportedSteamData
pub fn has_imported_steam_data(game: &Obj, steam_only: &[String]) -> bool {
    let object_id = obj_text(game, "objectId").unwrap_or_default();
    obj_text(game, "shop") == Some("steam")
        && (obj_flag(game, "hasActiveSteamImport")
            || number(game, "steamPlayTimeInMilliseconds") > 0.0
            || obj_text(game, "source") == Some("steam")
            || steam_only.iter().any(|id| id == object_id))
}

/// getSteamImportedDataCleanupPlan: the fields to write, and the
/// lastTimePlayed to restore if the remote merge doesn't confirm the row.
pub fn steam_imported_cleanup(game: &Obj) -> (Obj, Value) {
    let mut cleanup = Obj::new();
    cleanup.insert(
        "hasActiveSteamImport".into(),
        Value::Bool(obj_flag(game, "hasActiveSteamImport")),
    );
    cleanup.insert("steamPlayTimeInMilliseconds".into(), Value::from(0));
    cleanup.insert("lastTimePlayed".into(), Value::Null);
    let source = match game.get("source") {
        Some(Value::String(s)) if s == "steam" => Value::from("hydra"),
        Some(other) => other.clone(),
        None => Value::Null,
    };
    if !source.is_null() || game.contains_key("source") {
        cleanup.insert("source".into(), source);
    }
    let fallback = game.get("lastTimePlayed").cloned().unwrap_or(Value::Null);
    (cleanup, fallback)
}

/// collectSteamOnlyObjectIds
pub fn collect_steam_only_object_ids(games: &[Value]) -> Vec<String> {
    games
        .iter()
        .filter(|g| text(g, "source") == Some("steam"))
        .filter_map(|g| text(g, "objectId").map(str::to_string))
        .collect()
}

// ---- Epic ---------------------------------------------------------------

/// EPIC_ERROR_TRANSLATIONS (getEpicErrorTranslation)
pub fn epic_error_key(error: &str) -> &'static str {
    match error {
        "hydra-auth-required" => "epic_error_hydra_auth",
        "unsupported-platform" | "unsupported-architecture" => "epic_error_platform",
        "legendary-missing" | "legendary-unavailable" => "epic_error_legendary",
        "api-unavailable" => "epic_error_api",
        "network" => "epic_error_network",
        "invalid-account-data" => "epic_error_account_data",
        "account-in-use" => "epic_error_account_in_use",
        "different-account" => "epic_error_different_account",
        "stale-connection" => "epic_error_stale_connection",
        "invalid-response" => "epic_error_response",
        "persistence-failed" => "epic_error_persistence",
        "cleanup-failed" => "epic_error_cleanup",
        "oauth-client-mismatch" => "epic_error_client",
        "operation-cancelled" | "invalid-operation" => "epic_error_cancelled",
        "operation-in-progress" => "epic_error_in_progress",
        "timeout" => "epic_error_timeout",
        "sync-active" => "epic_sync_in_progress",
        "snapshot-invalid" => "epic_sync_invalid",
        "snapshot-too-large" => "epic_sync_too_large",
        "source-permission" => "epic_sync_permission",
        "rate-limit" => "epic_sync_rate_limit",
        "merge-failed" => "epic_sync_merge_pending",
        "session-expired" => "epic_reconnect_description",
        _ => "epic_error_auth",
    }
}

/// The Epic connection as the card sees it (EpicConnectionState).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EpicState {
    pub hydra_logged_in: bool,
    /// availability.available / availability.reason
    pub available: bool,
    pub availability_reason: Option<String>,
    /// connection.connected
    pub connected: bool,
    pub connection_id: String,
    pub display_name: String,
    pub last_synced_at: Option<String>,
    /// "confirmed" once the API answered
    pub confirmed: bool,
    /// "ready" | "expired" | "missing" | "unavailable"
    pub session_state: String,
    /// operation.status: "" | awaiting-login | authenticating | connecting | disconnecting
    pub operation: String,
    pub error: Option<String>,
}

impl EpicState {
    /// The connection from GET /profile/integrations/epic.
    pub fn apply_connection(&mut self, value: &Value) {
        self.connected = flag(value, "connected");
        self.connection_id = text(value, "connectionId").unwrap_or_default().to_string();
        self.display_name = text(value, "displayName").unwrap_or_default().to_string();
        self.last_synced_at = text(value, "lastSyncedAt").map(str::to_string);
        self.confirmed = true;
        self.error = None;
    }
}

/// getEpicIntegrationPresentation
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EpicPresentation {
    pub status_key: &'static str,
    pub tone: &'static str,
    pub requires_reconnect: bool,
    pub can_authenticate: bool,
    pub can_disconnect: bool,
}

pub fn epic_presentation(state: Option<&EpicState>, hydra_logged_in: bool) -> EpicPresentation {
    let connected = state.is_some_and(|s| s.connected);
    let busy = state.is_some_and(|s| !s.operation.is_empty());
    let requires_reconnect = connected && state.is_some_and(|s| s.session_state != "ready");
    let can_authenticate = hydra_logged_in
        && state.is_some_and(|s| s.available && s.error.as_deref() != Some("api-unavailable"))
        && !busy;
    if !hydra_logged_in || state.is_some_and(|s| !s.hydra_logged_in) {
        return EpicPresentation {
            status_key: "integration_status_not_connected",
            tone: "neutral",
            requires_reconnect: false,
            can_authenticate: false,
            can_disconnect: false,
        };
    }
    let base = |status_key, tone| EpicPresentation {
        status_key,
        tone,
        requires_reconnect,
        can_authenticate,
        can_disconnect: connected && !busy,
    };
    if let Some(operation) = state
        .map(|s| s.operation.as_str())
        .filter(|o| !o.is_empty())
    {
        let key = match operation {
            "awaiting-login" => "epic_status_awaiting_login",
            "disconnecting" => "epic_status_disconnecting",
            _ => "epic_status_connecting",
        };
        return base(key, "neutral");
    }
    if state.is_none_or(|s| !s.confirmed) {
        return base(
            if connected {
                "epic_status_unconfirmed"
            } else {
                "epic_status_unknown"
            },
            "warning",
        );
    }
    if requires_reconnect {
        base("epic_status_reconnect_required", "warning")
    } else if connected {
        base("epic_status_connected", "success")
    } else {
        base("integration_status_not_connected", "neutral")
    }
}

// ---- RetroAchievements --------------------------------------------------

pub const RETRO_ACHIEVEMENTS_INTEGRATION_ENDPOINT: &str = "/profile/integrations/retroachievements";

/// GET /profile/integrations/retroachievements
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RaStatus {
    pub connected: bool,
    pub username: String,
    /// "active" | "invalid_credentials"
    pub account_status: String,
}

impl RaStatus {
    pub fn parse(value: &Value) -> Self {
        Self {
            connected: flag(value, "connected"),
            username: text(value, "username").unwrap_or_default().to_string(),
            account_status: text(value, "retroAchievementsAccountStatus")
                .unwrap_or_default()
                .to_string(),
        }
    }
    pub fn invalid(&self) -> bool {
        self.connected && self.account_status == "invalid_credentials"
    }
}

/// getRetroAchievementsConnectErrorField: "password" | "webApiKey" | "form"
pub fn ra_error_field(message: Option<&str>) -> &'static str {
    match message {
        Some("profile/retroachievements-invalid-password") => "password",
        Some("profile/retroachievements-invalid-web-api-key") => "webApiKey",
        _ => "form",
    }
}

/// The connection window's getErrorMessage: the settings key.
pub fn ra_error_key(message: Option<&str>) -> &'static str {
    match message {
        Some("profile/retroachievements-invalid-password") => "retroachievements_invalid_password",
        Some("profile/retroachievements-invalid-web-api-key") => {
            "retroachievements_invalid_web_api_key"
        }
        Some("profile/retroachievements-missing-credentials") => {
            "retroachievements_missing_credentials"
        }
        _ => "retroachievements_connect_error",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn obj(value: Value) -> Obj {
        value.as_object().cloned().unwrap()
    }

    #[test]
    fn steam_presentation_matches_the_view_states() {
        let connected = SteamStatus {
            connected: true,
            ..Default::default()
        };
        let idle = SteamSync::default();
        let reconnect = SteamSync::Idle {
            requires_reconnect: true,
        };
        assert_eq!(
            steam_presentation(&connected, &idle).0,
            SteamView::Connected
        );
        assert_eq!(
            steam_presentation(&connected, &reconnect),
            (
                SteamView::ReconnectRequired,
                "steam_status_reconnect_required",
                "warning"
            )
        );
        let preserved = SteamStatus {
            snapshot_preserved: true,
            ..Default::default()
        };
        assert_eq!(
            steam_presentation(&preserved, &reconnect).1,
            "steam_status_snapshot_preserved"
        );
        assert_eq!(
            steam_presentation(&SteamStatus::default(), &idle),
            (
                SteamView::Disconnected,
                "integration_status_not_connected",
                "neutral"
            )
        );
    }

    fn running(phase: SteamPhase, found: u64, processed: u64) -> SteamSync {
        SteamSync::Running {
            sync_run_id: "r".into(),
            phase,
            games_found: found,
            games_processed: processed,
        }
    }

    #[test]
    fn steam_progress_ranges_follow_the_phase() {
        assert_eq!(steam_progress(&SteamSync::default()), None);
        let cancelling = steam_progress(&SteamSync::Cancelling {
            sync_run_id: String::new(),
        })
        .unwrap();
        assert_eq!(cancelling.percentage, None);
        assert_eq!(cancelling.label_key, "steam_syncing");
        // achievements without a total: indeterminate
        let p = steam_progress(&running(SteamPhase::Achievements, 0, 0)).unwrap();
        assert_eq!(p.percentage, None);
        let p = steam_progress(&running(SteamPhase::Achievements, 10, 5)).unwrap();
        assert_eq!(p.percentage, Some(30.0));
        assert!(p.show_count);
        let p = steam_progress(&running(SteamPhase::Publishing, 4, 2)).unwrap();
        assert_eq!(p.percentage, Some(65.0));
        assert!(!p.show_count);
        assert_eq!(p.label_key, "steam_sync_uploading");
        let p = steam_progress(&running(SteamPhase::Merging, 0, 0)).unwrap();
        assert_eq!(p.percentage, Some(70.0));
        assert!(!p.show_count);
        let p = steam_progress(&running(SteamPhase::Library, 0, 0)).unwrap();
        assert_eq!(p.percentage, None);
        assert_eq!(p.label_key, "steam_syncing");
        let p = steam_progress(&running(SteamPhase::Finishing, 0, 0)).unwrap();
        assert_eq!(p.percentage, Some(100.0));
        // processed past found is clamped
        let p = steam_progress(&running(SteamPhase::Executables, 2, 9)).unwrap();
        assert_eq!(p.percentage, Some(100.0));
    }

    #[test]
    fn auto_start_rules() {
        assert!(should_auto_start_steam_sync(true, None, None, true, false));
        assert!(!should_auto_start_steam_sync(
            true,
            Some("2026-01-01"),
            None,
            true,
            false
        ));
        assert!(should_auto_start_steam_sync(
            true,
            Some("x"),
            Some("PENDING"),
            true,
            false
        ));
        assert!(!should_auto_start_steam_sync(
            true,
            None,
            Some("FAILED"),
            true,
            false
        ));
        assert!(!should_auto_start_steam_sync(
            true,
            None,
            Some("RUNNING"),
            true,
            false
        ));
        assert!(should_auto_start_steam_sync(
            true,
            None,
            Some("SUCCEEDED"),
            true,
            false
        ));
        assert!(!should_auto_start_steam_sync(
            false, None, None, true, false
        ));
        assert!(!should_auto_start_steam_sync(
            true, None, None, false, false
        ));
        assert!(!should_auto_start_steam_sync(true, None, None, true, true));
    }

    #[test]
    fn openid_returns() {
        assert_eq!(
            parse_steam_openid_return("hydralauncher://steam-connected"),
            Some(OpenIdReturn::Success)
        );
        assert_eq!(
            parse_steam_openid_return("hydralauncher://steam-connected?error=boom"),
            Some(OpenIdReturn::Error("generic"))
        );
        assert_eq!(
            parse_steam_openid_return("https://hydra.example/x?oauth_error=profile/already-linked"),
            Some(OpenIdReturn::Error("already-linked"))
        );
        assert_eq!(
            parse_steam_openid_return("https://hydra.example/?oauth_linked_provider=steam"),
            Some(OpenIdReturn::Success)
        );
        assert_eq!(
            parse_steam_openid_return("https://steamcommunity.com/openid/login"),
            None
        );
        assert_eq!(parse_steam_openid_return("not a url"), None);
        assert_eq!(
            parse_steam_openid_error_body(r#"{"message":"profile/steam-already-linked"}"#),
            Some(OpenIdReturn::Error("already-linked"))
        );
        assert_eq!(parse_steam_openid_error_body("<html>"), None);
        assert_eq!(parse_steam_openid_error_body(r#"{"message":"nope"}"#), None);
    }

    #[test]
    fn steam_error_keys() {
        assert_eq!(
            steam_error_key(
                Some("profile/last-authentication-method"),
                "steam_connect_error"
            ),
            "steam_last_auth_method"
        );
        assert_eq!(
            steam_error_key(Some("profile/steam-already-linked"), "steam_connect_error"),
            "steam_account_already_linked"
        );
        assert_eq!(
            steam_error_key(None, "steam_disconnect_error"),
            "steam_disconnect_error"
        );
        assert_eq!(
            steam_sync_error_key(Some("profile/steam-rate-limited")),
            "steam_error_rate_limited"
        );
        assert_eq!(steam_sync_error_key(Some("other")), "steam_sync_failed");
        assert!(is_steam_reconnect_required(Some("steam-account-mismatch")));
        assert!(!is_steam_reconnect_required(Some("steam-sync-failed")));
    }

    #[test]
    fn imported_steam_cleanup_rules() {
        let only = vec!["10".to_string()];
        let imported = obj(json!({ "shop": "steam", "objectId": "20", "source": "steam" }));
        assert!(should_remove_imported_steam_game(&imported, &only));
        let played = obj(json!({ "shop": "steam", "objectId": "10", "playTimeInMilliseconds": 5 }));
        assert!(!should_remove_imported_steam_game(&played, &only));
        let remote_only =
            obj(json!({ "shop": "steam", "objectId": "10", "executablePath": "C:/x.exe" }));
        assert!(should_remove_imported_steam_game(&remote_only, &only));
        let installed = obj(
            json!({ "shop": "steam", "objectId": "30", "source": "steam", "executablePath": "C:/x.exe" }),
        );
        assert!(!should_remove_imported_steam_game(&installed, &only));
        let deleted = obj(json!({ "shop": "steam", "objectId": "10", "isDeleted": true }));
        assert!(!should_remove_imported_steam_game(&deleted, &only));
        let epic = obj(json!({ "shop": "epic", "objectId": "10" }));
        assert!(!should_remove_imported_steam_game(&epic, &only));

        assert!(has_imported_steam_data(
            &obj(json!({ "shop": "steam", "objectId": "1", "steamPlayTimeInMilliseconds": 9 })),
            &[]
        ));
        assert!(!has_imported_steam_data(
            &obj(json!({ "shop": "steam", "objectId": "1", "source": "hydra" })),
            &[]
        ));

        let (cleanup, fallback) = steam_imported_cleanup(&obj(json!({
            "source": "steam",
            "hasActiveSteamImport": true,
            "lastTimePlayed": "2026-01-01T00:00:00.000Z",
        })));
        assert_eq!(cleanup["source"], "hydra");
        assert_eq!(cleanup["hasActiveSteamImport"], true);
        assert_eq!(cleanup["steamPlayTimeInMilliseconds"], 0);
        assert_eq!(cleanup["lastTimePlayed"], Value::Null);
        assert_eq!(fallback, "2026-01-01T00:00:00.000Z");

        assert_eq!(
            collect_steam_only_object_ids(&[
                json!({ "objectId": "1", "source": "steam" }),
                json!({ "objectId": "2", "source": "hydra" }),
            ]),
            vec!["1".to_string()]
        );
    }

    #[test]
    fn epic_presentation_states() {
        let signed_out = epic_presentation(None, false);
        assert_eq!(signed_out.status_key, "integration_status_not_connected");
        assert!(!signed_out.can_authenticate);

        let mut state = EpicState {
            hydra_logged_in: true,
            available: false,
            availability_reason: Some("legendary-missing".into()),
            session_state: "missing".into(),
            ..Default::default()
        };
        // before the API answers
        let p = epic_presentation(Some(&state), true);
        assert_eq!((p.status_key, p.tone), ("epic_status_unknown", "warning"));
        state.apply_connection(&json!({ "connected": false }));
        let p = epic_presentation(Some(&state), true);
        assert_eq!(p.status_key, "integration_status_not_connected");
        assert!(!p.can_authenticate, "no Legendary, no sign-in");
        state.apply_connection(&json!({
            "connected": true, "connectionId": "abc123", "displayName": "Me"
        }));
        let p = epic_presentation(Some(&state), true);
        assert_eq!(p.status_key, "epic_status_reconnect_required");
        assert!(p.requires_reconnect);
        assert!(p.can_disconnect);
        state.session_state = "ready".into();
        assert_eq!(
            epic_presentation(Some(&state), true).status_key,
            "epic_status_connected"
        );
        state.operation = "disconnecting".into();
        let p = epic_presentation(Some(&state), true);
        assert_eq!(p.status_key, "epic_status_disconnecting");
        assert!(!p.can_disconnect);
        assert_eq!(epic_error_key("legendary-missing"), "epic_error_legendary");
        assert_eq!(epic_error_key("whatever"), "epic_error_auth");
    }

    #[test]
    fn retroachievements_status_and_errors() {
        let status = RaStatus::parse(&json!({
            "connected": true,
            "username": "me",
            "retroAchievementsUserId": null,
            "retroAchievementsAccountStatus": "invalid_credentials"
        }));
        assert!(status.invalid());
        assert_eq!(status.username, "me");
        assert!(!RaStatus::parse(&json!({ "connected": false })).invalid());
        assert_eq!(
            ra_error_field(Some("profile/retroachievements-invalid-web-api-key")),
            "webApiKey"
        );
        assert_eq!(ra_error_field(Some("x")), "form");
        assert_eq!(
            ra_error_key(Some("profile/retroachievements-missing-credentials")),
            "retroachievements_missing_credentials"
        );
        assert_eq!(ra_error_key(None), "retroachievements_connect_error");
    }
}
