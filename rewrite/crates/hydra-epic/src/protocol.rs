//! auth-protocol.ts, sync-protocol.ts and the response checks of
//! integration-core.ts: the Epic login URLs, the authorization code, the
//! Legendary session files, the Hydra connection and sync-run payloads and
//! the HTTP error codes.

use reqwest::Url;
use serde_json::{Map, Value, json};

use crate::error::{EpicError, Result, err};
use crate::time::parse_ms;

/// The public OAuth client of the pinned Legendary 0.21.1 release.
pub const EPIC_OAUTH_CLIENT_ID: &str = "34a02cf8f4414e29b15921876da36f9a";
pub const EPIC_AUTH_CODE_MIN_LENGTH: usize = 16;
pub const EPIC_AUTH_CODE_MAX_LENGTH: usize = 512;
pub const EPIC_AUTH_RESPONSE_MAX_LENGTH: usize = 4096;
pub const EPIC_DISPLAY_NAME_MAX_LENGTH: usize = 128;
pub const EPIC_ACCESS_TOKEN_MAX_LENGTH: usize = 8192;
pub const EPIC_ENDPOINT: &str = "/profile/integrations/epic";

pub fn is_record(value: &Value) -> bool {
    value.is_object()
}

/// `Number.isInteger`
pub fn is_integer(value: &Value) -> bool {
    value.as_i64().is_some()
        || value.as_u64().is_some()
        || value
            .as_f64()
            .is_some_and(|f| f.is_finite() && f.fract() == 0.0)
}

fn chars_in(text: &str, min: usize, max: usize, extra: &[char]) -> bool {
    let count = text.chars().count();
    count >= min
        && count <= max
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || extra.contains(&c))
}

/// EPIC_CONNECTION_ID_PATTERN
pub fn is_connection_id(text: &str) -> bool {
    chars_in(text, 8, 128, &[])
}

/// EPIC_RUN_ID_PATTERN
pub fn is_run_id(text: &str) -> bool {
    chars_in(text, 8, 128, &[])
}

/// EPIC_LEGACY_RUN_ID_PATTERN (the unpublished UUID run ids)
pub fn is_legacy_run_id(text: &str) -> bool {
    let parts: Vec<&str> = text.split('-').collect();
    parts.len() == 5
        && [8, 4, 4, 4, 12]
            .iter()
            .zip(&parts)
            .all(|(len, part)| part.len() == *len && part.chars().all(|c| c.is_ascii_hexdigit()))
}

/// /^[a-f0-9]{32}$/ (the Hydra API's lowercase Epic account ids)
pub fn is_account_id(text: &str) -> bool {
    text.len() == 32
        && text
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

/// validateEpicAuthorizationCode
pub fn validate_authorization_code(input: &str) -> Result<String> {
    if chars_in(
        input,
        EPIC_AUTH_CODE_MIN_LENGTH,
        EPIC_AUTH_CODE_MAX_LENGTH,
        &['_', '-'],
    ) {
        Ok(input.to_string())
    } else {
        err("invalid-response")
    }
}

/// parseEpicAuthorizationResponse: the redirect page's body is
/// `{"authorizationCode": "…", …}`.
pub fn parse_authorization_response(input: &str) -> Result<String> {
    if input.chars().count() > EPIC_AUTH_RESPONSE_MAX_LENGTH {
        return err("invalid-response");
    }
    let parsed: Value =
        serde_json::from_str(input).map_err(|_| EpicError::new("invalid-response"))?;
    match parsed.get("authorizationCode").and_then(Value::as_str) {
        Some(code) if parsed.is_object() => validate_authorization_code(code),
        _ => err("invalid-response"),
    }
}

fn redirect_url() -> Url {
    let mut redirect = Url::parse("https://www.epicgames.com/id/api/redirect").expect("static");
    redirect
        .query_pairs_mut()
        .append_pair("clientId", EPIC_OAUTH_CLIENT_ID)
        .append_pair("responseType", "code");
    redirect
}

/// getEpicLoginUrl
pub fn login_url() -> String {
    let mut login = Url::parse("https://www.epicgames.com/id/login").expect("static");
    login
        .query_pairs_mut()
        .append_pair("redirectUrl", redirect_url().as_str());
    login.to_string()
}

/// isEpicAuthorizationReturn: only the exact redirect for Legendary's client.
pub fn is_authorization_return(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    let all = |name: &str| -> Vec<String> {
        parsed
            .query_pairs()
            .filter(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
            .collect()
    };
    parsed.scheme() == "https"
        && parsed.host_str() == Some("www.epicgames.com")
        && parsed.port().is_none_or(|p| p == 443)
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.path() == "/id/api/redirect"
        && all("clientId") == [EPIC_OAUTH_CLIENT_ID]
        && all("responseType") == ["code"]
}

/// isHttpsNavigation
pub fn is_https_navigation(url: &str) -> bool {
    Url::parse(url)
        .is_ok_and(|u| u.scheme() == "https" && u.username().is_empty() && u.password().is_none())
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// validateLegendarySession: Legendary's `user.json`.
pub fn validate_legendary_session(value: &Value) -> Result<()> {
    let account = text(value, "account_id").unwrap_or_default();
    let valid = value.is_object()
        && account.len() == 32
        && account.chars().all(|c| c.is_ascii_hexdigit())
        && text(value, "displayName").is_some_and(|n| !n.trim().is_empty())
        && text(value, "access_token").is_some_and(|t| !t.is_empty())
        && text(value, "refresh_token").is_some_and(|t| !t.is_empty())
        && text(value, "expires_at").and_then(parse_ms).is_some()
        && text(value, "refresh_expires_at")
            .and_then(parse_ms)
            .is_some();
    if !valid {
        return err("auth-failed");
    }
    match value.get("client_id") {
        None => Ok(()),
        Some(Value::String(id)) if id == EPIC_OAUTH_CLIENT_ID => Ok(()),
        Some(_) => err("oauth-client-mismatch"),
    }
}

/// validateLegendaryVersion: Legendary's `version.json`.
pub fn validate_legendary_version(value: &Value) -> Result<()> {
    let Some(data) = value.get("data").filter(|d| d.is_object()) else {
        return err("invalid-response");
    };
    if !value.is_object() {
        return err("invalid-response");
    }
    if let Some(config) = data.get("egl_config").filter(|c| c.is_object())
        && let Some(id) = config.get("client_id")
        && id.as_str() != Some(EPIC_OAUTH_CLIENT_ID)
    {
        return err("oauth-client-mismatch");
    }
    Ok(())
}

/// A sync run (parseEpicSyncRun).
#[derive(Clone, Debug, PartialEq)]
pub struct SyncRun {
    pub id: String,
    pub trigger: String,
    pub status: String,
    pub games_count: i64,
    pub error: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub achievement_snapshot_version: bool,
    pub achievement_summary: Option<Value>,
}

impl SyncRun {
    pub fn to_json(&self) -> Value {
        let mut run = json!({
            "id": self.id,
            "trigger": self.trigger,
            "status": self.status,
            "gamesCount": self.games_count,
            "error": self.error,
            "startedAt": self.started_at,
            "completedAt": self.completed_at,
            "createdAt": self.created_at,
        });
        if self.achievement_snapshot_version {
            run["achievementSnapshotVersion"] = json!(1);
        }
        if let Some(summary) = &self.achievement_summary {
            run["achievementSummary"] = summary.clone();
        }
        run
    }
}

fn nullable_date(value: Option<&Value>) -> Result<Option<String>> {
    match value {
        Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if parse_ms(s).is_some() => Ok(Some(s.clone())),
        _ => err("invalid-response"),
    }
}

/// parseEpicSyncRun
pub fn parse_sync_run(value: &Value) -> Result<SyncRun> {
    let invalid = || EpicError::new("invalid-response");
    let id = text(value, "id")
        .filter(|id| is_run_id(id))
        .ok_or_else(invalid)?;
    let trigger = text(value, "trigger")
        .filter(|t| ["FIRST_LINK", "STARTUP", "MANUAL"].contains(t))
        .ok_or_else(invalid)?;
    let status = text(value, "status")
        .filter(|s| ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"].contains(s))
        .ok_or_else(invalid)?;
    let games_count = value
        .get("gamesCount")
        .filter(|v| is_integer(v))
        .and_then(Value::as_f64)
        .filter(|n| *n >= 0.0)
        .ok_or_else(invalid)? as i64;
    let error = match value.get("error") {
        Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.clone()),
        _ => return Err(invalid()),
    };
    let created_at = text(value, "createdAt")
        .filter(|d| parse_ms(d).is_some())
        .ok_or_else(invalid)?;
    let started_at = nullable_date(value.get("startedAt"))?;
    let completed_at = nullable_date(value.get("completedAt"))?;
    let achievement_summary = match value.get("achievementSummary") {
        None | Some(Value::Null) => None,
        Some(summary) => Some(parse_achievement_summary(summary)?),
    };
    Ok(SyncRun {
        id: id.into(),
        trigger: trigger.into(),
        status: status.into(),
        games_count,
        error,
        started_at,
        completed_at,
        created_at: created_at.into(),
        achievement_snapshot_version: value.get("achievementSnapshotVersion") == Some(&json!(1)),
        achievement_summary,
    })
}

/// parseEpicAchievementSummary
pub fn parse_achievement_summary(value: &Value) -> Result<Value> {
    let valid = text(value, "status")
        .is_some_and(|s| ["not-requested", "complete", "partial"].contains(&s))
        && [
            "gamesApplied",
            "gamesPending",
            "gamesUnsupported",
            "unlocksApplied",
        ]
        .iter()
        .all(|key| {
            value
                .get(*key)
                .is_some_and(|v| is_integer(v) && v.as_f64().unwrap_or(-1.0) >= 0.0)
        });
    if valid {
        Ok(value.clone())
    } else {
        err("invalid-response")
    }
}

/// A linked Epic account (EpicConnectedConnection).
#[derive(Clone, Debug, PartialEq)]
pub struct Connection {
    pub connection_id: String,
    pub epic_account_id: String,
    pub display_name: String,
    pub connected_at: String,
    pub achievements_snapshot_version: bool,
    pub dlc_snapshot_version: bool,
    pub last_synced_at: Option<String>,
    pub latest_sync_run: Option<SyncRun>,
}

impl Connection {
    /// publicConnection: the JSON the store keeps and the renderer sees.
    pub fn to_json(&self) -> Value {
        let mut map = Map::new();
        map.insert("connected".into(), json!(true));
        map.insert("connectionId".into(), json!(self.connection_id));
        map.insert("epicAccountId".into(), json!(self.epic_account_id));
        map.insert("displayName".into(), json!(self.display_name));
        map.insert("connectedAt".into(), json!(self.connected_at));
        if let Some(capabilities) = self.capabilities() {
            map.insert("capabilities".into(), capabilities);
        }
        map.insert("lastSyncedAt".into(), json!(self.last_synced_at));
        map.insert(
            "latestSyncRun".into(),
            self.latest_sync_run
                .as_ref()
                .map(SyncRun::to_json)
                .unwrap_or(Value::Null),
        );
        Value::Object(map)
    }

    /// epicConnectionCapabilities
    fn capabilities(&self) -> Option<Value> {
        if !self.achievements_snapshot_version && !self.dlc_snapshot_version {
            return None;
        }
        let mut map = Map::new();
        if self.achievements_snapshot_version {
            map.insert("achievementsSnapshotVersion".into(), json!(1));
        }
        if self.dlc_snapshot_version {
            map.insert("dlcSnapshotVersion".into(), json!(1));
        }
        Some(Value::Object(map))
    }

    pub fn same_link(&self, other: &Connection) -> bool {
        self.connection_id == other.connection_id && self.epic_account_id == other.epic_account_id
    }
}

fn capability(value: &Value, key: &str) -> bool {
    value
        .get("capabilities")
        .filter(|c| c.is_object())
        .and_then(|c| c.get(key))
        == Some(&json!(1))
}

/// validateEpicConnection: GET/POST /profile/integrations/epic. `None` is
/// `{ connected: false }`.
pub fn validate_connection(response: &Value) -> Result<Option<Connection>> {
    let Some(connected) = response.get("connected").and_then(Value::as_bool) else {
        return err("invalid-response");
    };
    if !connected {
        return Ok(None);
    }
    let invalid = || EpicError::new("invalid-response");
    let connection_id = text(response, "connectionId")
        .filter(|id| is_connection_id(id))
        .ok_or_else(invalid)?;
    let epic_account_id = text(response, "epicAccountId")
        .filter(|id| is_account_id(id))
        .ok_or_else(invalid)?;
    let display_name = text(response, "displayName")
        .filter(|n| !n.trim().is_empty())
        .ok_or_else(invalid)?;
    let connected_at = text(response, "connectedAt")
        .filter(|d| parse_ms(d).is_some())
        .ok_or_else(invalid)?;
    let last_synced_at = match response.get("lastSyncedAt") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if parse_ms(s).is_some() => Some(s.clone()),
        _ => return Err(invalid()),
    };
    let latest_sync_run = match response.get("latestSyncRun") {
        None | Some(Value::Null) => None,
        Some(run) => Some(parse_sync_run(run)?),
    };
    Ok(Some(Connection {
        connection_id: connection_id.into(),
        epic_account_id: epic_account_id.into(),
        display_name: display_name.into(),
        connected_at: connected_at.into(),
        achievements_snapshot_version: capability(response, "achievementsSnapshotVersion"),
        dlc_snapshot_version: capability(response, "dlcSnapshotVersion"),
        last_synced_at,
        latest_sync_run,
    }))
}

/// isConnection (store.ts): the stricter local-record check.
pub fn parse_stored_connection(value: &Value) -> Option<Connection> {
    if value.get("connected") != Some(&json!(true)) {
        return None;
    }
    let mut connection = validate_connection(value).ok().flatten()?;
    // Legacy UUID run ids from the unpublished implementation are dropped.
    if value
        .get("latestSyncRun")
        .and_then(|r| r.get("id"))
        .and_then(Value::as_str)
        .is_some_and(is_legacy_run_id)
    {
        connection.latest_sync_run = None;
    }
    Some(connection)
}

/// The status and body message of a failed Hydra request.
#[derive(Clone, Debug, Default)]
pub struct HttpFailure {
    pub status: Option<u16>,
    pub message: Option<String>,
    pub timeout: bool,
}

impl HttpFailure {
    pub fn from_api(error: &hydra_core::api::ApiError) -> Self {
        match error {
            hydra_core::api::ApiError::Status { status, body } => HttpFailure {
                status: Some(*status),
                message: body
                    .as_ref()
                    .and_then(|b| b.get("message"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
                timeout: false,
            },
            hydra_core::api::ApiError::Network(message) => HttpFailure {
                status: None,
                message: None,
                timeout: message.to_ascii_lowercase().contains("timed out")
                    || message.to_ascii_lowercase().contains("timeout"),
            },
            hydra_core::api::ApiError::NotLoggedIn => HttpFailure {
                status: Some(401),
                ..Default::default()
            },
        }
    }
}

/// safeHttpError + safeError (integration-core.ts)
pub fn connection_error(error: &hydra_core::api::ApiError) -> EpicError {
    let failure = HttpFailure::from_api(error);
    let code = match failure.status {
        Some(401) => "hydra-auth-required",
        Some(404 | 502 | 503) => "api-unavailable",
        Some(409) => match failure.message.as_deref() {
            Some("profile/epic-disconnect-required") => "different-account",
            Some("profile/epic-connection-changed") => "stale-connection",
            _ => "account-in-use",
        },
        Some(400) => "invalid-account-data",
        Some(422) => "auth-failed",
        Some(_) => "network",
        None if failure.timeout => "timeout",
        None => "network",
    };
    EpicError::new(code)
}

/// hasHttpResponse
pub fn has_http_response(error: &hydra_core::api::ApiError) -> bool {
    matches!(error, hydra_core::api::ApiError::Status { .. })
}

/// epicSyncHttpError
pub fn sync_http_error(error: &hydra_core::api::ApiError) -> EpicError {
    let failure = HttpFailure::from_api(error);
    let Some(status) = failure.status else {
        return EpicError::new("network");
    };
    let code = if status == 401 {
        "hydra-auth-required"
    } else if matches!(
        failure.message.as_deref(),
        Some("profile/epic-connection-changed" | "profile/epic-not-connected")
    ) {
        "stale-connection"
    } else {
        match status {
            413 => "snapshot-too-large",
            409 => "sync-active",
            400 => "snapshot-invalid",
            404 | 502 | 503 => "api-unavailable",
            _ => "network",
        }
    };
    EpicError::new(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_url_matches_electron() {
        assert_eq!(
            login_url(),
            "https://www.epicgames.com/id/login?redirectUrl=https%3A%2F%2Fwww.epicgames.com%2Fid%2Fapi%2Fredirect%3FclientId%3D34a02cf8f4414e29b15921876da36f9a%26responseType%3Dcode"
        );
    }

    #[test]
    fn authorization_return() {
        let ok = "https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code";
        assert!(is_authorization_return(ok));
        assert!(is_authorization_return(&format!("{ok}&x=1")));
        assert!(!is_authorization_return(&ok.replace("https", "http")));
        assert!(!is_authorization_return(&format!("{ok}&clientId=other")));
        assert!(!is_authorization_return(
            &ok.replace("www.epicgames.com", "epicgames.com")
        ));
        assert!(!is_authorization_return(
            "https://www.epicgames.com/id/api/redirect?clientId=x&responseType=code"
        ));
        assert!(is_https_navigation("https://a.b/c"));
        assert!(!is_https_navigation("https://u:p@a.b/c"));
        assert!(!is_https_navigation("hydralauncher://x"));
    }

    #[test]
    fn authorization_codes() {
        let code = "a".repeat(32);
        let body = format!(r#"{{"redirectUrl":"x","authorizationCode":"{code}","sid":null}}"#);
        assert_eq!(parse_authorization_response(&body).unwrap(), code);
        assert!(parse_authorization_response(r#"{"authorizationCode":"short"}"#).is_err());
        assert!(parse_authorization_response(r#"{"authorizationCode":null}"#).is_err());
        assert!(parse_authorization_response("not json").is_err());
        assert!(parse_authorization_response(&" ".repeat(5000)).is_err());
        assert!(validate_authorization_code("abc_DEF-0123456789").is_ok());
        assert!(validate_authorization_code("abc DEF 0123456789").is_err());
    }

    fn session() -> Value {
        json!({
            "account_id": "0123456789abcdef0123456789ABCDEF",
            "displayName": "Player",
            "access_token": "eg1~a",
            "refresh_token": "eg1~r",
            "expires_at": "2030-01-01T00:00:00.000Z",
            "refresh_expires_at": "2030-01-02T00:00:00.000Z",
        })
    }

    #[test]
    fn legendary_files() {
        assert!(validate_legendary_session(&session()).is_ok());
        let mut other = session();
        other["client_id"] = json!("other");
        assert_eq!(
            validate_legendary_session(&other).unwrap_err().code(),
            "oauth-client-mismatch"
        );
        let mut missing = session();
        missing.as_object_mut().unwrap().remove("refresh_token");
        assert_eq!(
            validate_legendary_session(&missing).unwrap_err().code(),
            "auth-failed"
        );
        assert!(validate_legendary_version(&json!({"data": {}})).is_ok());
        assert!(validate_legendary_version(&json!({})).is_err());
        assert_eq!(
            validate_legendary_version(&json!({"data": {"egl_config": {"client_id": "x"}}}))
                .unwrap_err()
                .code(),
            "oauth-client-mismatch"
        );
    }

    fn run() -> Value {
        json!({
            "id": "run12345678",
            "trigger": "MANUAL",
            "status": "PENDING",
            "gamesCount": 0,
            "error": null,
            "startedAt": null,
            "completedAt": null,
            "createdAt": "2026-11-08T00:00:00.000Z",
        })
    }

    #[test]
    fn sync_runs() {
        let parsed = parse_sync_run(&run()).unwrap();
        assert_eq!(parsed.status, "PENDING");
        assert_eq!(parsed.to_json(), run());
        let mut missing = run();
        missing.as_object_mut().unwrap().remove("error");
        assert!(parse_sync_run(&missing).is_err(), "error must be present");
        let mut versioned = run();
        versioned["achievementSnapshotVersion"] = json!(1);
        versioned["achievementSummary"] = json!({
            "status": "partial", "gamesApplied": 1, "gamesPending": 2,
            "gamesUnsupported": 0, "unlocksApplied": 3
        });
        let parsed = parse_sync_run(&versioned).unwrap();
        assert!(parsed.achievement_snapshot_version);
        assert!(parsed.achievement_summary.is_some());
        assert!(is_legacy_run_id("123e4567-e89b-12d3-a456-426614174000"));
        assert!(!is_legacy_run_id("run12345678"));
    }

    #[test]
    fn connections() {
        assert_eq!(
            validate_connection(&json!({"connected": false})).unwrap(),
            None
        );
        assert!(validate_connection(&json!({})).is_err());
        let connection = validate_connection(&json!({
            "connected": true,
            "connectionId": "conn12345678",
            "epicAccountId": "0123456789abcdef0123456789abcdef",
            "displayName": "Player",
            "connectedAt": "2026-01-01T00:00:00.000Z",
            "capabilities": {"achievementsSnapshotVersion": 1, "dlcSnapshotVersion": null},
            "secret": "dropped",
        }))
        .unwrap()
        .unwrap();
        assert!(connection.achievements_snapshot_version && !connection.dlc_snapshot_version);
        assert_eq!(
            connection.to_json(),
            json!({
                "connected": true,
                "connectionId": "conn12345678",
                "epicAccountId": "0123456789abcdef0123456789abcdef",
                "displayName": "Player",
                "connectedAt": "2026-01-01T00:00:00.000Z",
                "capabilities": {"achievementsSnapshotVersion": 1},
                "lastSyncedAt": null,
                "latestSyncRun": null,
            })
        );
        assert!(
            validate_connection(&json!({
                "connected": true,
                "connectionId": "conn12345678",
                "epicAccountId": "0123456789ABCDEF0123456789abcdef",
                "displayName": "Player",
                "connectedAt": "2026-01-01T00:00:00.000Z",
            }))
            .is_err(),
            "the API sends lowercase account ids"
        );
    }

    #[test]
    fn http_errors() {
        use hydra_core::api::ApiError;
        let status = |status, message: Option<&str>| ApiError::Status {
            status,
            body: message.map(|m| json!({ "message": m })),
        };
        assert_eq!(
            connection_error(&status(401, None)).code(),
            "hydra-auth-required"
        );
        assert_eq!(
            connection_error(&status(409, Some("profile/epic-disconnect-required"))).code(),
            "different-account"
        );
        assert_eq!(
            connection_error(&status(409, None)).code(),
            "account-in-use"
        );
        assert_eq!(
            connection_error(&status(503, None)).code(),
            "api-unavailable"
        );
        assert_eq!(
            connection_error(&ApiError::Network("operation timed out".into())).code(),
            "timeout"
        );
        assert_eq!(
            sync_http_error(&status(404, Some("profile/epic-not-connected"))).code(),
            "stale-connection"
        );
        assert_eq!(
            sync_http_error(&status(413, None)).code(),
            "snapshot-too-large"
        );
        assert_eq!(sync_http_error(&status(409, None)).code(), "sync-active");
    }
}
