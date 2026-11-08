//! The Steam library sync without the browser and the network: what the
//! orchestrator (services/steam-integration/steam-sync-orchestrator.ts)
//! reads from Steam and sends to Hydra.
//!
//! Ports steam-store-session-config.ts (the store page token, the Community
//! login), steam-web-api.ts (request URLs), steam-source-retry.ts (retry
//! policy), steam-source-payload.ts (owned games and achievements),
//! steam-family-library.ts (family sharing and playtime), steam-sync-snapshot.ts
//! (the snapshot and its chunks), steam-community-achievements.ts (the
//! Community stats pages) and steam-sync-errors.ts.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use regex::Regex;
use serde_json::{Map, Value, json};

type Obj = Map<String, Value>;

// ---- errors -------------------------------------------------------------------

/// The orchestrator's error classes.
#[derive(Clone, Debug, PartialEq)]
pub enum SteamError {
    /// SteamSyncAbortedError / AbortError
    Aborted,
    /// steam-sync-in-progress
    InProgress,
    /// steam-profile-private
    PrivateProfile,
    /// profile/steam-rate-limited
    RateLimited,
    /// steam-sync-run-not-pending
    RunNotPending,
    /// steam-session-required
    SessionRequired,
    /// steam-account-mismatch
    AccountMismatch,
    /// SteamWebApiHttpError: a Steam (or Community) response.
    Http {
        status: u16,
        body: Value,
        retry_after_seconds: Option<u64>,
    },
    /// A Hydra API error, with its `response.data.message` when there is one.
    Hydra {
        status: Option<u16>,
        message: Option<String>,
    },
    /// Transport failures (ETIMEDOUT, ECONNRESET, …) and anything else.
    Other(String),
}

impl SteamError {
    /// `error.message` for the named classes.
    pub fn message(&self) -> String {
        match self {
            SteamError::Aborted => "steam-sync-aborted".into(),
            SteamError::InProgress => "steam-sync-in-progress".into(),
            SteamError::PrivateProfile => "steam-profile-private".into(),
            SteamError::RateLimited => "profile/steam-rate-limited".into(),
            SteamError::RunNotPending => "steam-sync-run-not-pending".into(),
            SteamError::SessionRequired => "steam-session-required".into(),
            SteamError::AccountMismatch => "steam-account-mismatch".into(),
            SteamError::Http { status, .. } => format!("steam-web-api-http-{status}"),
            SteamError::Hydra { status, message } => message.clone().unwrap_or_else(|| {
                format!("Request failed with status code {}", status.unwrap_or(0))
            }),
            SteamError::Other(message) => message.clone(),
        }
    }

    /// `getSteamSourceHttpStatus`: Steam's status, or the Hydra API's.
    pub fn http_status(&self) -> Option<u16> {
        match self {
            SteamError::Http { status, .. } => Some(*status),
            SteamError::Hydra { status, .. } => *status,
            _ => None,
        }
    }

    fn payload_message(&self) -> Option<String> {
        match self {
            SteamError::Hydra { message, .. } => message.clone(),
            SteamError::Http { body, .. } => read_error_message(body),
            _ => None,
        }
    }

    /// `isSteamSyncAbortError`
    pub fn is_abort(&self) -> bool {
        matches!(self, SteamError::Aborted)
    }

    /// `isSteamSourceTransportError`
    pub fn is_transport(&self) -> bool {
        matches!(self, SteamError::Other(_))
    }
}

impl std::fmt::Display for SteamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message())
    }
}

impl std::error::Error for SteamError {}

impl From<crate::api::ApiError> for SteamError {
    fn from(error: crate::api::ApiError) -> Self {
        match error {
            crate::api::ApiError::Status { status, body } => SteamError::Hydra {
                status: Some(status),
                message: body
                    .as_ref()
                    .and_then(|b| b.get("message"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
            },
            crate::api::ApiError::NotLoggedIn => SteamError::Hydra {
                status: None,
                message: Some("user not logged in".into()),
            },
            crate::api::ApiError::Network(message) => SteamError::Other(message),
        }
    }
}

/// `getSteamSyncFailureMessage`
pub fn sync_failure_message(error: &SteamError) -> String {
    match error {
        SteamError::PrivateProfile
        | SteamError::RateLimited
        | SteamError::RunNotPending
        | SteamError::SessionRequired
        | SteamError::AccountMismatch => error.message(),
        _ if is_source_rate_limited(error) => "profile/steam-rate-limited".into(),
        SteamError::Hydra {
            message: Some(message),
            ..
        } => message.clone(),
        SteamError::Hydra { .. } | SteamError::Http { .. } | SteamError::Other(_) => {
            let message = error.message();
            if message.is_empty() {
                "steam-sync-failed".into()
            } else {
                message
            }
        }
        _ => "steam-sync-failed".into(),
    }
}

// ---- steam-source-retry.ts --------------------------------------------------------

pub const RETRY_502_MAX_ATTEMPTS: u32 = 3;
const RETRY_502_BASE_DELAY_MS: u64 = 500;
pub const RETRY_429_MAX_ATTEMPTS: u32 = 5;
const RETRY_429_BASE_DELAY_MS: u64 = 1000;
const RETRY_429_MAX_DELAY_MS: u64 = 30_000;

/// `isSteamRateLimitStatus`
pub fn is_rate_limit_status(status: Option<u16>) -> bool {
    matches!(status, Some(429 | 420))
}

/// `shouldRetrySteamSource`
pub fn should_retry(error: &SteamError, failed_attempt: u32) -> bool {
    let status = error.http_status();
    if is_rate_limit_status(status) {
        return failed_attempt < RETRY_429_MAX_ATTEMPTS;
    }
    if status == Some(502) {
        return failed_attempt < RETRY_502_MAX_ATTEMPTS;
    }
    false
}

/// `getSteamSourceRetryDelayMs`
pub fn retry_delay_ms(error: &SteamError, failed_attempt: u32) -> u64 {
    let status = error.http_status();
    let exponent = failed_attempt.saturating_sub(1);
    if is_rate_limit_status(status) {
        if let SteamError::Http {
            retry_after_seconds: Some(seconds),
            ..
        } = error
        {
            return seconds * 1000;
        }
        return (RETRY_429_BASE_DELAY_MS.saturating_mul(2u64.saturating_pow(exponent)))
            .min(RETRY_429_MAX_DELAY_MS);
    }
    if status == Some(502) {
        return RETRY_502_BASE_DELAY_MS.saturating_mul(2u64.saturating_pow(exponent));
    }
    0
}

/// `parseNumericRetryAfterSeconds` for a header value.
pub fn parse_retry_after(value: Option<&str>) -> Option<u64> {
    let trimmed = value?.trim();
    (!trimmed.is_empty() && trimmed.bytes().all(|b| b.is_ascii_digit()))
        .then(|| trimmed.parse().ok())
        .flatten()
}

fn read_error_message(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Object(o) => o.get("message").and_then(Value::as_str).map(str::to_string),
        _ => None,
    }
}

/// `isSteamPrivateProfilePayload`
pub fn is_private_profile_payload(payload: &Value) -> bool {
    read_error_message(payload).is_some_and(|m| {
        m == "steam-profile-private" || m.contains("profile/steam-profile-private")
    })
}

/// `isSteamSourceLibraryFatal`
pub fn is_source_library_fatal(error: &SteamError) -> bool {
    error.http_status() == Some(403)
        || error
            .payload_message()
            .is_some_and(|m| is_private_profile_payload(&Value::String(m)))
}

/// `isSteamSourceAchievementSkippable`
pub fn is_achievement_skippable(error: &SteamError) -> bool {
    let status = error.http_status();
    matches!(status, Some(400 | 403 | 409 | 502))
        || is_rate_limit_status(status)
        || error.is_transport()
}

/// `isSteamSourceRateLimited`
pub fn is_source_rate_limited(error: &SteamError) -> bool {
    is_rate_limit_status(error.http_status())
        || error
            .payload_message()
            .is_some_and(|m| m == "steam-rate-limited" || m.contains("profile/steam-rate-limited"))
}

/// `isSteamSyncConflict`
pub fn is_conflict(error: &SteamError) -> bool {
    error.http_status() == Some(409)
}

// ---- steam-store-session-config.ts ------------------------------------------------

/// SteamWebApiToken
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SteamToken {
    pub steam_id64: String,
    pub access_token: String,
}

fn is_steam_id64(value: &str) -> bool {
    value.len() == 17 && value.bytes().all(|b| b.is_ascii_digit())
}

fn as_trimmed_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) if n.as_f64().is_some_and(f64::is_finite) => {
            js_number_string(n).trim().to_string()
        }
        _ => String::new(),
    }
}

/// `String(number)` for the numbers JSON gives us.
fn js_number_string(n: &serde_json::Number) -> String {
    if let Some(i) = n.as_i64() {
        return i.to_string();
    }
    if let Some(u) = n.as_u64() {
        return u.to_string();
    }
    let f = n.as_f64().unwrap_or(f64::NAN);
    if f.fract() == 0.0 && f.abs() < 1e21 {
        format!("{f:.0}")
    } else {
        f.to_string()
    }
}

/// `parseSteamStoreSessionConfig`: the `application_config` attributes of
/// the store page.
pub fn parse_store_session_config(
    user_info_raw: Option<&str>,
    store_config_raw: Option<&str>,
    current_url: &str,
) -> Result<SteamToken, SteamError> {
    if current_url.contains("/login") {
        return Err(SteamError::SessionRequired);
    }
    let (Some(user_info), Some(store_config)) = (
        user_info_raw.filter(|s| !s.is_empty()),
        store_config_raw.filter(|s| !s.is_empty()),
    ) else {
        return Err(SteamError::SessionRequired);
    };
    let (Ok(Value::Object(user_info)), Ok(Value::Object(store_config))) = (
        serde_json::from_str::<Value>(user_info),
        serde_json::from_str::<Value>(store_config),
    ) else {
        return Err(SteamError::SessionRequired);
    };
    if user_info.get("logged_in") != Some(&Value::Bool(true)) {
        return Err(SteamError::SessionRequired);
    }
    let steam_id64 = as_trimmed_string(user_info.get("steamid"));
    let access_token = as_trimmed_string(store_config.get("webapi_token"));
    if !is_steam_id64(&steam_id64) || access_token.is_empty() {
        return Err(SteamError::SessionRequired);
    }
    Ok(SteamToken {
        steam_id64,
        access_token,
    })
}

/// `isSteamCommunityLoginPageUrl` / `isSteamCommunityLoginUrl`
pub fn is_community_login_url(value: &str) -> bool {
    match reqwest::Url::parse(value) {
        Ok(url) => {
            url.host_str() == Some("login.steampowered.com")
                || url.path() == "/login"
                || url.path().starts_with("/login/")
        }
        Err(_) => true,
    }
}

/// `parseSteamCommunityPageSteamId`: `g_steamID` (false when logged out).
pub fn parse_community_page_steam_id(current_url: &str, steam_id_raw: &Value) -> Option<String> {
    if is_community_login_url(current_url) {
        return None;
    }
    let steam_id64 = as_trimmed_string(Some(steam_id_raw));
    is_steam_id64(&steam_id64).then_some(steam_id64)
}

/// SteamCommunityLogin
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommunityLogin {
    LoggedIn(String),
    LoggedOut,
    /// The Community page didn't load; the stored cookies are used as-is.
    Unverified,
}

/// `resolveSteamCommunityLogin`: `refreshed` is None when the page failed.
pub fn resolve_community_login(
    refreshed: Option<Option<String>>,
    has_login_cookie: bool,
) -> CommunityLogin {
    match refreshed {
        Some(Some(steam_id64)) => CommunityLogin::LoggedIn(steam_id64),
        Some(None) => CommunityLogin::LoggedOut,
        None if !has_login_cookie => CommunityLogin::LoggedOut,
        None => CommunityLogin::Unverified,
    }
}

/// The store page the token comes from (STEAM_STORE_EXPLORE_URL).
pub const STORE_EXPLORE_URL: &str = "https://store.steampowered.com/explore/";
/// Loading it renews steamLoginSecure (STEAM_COMMUNITY_REFRESH_URL).
pub const COMMUNITY_REFRESH_URL: &str = "https://steamcommunity.com/my/";
pub const STORE_MAX_REDIRECTS: usize = 5;
/// The page script that reads the token attributes.
pub const STORE_CONFIG_SCRIPT: &str = r#"(() => {
        const el = document.getElementById("application_config");
        if (!el) {
          return { userInfoRaw: null, storeConfigRaw: null };
        }
        return {
          userInfoRaw: el.getAttribute("data-userinfo"),
          storeConfigRaw: el.getAttribute("data-store_user_config"),
        };
      })()"#;
pub const COMMUNITY_STEAM_ID_SCRIPT: &str =
    r#"typeof g_steamID === "undefined" ? null : g_steamID"#;

// ---- steam-web-api.ts -----------------------------------------------------------

pub const WEB_API_BASE_URL: &str = "https://api.steampowered.com";

/// `steamWebApiGet`'s URL: access_token, steamid, format, then the params.
pub fn web_api_url(
    path: &str,
    token: &SteamToken,
    params: &[(&str, String)],
    include_steam_id: bool,
) -> String {
    let mut url = reqwest::Url::parse(WEB_API_BASE_URL)
        .and_then(|base| base.join(path))
        .expect("static Steam Web API URL");
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("access_token", &token.access_token);
        if include_steam_id {
            query.append_pair("steamid", &token.steam_id64);
        }
        query.append_pair("format", "json");
        for (key, value) in params {
            query.append_pair(key, value);
        }
    }
    url.to_string()
}

/// `fetchSteamOwnedGames`
pub fn owned_games_url(token: &SteamToken) -> String {
    web_api_url(
        "IPlayerService/GetOwnedGames/v1/",
        token,
        &[
            ("include_appinfo", "1".into()),
            ("include_played_free_games", "1".into()),
        ],
        true,
    )
}

/// `fetchSteamOwnedGame`
pub fn owned_game_url(token: &SteamToken, steam_app_id: &str) -> String {
    // Number.parseInt: the leading digits, NaN (null in JSON) without any.
    let digits: String = steam_app_id
        .trim_start()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    let app_id = digits
        .parse::<u64>()
        .map_or_else(|_| "null".to_string(), |id| id.to_string());
    // JSON.stringify keeps the key order of the object literal.
    let input = format!(
        r#"{{"include_appinfo":true,"include_played_free_games":true,"appids_filter":[{app_id}]}}"#
    );
    web_api_url(
        "IPlayerService/GetOwnedGames/v1/",
        token,
        &[("input_json", input)],
        true,
    )
}

/// `fetchSteamGameAchievementSchema`
pub fn achievement_schema_url(token: &SteamToken, steam_app_id: &str) -> String {
    web_api_url(
        "IPlayerService/GetGameAchievements/v1/",
        token,
        &[
            ("appid", steam_app_id.into()),
            ("language", "english".into()),
        ],
        false,
    )
}

/// `fetchSteamFamilyGroupForUser`
pub fn family_group_url(token: &SteamToken) -> String {
    web_api_url(
        "IFamilyGroupsService/GetFamilyGroupForUser/v1/",
        token,
        &[],
        false,
    )
}

/// `fetchSteamSharedLibraryApps`
pub fn shared_library_apps_url(token: &SteamToken, family_group_id: &str) -> String {
    web_api_url(
        "IFamilyGroupsService/GetSharedLibraryApps/v1/",
        token,
        &[
            ("family_groupid", family_group_id.into()),
            ("include_own", "0".into()),
            ("include_excluded", "0".into()),
            ("include_free", "0".into()),
            ("include_non_games", "0".into()),
            ("language", "english".into()),
        ],
        false,
    )
}

/// `fetchSteamFamilyPlaytimeSummary`
pub fn family_playtime_url(token: &SteamToken, family_group_id: &str) -> String {
    web_api_url(
        "IFamilyGroupsService/GetPlaytimeSummary/v1/",
        token,
        &[
            ("family_groupid", family_group_id.into()),
            (
                "input_json",
                json!({ "family_groupid": family_group_id }).to_string(),
            ),
        ],
        false,
    )
}

/// `fetchSteamLastPlayedTimes`
pub fn last_played_times_url(token: &SteamToken) -> String {
    web_api_url(
        "IPlayerService/ClientGetLastPlayedTimes/v1/",
        token,
        &[],
        false,
    )
}

/// `readJsonBody`: JSON when it parses, the text otherwise, null when empty.
pub fn read_json_body(text: &str) -> Value {
    if text.is_empty() {
        return Value::Null;
    }
    serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_string()))
}

// ---- steam-source-payload.ts ------------------------------------------------------

/// SteamSourceLibraryGame
#[derive(Clone, Debug, PartialEq)]
pub struct SourceGame {
    pub steam_app_id: String,
    pub name: String,
    pub play_time_in_seconds: u64,
    pub last_played_at: Option<String>,
}

/// SteamSourceAchievement
#[derive(Clone, Debug, PartialEq)]
pub struct SourceAchievement {
    pub name: String,
    pub unlocked: bool,
    pub unlock_time: Option<String>,
}

fn is_app_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 10
        && (b'1'..=b'9').contains(&bytes[0])
        && bytes.iter().all(u8::is_ascii_digit)
}

fn extract_named_array<'a>(
    payload: &'a Value,
    direct_key: &str,
    nested: (&str, &str),
) -> &'a [Value] {
    if let Value::Array(items) = payload {
        return items;
    }
    let Value::Object(map) = payload else {
        return &[];
    };
    if let Some(Value::Array(items)) = map.get(direct_key) {
        return items;
    }
    if let Some(Value::Object(root)) = map.get(nested.0)
        && let Some(Value::Array(items)) = root.get(nested.1)
    {
        return items;
    }
    &[]
}

fn read_id_string(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) if n.as_f64().is_some_and(f64::is_finite) => Some(js_number_string(n)),
        _ => None,
    }
}

/// `readNonNegativeInt` (steam-source-payload.ts: numbers only).
fn read_non_negative_int(value: Option<&Value>) -> Option<u64> {
    let f = value?.as_f64()?;
    (f.is_finite() && f >= 0.0).then(|| f.trunc() as u64)
}

/// `readNonNegativeInt` (steam-family-library.ts: numeric strings too).
fn read_non_negative_int_lenient(value: Option<&Value>) -> Option<u64> {
    match value? {
        Value::String(s) if !s.is_empty() => {
            let parsed = js_number(s)?;
            (parsed.is_finite() && parsed >= 0.0).then(|| parsed.trunc() as u64)
        }
        other => read_non_negative_int(Some(other)),
    }
}

/// `Number(text)` for plain decimal strings.
fn js_number(text: &str) -> Option<f64> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Some(0.0);
    }
    trimmed.parse::<f64>().ok()
}

fn iso_from_ms(ms: i64) -> Option<String> {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

fn unix_seconds_to_iso(value: Option<u64>) -> Option<String> {
    match value {
        None | Some(0) => None,
        Some(unix) => iso_from_ms(unix as i64 * 1000),
    }
}

/// `isSkippedSteamLibraryTitle`: demos, tests, betas.
pub fn is_skipped_library_title(name: &str) -> bool {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN
        .get_or_init(|| {
            Regex::new(
                r"(?i)(?-u:\b)(?:demo|(?:play|public|closed|open|technical)[\s-]*test|test[\s-]*(?:server|client)|beta|ptb)(?-u:\b)",
            )
            .expect("valid pattern")
        })
        .is_match(name.trim())
}

fn read_steam_play_time_in_seconds(item: &Obj) -> u64 {
    if let Some(explicit) = read_non_negative_int(item.get("playTimeInSeconds")) {
        return explicit;
    }
    let forever = read_non_negative_int(item.get("playtime_forever")).unwrap_or(0);
    let disconnected = read_non_negative_int(item.get("playtime_disconnected")).unwrap_or(0);
    (forever + disconnected) * 60
}

/// `parseSteamSourceLibrary`
pub fn parse_source_library(payload: &Value) -> Vec<SourceGame> {
    extract_named_array(payload, "games", ("response", "games"))
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|item| {
            let steam_app_id = read_id_string(item.get("steamAppId"))
                .or_else(|| read_id_string(item.get("appid")))?;
            if !is_app_id(&steam_app_id) {
                return None;
            }
            let last_played_at = match item.get("lastPlayedAt") {
                Some(Value::String(s)) => Some(s.clone()),
                Some(Value::Null) => None,
                _ => unix_seconds_to_iso(read_non_negative_int(item.get("rtime_last_played"))),
            };
            Some(SourceGame {
                steam_app_id,
                name: item
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                play_time_in_seconds: read_steam_play_time_in_seconds(item),
                last_played_at,
            })
        })
        .collect()
}

/// `parseSteamSourceAchievements`
pub fn parse_source_achievements(payload: &Value) -> Vec<SourceAchievement> {
    extract_named_array(payload, "achievements", ("playerstats", "achievements"))
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|item| {
            let name =
                read_id_string(item.get("name")).or_else(|| read_id_string(item.get("apiname")))?;
            let unlocked = match item.get("unlocked") {
                Some(Value::Bool(b)) => *b,
                _ => {
                    item.get("achieved").and_then(Value::as_f64) == Some(1.0)
                        || item.get("achieved") == Some(&Value::Bool(true))
                }
            };
            let unlock_time = match item.get("unlockTime") {
                Some(Value::String(s)) => Some(s.clone()),
                Some(Value::Null) => None,
                _ => unix_seconds_to_iso(read_non_negative_int(item.get("unlocktime"))),
            };
            Some(SourceAchievement {
                name,
                unlocked,
                unlock_time,
            })
        })
        .collect()
}

// ---- steam-family-library.ts --------------------------------------------------------

/// SteamFamilySharedApp
#[derive(Clone, Debug, PartialEq)]
pub struct FamilyApp {
    pub steam_app_id: String,
    pub name: String,
    pub play_time_in_seconds: u64,
    pub last_played_at: Option<String>,
}

/// SteamFamilyPlaytime
#[derive(Clone, Debug, PartialEq, Default)]
pub struct FamilyPlaytime {
    pub play_time_in_seconds: u64,
    pub last_played_at: Option<String>,
}

/// An insertion-ordered map, like the JS `Map`s the family code builds.
pub type PlaytimeMap = Vec<(String, FamilyPlaytime)>;

fn map_get<'a>(map: &'a PlaytimeMap, key: &str) -> Option<&'a FamilyPlaytime> {
    map.iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

fn map_set(map: &mut PlaytimeMap, key: &str, value: FamilyPlaytime) {
    match map.iter_mut().find(|(k, _)| k == key) {
        Some(entry) => entry.1 = value,
        None => map.push((key.to_string(), value)),
    }
}

fn read_response(payload: &Value) -> Option<&Obj> {
    let map = payload.as_object()?;
    match map.get("response") {
        Some(Value::Object(response)) => Some(response),
        _ => Some(map),
    }
}

fn minutes_to_seconds(value: Option<&Value>) -> u64 {
    read_non_negative_int_lenient(value).map_or(0, |m| m * 60)
}

fn unix_to_iso_lenient(value: Option<&Value>) -> Option<String> {
    unix_seconds_to_iso(read_non_negative_int_lenient(value))
}

/// `parseSteamFamilyGroupId`
pub fn parse_family_group_id(payload: &Value) -> Option<String> {
    let response = read_response(payload)?;
    if response.get("is_not_member_of_any_group") == Some(&Value::Bool(true)) {
        return None;
    }
    read_id_string(response.get("family_groupid")).filter(|id| id != "0")
}

fn is_shareable_family_game(item: &Obj) -> bool {
    if let Some(reason) = read_non_negative_int_lenient(item.get("exclude_reason"))
        && reason != 0
    {
        return false;
    }
    if let Some(app_type) = read_non_negative_int_lenient(item.get("app_type"))
        && app_type != 1
    {
        return false;
    }
    true
}

/// `parseSteamSharedLibraryApps`
pub fn parse_shared_library_apps(payload: &Value) -> Vec<FamilyApp> {
    extract_named_array(payload, "apps", ("response", "apps"))
        .iter()
        .filter_map(Value::as_object)
        .filter(|item| is_shareable_family_game(item))
        .filter_map(|item| {
            let steam_app_id = read_id_string(item.get("steamAppId"))
                .or_else(|| read_id_string(item.get("appid")))?;
            if !is_app_id(&steam_app_id) {
                return None;
            }
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            if name.is_empty() {
                return None;
            }
            Some(FamilyApp {
                steam_app_id,
                name: name.to_string(),
                play_time_in_seconds: minutes_to_seconds(item.get("rt_playtime")),
                last_played_at: unix_to_iso_lenient(item.get("rt_last_played")),
            })
        })
        .collect()
}

/// `pickPreferredPlaytime`
fn pick_preferred(current: Option<&FamilyPlaytime>, next: FamilyPlaytime) -> FamilyPlaytime {
    let Some(current) = current else {
        return next;
    };
    if next.play_time_in_seconds > current.play_time_in_seconds {
        return FamilyPlaytime {
            play_time_in_seconds: next.play_time_in_seconds,
            last_played_at: next
                .last_played_at
                .or_else(|| current.last_played_at.clone()),
        };
    }
    if current.last_played_at.is_none() && next.last_played_at.is_some() {
        return FamilyPlaytime {
            play_time_in_seconds: current.play_time_in_seconds,
            last_played_at: next.last_played_at,
        };
    }
    current.clone()
}

fn belongs_to_connected_account(item: &Obj, steam_id64: &str) -> bool {
    let raw = item
        .get("steamid")
        .filter(|v| !v.is_null())
        .or_else(|| item.get("steam_id"));
    match raw {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) if !s.is_empty() => s == steam_id64,
        Some(_) => true,
    }
}

/// `parseSteamFamilyPlaytimeByAppId`
pub fn parse_family_playtime(payload: &Value, steam_id64: &str) -> PlaytimeMap {
    let mut map = PlaytimeMap::new();
    let entries = extract_named_array(payload, "entries", ("response", "entries"))
        .iter()
        .chain(extract_named_array(
            payload,
            "entries_by_owner",
            ("response", "entries_by_owner"),
        ));
    for item in entries.filter_map(Value::as_object) {
        if !belongs_to_connected_account(item, steam_id64) {
            continue;
        }
        let Some(steam_app_id) =
            read_id_string(item.get("steamAppId")).or_else(|| read_id_string(item.get("appid")))
        else {
            continue;
        };
        if !is_app_id(&steam_app_id) {
            continue;
        }
        let seconds = read_non_negative_int_lenient(item.get("seconds"))
            .or_else(|| read_non_negative_int_lenient(item.get("seconds_played")))
            .or_else(|| read_non_negative_int_lenient(item.get("playtime_forever")).map(|m| m * 60))
            .unwrap_or(0);
        let playtime = FamilyPlaytime {
            play_time_in_seconds: seconds,
            last_played_at: unix_to_iso_lenient(item.get("latest_played"))
                .or_else(|| unix_to_iso_lenient(item.get("first_played"))),
        };
        let next = pick_preferred(map_get(&map, &steam_app_id), playtime);
        map_set(&mut map, &steam_app_id, next);
    }
    map
}

/// `parseSteamLastPlayedTimes`
pub fn parse_last_played_times(payload: &Value) -> PlaytimeMap {
    let mut map = PlaytimeMap::new();
    for item in extract_named_array(payload, "games", ("response", "games"))
        .iter()
        .filter_map(Value::as_object)
    {
        let Some(steam_app_id) =
            read_id_string(item.get("steamAppId")).or_else(|| read_id_string(item.get("appid")))
        else {
            continue;
        };
        if !is_app_id(&steam_app_id) {
            continue;
        }
        let playtime = FamilyPlaytime {
            play_time_in_seconds: minutes_to_seconds(item.get("playtime_forever"))
                + minutes_to_seconds(item.get("playtime_disconnected")),
            last_played_at: unix_to_iso_lenient(item.get("last_playtime"))
                .or_else(|| unix_to_iso_lenient(item.get("first_playtime"))),
        };
        let next = pick_preferred(map_get(&map, &steam_app_id), playtime);
        map_set(&mut map, &steam_app_id, next);
    }
    map
}

/// `playtimeMapFromSharedApps`
pub fn playtime_from_shared_apps(apps: &[FamilyApp]) -> PlaytimeMap {
    let mut map = PlaytimeMap::new();
    for app in apps {
        let next = pick_preferred(
            map_get(&map, &app.steam_app_id),
            FamilyPlaytime {
                play_time_in_seconds: app.play_time_in_seconds,
                last_played_at: app.last_played_at.clone(),
            },
        );
        map_set(&mut map, &app.steam_app_id, next);
    }
    map
}

/// `mergeSteamFamilyPlaytimeMaps`
pub fn merge_playtime_maps(maps: &[PlaytimeMap]) -> PlaytimeMap {
    let mut merged = PlaytimeMap::new();
    for map in maps {
        for (steam_app_id, playtime) in map {
            let next = pick_preferred(map_get(&merged, steam_app_id), playtime.clone());
            map_set(&mut merged, steam_app_id, next);
        }
    }
    merged
}

/// `countSteamFamilyPlaytimeEntries`
pub fn count_playtime_entries(map: &PlaytimeMap) -> usize {
    map.iter()
        .filter(|(_, p)| p.play_time_in_seconds > 0)
        .count()
}

/// `mergeSteamOwnedAndFamilyGames`
pub fn merge_owned_and_family_games(
    owned: &[SourceGame],
    family: &[FamilyApp],
    playtime: &PlaytimeMap,
) -> Vec<SourceGame> {
    let mut seen = HashSet::new();
    let mut games = Vec::new();
    for game in owned {
        if !seen.insert(game.steam_app_id.clone()) {
            continue;
        }
        match map_get(playtime, &game.steam_app_id) {
            None => games.push(game.clone()),
            Some(extra) => {
                let merged = pick_preferred(
                    Some(&FamilyPlaytime {
                        play_time_in_seconds: game.play_time_in_seconds,
                        last_played_at: game.last_played_at.clone(),
                    }),
                    extra.clone(),
                );
                games.push(SourceGame {
                    play_time_in_seconds: merged.play_time_in_seconds,
                    last_played_at: merged.last_played_at,
                    ..game.clone()
                });
            }
        }
    }
    for app in family {
        if !seen.insert(app.steam_app_id.clone()) {
            continue;
        }
        let merged = pick_preferred(
            Some(&FamilyPlaytime {
                play_time_in_seconds: app.play_time_in_seconds,
                last_played_at: app.last_played_at.clone(),
            }),
            map_get(playtime, &app.steam_app_id)
                .cloned()
                .unwrap_or_default(),
        );
        games.push(SourceGame {
            steam_app_id: app.steam_app_id.clone(),
            name: app.name.clone(),
            play_time_in_seconds: merged.play_time_in_seconds,
            last_played_at: merged.last_played_at,
        });
    }
    games
}

// ---- steam-sync-snapshot.ts -----------------------------------------------------------

pub const SNAPSHOT_ACHIEVEMENT_CHUNK_SIZE: usize = 2_000;

/// `buildSteamSnapshotAchievements`: unlocked ones with a time.
pub fn snapshot_achievements(source: &[SourceAchievement]) -> Vec<Value> {
    source
        .iter()
        .filter(|a| a.unlocked)
        .filter_map(|a| {
            let time = a.unlock_time.as_deref().filter(|t| !t.is_empty())?;
            Some(json!({ "name": a.name, "unlockTime": time }))
        })
        .collect()
}

/// `buildSteamSnapshot`: one entry per game, `achievements` only for games
/// whose achievements were read.
pub fn build_snapshot(
    games: &[SourceGame],
    achievements: &HashMap<String, Option<Vec<SourceAchievement>>>,
) -> Value {
    let games: Vec<Value> = games
        .iter()
        .map(|game| {
            let mut entry = Obj::new();
            entry.insert("steamAppId".into(), json!(game.steam_app_id));
            entry.insert("name".into(), json!(game.name));
            entry.insert("playTimeInSeconds".into(), json!(game.play_time_in_seconds));
            entry.insert(
                "lastPlayedAt".into(),
                game.last_played_at
                    .clone()
                    .map_or(Value::Null, Value::String),
            );
            if let Some(Some(source)) = achievements.get(&game.steam_app_id) {
                entry.insert(
                    "achievements".into(),
                    Value::Array(snapshot_achievements(source)),
                );
            }
            Value::Object(entry)
        })
        .collect();
    json!({ "games": games })
}

fn snapshot_games(snapshot: &Value) -> &[Value] {
    snapshot
        .get("games")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn achievements_of(game: &Value) -> Option<&Vec<Value>> {
    game.get("achievements").and_then(Value::as_array)
}

/// `chunkSteamSnapshot`: at most 2000 achievements per chunk; a game with
/// more spreads over several chunks.
pub fn chunk_snapshot(snapshot: &Value) -> Vec<Value> {
    let mut chunks: Vec<Vec<Value>> = Vec::new();
    let mut current: Vec<Value> = Vec::new();
    let mut count = 0;
    for game in snapshot_games(snapshot) {
        let Some(achievements) = achievements_of(game).filter(|a| !a.is_empty()) else {
            current.push(game.clone());
            continue;
        };
        let mut index = 0;
        while index < achievements.len() {
            if count == SNAPSHOT_ACHIEVEMENT_CHUNK_SIZE {
                chunks.push(std::mem::take(&mut current));
                count = 0;
            }
            let capacity = SNAPSHOT_ACHIEVEMENT_CHUNK_SIZE - count;
            let end = (index + capacity).min(achievements.len());
            let mut part = game.clone();
            part["achievements"] = Value::Array(achievements[index..end].to_vec());
            current.push(part);
            count += end - index;
            index = end;
        }
    }
    if !current.is_empty() || chunks.is_empty() {
        chunks.push(current);
    }
    let total = chunks.len();
    chunks
        .into_iter()
        .map(|games| json!({ "totalChunks": total, "games": games }))
        .collect()
}

/// `chunkSteamGameSyncPayload`
pub fn chunk_game_sync_payload(payload: &Value) -> Vec<Value> {
    let Some(achievements) =
        achievements_of(payload).filter(|a| a.len() > SNAPSHOT_ACHIEVEMENT_CHUNK_SIZE)
    else {
        return vec![payload.clone()];
    };
    achievements
        .chunks(SNAPSHOT_ACHIEVEMENT_CHUNK_SIZE)
        .map(|part| {
            let mut chunk = payload.clone();
            chunk["achievements"] = Value::Array(part.to_vec());
            chunk
        })
        .collect()
}

/// `buildLegacySteamSnapshotFallback`: the old single-PUT snapshot, with
/// big achievement lists sent per game afterwards.
pub fn legacy_snapshot_fallback(snapshot: &Value) -> (Value, Vec<(String, Vec<Value>)>) {
    let mut uploads = Vec::new();
    let games: Vec<Value> = snapshot_games(snapshot)
        .iter()
        .map(|game| {
            match achievements_of(game).filter(|a| a.len() > SNAPSHOT_ACHIEVEMENT_CHUNK_SIZE) {
                Some(achievements) => {
                    let steam_app_id = game
                        .get("steamAppId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string();
                    let payload = json!({
                        "playTimeInSeconds": game.get("playTimeInSeconds").cloned().unwrap_or(Value::Null),
                        "lastPlayedAt": game.get("lastPlayedAt").cloned().unwrap_or(Value::Null),
                        "achievements": achievements,
                    });
                    uploads.push((steam_app_id, chunk_game_sync_payload(&payload)));
                    let mut without = game.clone();
                    if let Some(map) = without.as_object_mut() {
                        map.remove("achievements");
                    }
                    without
                }
                None => game.clone(),
            }
        })
        .collect();
    (json!({ "games": games }), uploads)
}

/// The unlocked-achievement count the log prints.
pub fn snapshot_unlocked_count(snapshot: &Value) -> usize {
    snapshot_games(snapshot)
        .iter()
        .map(|g| achievements_of(g).map_or(0, Vec::len))
        .sum()
}

// ---- steam-community-achievements.ts -------------------------------------------------

pub const COMMUNITY_ORIGIN: &str = "https://steamcommunity.com";

/// `shouldFetchSteamCommunityAchievements`: only games with playtime.
pub fn should_fetch_community_achievements(play_time_in_seconds: u64) -> bool {
    play_time_in_seconds > 0
}

/// `parseSteamTimezoneOffsetSeconds`: the `timezoneOffset` cookie (`-10800,0`).
pub fn parse_timezone_offset_seconds(value: Option<&str>) -> i64 {
    let Some(value) = value.filter(|v| !v.is_empty()) else {
        return 0;
    };
    let digits: String = value
        .char_indices()
        .take_while(|(i, c)| c.is_ascii_digit() || (*i == 0 && *c == '-'))
        .map(|(_, c)| c)
        .collect();
    digits.parse().unwrap_or(0)
}

fn decode_xml_text(value: &str) -> String {
    static CDATA: OnceLock<Regex> = OnceLock::new();
    let cdata = CDATA.get_or_init(|| Regex::new(r"(?s)<!\[CDATA\[(.*?)\]\]>").expect("valid"));
    cdata
        .replace_all(value, "$1")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .trim()
        .to_string()
}

fn xml_tag_value(block: &str, pattern: &Regex) -> String {
    pattern
        .captures(block)
        .map(|c| decode_xml_text(&c[1]))
        .unwrap_or_default()
}

fn icon_hash_from_url(value: &str) -> Option<String> {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN
        .get_or_init(|| Regex::new(r"(?i)(?:/|^)([a-f0-9]{16,})\.[a-z]+(?:\?|$)").expect("valid"))
        .captures(value)
        .map(|c| c[1].to_lowercase())
}

fn playerstats(achievements: Vec<Value>) -> Value {
    json!({ "playerstats": { "achievements": achievements } })
}

/// `isSteamCommunityPlayerstatsXml`
pub fn is_playerstats_xml(body: &str) -> bool {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN
        .get_or_init(|| Regex::new(r"(?i)<playerstats[\s>]").expect("valid"))
        .is_match(body)
}

/// `isSteamCommunityPrivateStatsXml`
pub fn is_private_stats_xml(body: &str) -> bool {
    static PRIVATE: OnceLock<Regex> = OnceLock::new();
    static ACHIEVEMENT: OnceLock<Regex> = OnceLock::new();
    PRIVATE
        .get_or_init(|| {
            Regex::new(r"(?i)<privacyState>\s*private\s*</privacyState>").expect("valid")
        })
        .is_match(body)
        && !ACHIEVEMENT
            .get_or_init(|| Regex::new(r"(?i)<achievement(?-u:\b)").expect("valid"))
            .is_match(body)
}

const MONTHS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

/// `Date.UTC(year, month, day, hour, minute)` with JS's overflow rules.
fn date_utc_ms(year: i64, month: i64, day: i64, hour: i64, minute: i64) -> i64 {
    let year = year + month.div_euclid(12);
    let month = month.rem_euclid(12) + 1;
    let (y, m) = if month <= 2 {
        (year - 1, month + 9)
    } else {
        (year, month - 3)
    };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let first_of_month = era * 146_097 + doe - 719_468;
    let days = first_of_month + day - 1;
    days * 86_400_000 + hour * 3_600_000 + minute * 60_000
}

/// `parseSteamUnlockTimeText`: "Unlocked 3 Feb, 2024 @ 4:05pm" or
/// "Unlocked Feb 3 @ 4:05pm" (the year is implied within the last 24h).
pub fn parse_unlock_time_text(
    text: &str,
    time_zone_offset_seconds: i64,
    now_ms: i64,
) -> Option<String> {
    static DAY_FIRST: OnceLock<Regex> = OnceLock::new();
    static MONTH_FIRST: OnceLock<Regex> = OnceLock::new();
    let months = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
    let day_first = DAY_FIRST.get_or_init(|| {
        Regex::new(&format!(
            r"(?i)Unlocked\s+(\d{{1,2}})\s+({months})(?:,?\s+(\d{{4}}))?\s+@\s+(\d{{1,2}}):(\d{{2}})\s*(am|pm)"
        ))
        .expect("valid")
    });
    let month_first = MONTH_FIRST.get_or_init(|| {
        Regex::new(&format!(
            r"(?i)Unlocked\s+({months})\s+(\d{{1,2}})(?:,?\s+(\d{{4}}))?\s+@\s+(\d{{1,2}}):(\d{{2}})\s*(am|pm)"
        ))
        .expect("valid")
    });
    // (captures, day group, month group)
    let (c, day_group, month_group) = match day_first.captures(text) {
        Some(c) => (c, 1, 2),
        None => (month_first.captures(text)?, 2, 1),
    };
    let day = c[day_group].parse::<i64>().ok()?;
    let month_name = c[month_group].to_string();
    let year = c.get(3).and_then(|y| y.as_str().parse::<i64>().ok());
    let hour = c[4].parse::<i64>().ok()?;
    let minute = c[5].parse::<i64>().ok()?;
    let meridiem = c[6].to_lowercase();
    // STEAM_UNLOCK_MONTHS[monthName.slice(0, 3)] is case-sensitive.
    let month = MONTHS.iter().position(|m| {
        let mut title = m.to_string();
        title[..1].make_ascii_uppercase();
        month_name.get(..3) == Some(title.as_str())
    })? as i64;
    let mut hour = hour;
    if meridiem == "pm" && hour < 12 {
        hour += 12;
    }
    if meridiem == "am" && hour == 12 {
        hour = 0;
    }
    let offset_ms = time_zone_offset_seconds * 1000;
    let year = match year {
        Some(year) => year,
        None => {
            let mut year = i64::from(
                chrono::DateTime::from_timestamp_millis(now_ms)
                    .map(|d| chrono::Datelike::year(&d))
                    .unwrap_or(1970),
            );
            let guessed = date_utc_ms(year, month, day, hour, minute) - offset_ms;
            if guessed > now_ms + 24 * 60 * 60 * 1000 {
                year -= 1;
            }
            year
        }
    };
    iso_from_ms(date_utc_ms(year, month, day, hour, minute) - offset_ms)
}

/// `parseSteamCommunityAchievementsXml`
pub fn parse_achievements_xml(xml: &str) -> Value {
    static SPLIT: OnceLock<Regex> = OnceLock::new();
    static CLOSED: OnceLock<Regex> = OnceLock::new();
    static APINAME: OnceLock<Regex> = OnceLock::new();
    static UNLOCK: OnceLock<Regex> = OnceLock::new();
    let split = SPLIT.get_or_init(|| Regex::new(r"(?i)<achievement(?-u:\b)").expect("valid"));
    let closed = CLOSED.get_or_init(|| Regex::new(r#"(?i)closed\s*=\s*["']1["']"#).expect("valid"));
    let apiname_tag =
        APINAME.get_or_init(|| Regex::new(r"(?is)<apiname>(.*?)</apiname>").expect("valid"));
    let unlock_tag = UNLOCK.get_or_init(|| {
        Regex::new(r"(?is)<unlockTimestamp>(.*?)</unlockTimestamp>").expect("valid")
    });
    let achievements = split
        .split(xml)
        .skip(1)
        .filter_map(|block| {
            let apiname = xml_tag_value(block, apiname_tag);
            if apiname.is_empty() {
                return None;
            }
            let unlock = xml_tag_value(block, unlock_tag);
            let unlock = js_number(&unlock).filter(|f| f.is_finite()).unwrap_or(0.0);
            Some(json!({
                "apiname": apiname,
                "achieved": if closed.is_match(block) { 1 } else { 0 },
                "unlocktime": unlock as i64,
            }))
        })
        .collect();
    playerstats(achievements)
}

/// SteamCommunityHtmlUnlock
#[derive(Clone, Debug, PartialEq)]
pub struct HtmlUnlock {
    pub display_name: String,
    pub description: String,
    pub icon_hash: Option<String>,
    pub unlock_time: String,
}

/// `html.split(/<div(?=[^>]*\bachieveRow\b)/i).slice(1)`
fn split_achieve_rows(html: &str) -> Vec<&str> {
    static WORD: OnceLock<Regex> = OnceLock::new();
    let word = WORD.get_or_init(|| Regex::new(r"(?i)(?-u:\b)achieveRow(?-u:\b)").expect("valid"));
    let lower = html.to_ascii_lowercase();
    let mut starts = Vec::new();
    let mut from = 0;
    while let Some(found) = lower[from..].find("<div") {
        let start = from + found;
        let after = start + 4;
        let tag_end = html[after..].find('>').map_or(html.len(), |e| after + e);
        if word.is_match(&html[after..tag_end]) {
            starts.push(start);
        }
        from = after;
    }
    starts
        .iter()
        .enumerate()
        .map(|(i, &start)| {
            let end = starts.get(i + 1).copied().unwrap_or(html.len());
            &html[start + 4..end]
        })
        .collect()
}

fn floor_char_boundary(text: &str, index: usize) -> usize {
    let mut index = index.min(text.len());
    while !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

/// `parseSteamCommunityAchievementHtml`: the unlocked rows of a stats page.
pub fn parse_achievement_html(
    html: &str,
    time_zone_offset_seconds: i64,
    now_ms: i64,
) -> Vec<HtmlUnlock> {
    static TITLE: OnceLock<Regex> = OnceLock::new();
    static UNLOCK: OnceLock<Regex> = OnceLock::new();
    static IMG: OnceLock<Regex> = OnceLock::new();
    static DESC: OnceLock<Regex> = OnceLock::new();
    static BR: OnceLock<Regex> = OnceLock::new();
    let title =
        TITLE.get_or_init(|| Regex::new(r#"(?is)<h3 class="ellipsis">(.*?)</h3>"#).expect("valid"));
    let unlock = UNLOCK.get_or_init(|| {
        Regex::new(r#"(?is)<div class="achieveUnlockTime">(.*?)</div>"#).expect("valid")
    });
    let img = IMG.get_or_init(|| Regex::new(r#"(?i)<img[^>]+src="([^"]+)""#).expect("valid"));
    let desc = DESC.get_or_init(|| Regex::new(r"(?is)<h5>(.*?)</h5>").expect("valid"));
    let br = BR.get_or_init(|| Regex::new(r"(?i)<br\s*/?>").expect("valid"));
    split_achieve_rows(html)
        .into_iter()
        .filter_map(|chunk| {
            // chunk.slice(0, 5000) counts UTF-16 units; close enough in bytes
            // for Steam's ASCII markup.
            let window = &chunk[..floor_char_boundary(chunk, 5000)];
            let display_name = decode_xml_text(
                title
                    .captures(window)
                    .map_or("", |c| c.get(1).map_or("", |m| m.as_str())),
            );
            let unlock_text = unlock.captures(window)?.get(1)?.as_str();
            if display_name.is_empty() {
                return None;
            }
            let unlock_time = parse_unlock_time_text(
                &br.replace_all(unlock_text, " "),
                time_zone_offset_seconds,
                now_ms,
            )?;
            let image_src = img
                .captures(window)
                .and_then(|c| c.get(1))
                .map_or("", |m| m.as_str());
            Some(HtmlUnlock {
                display_name,
                description: decode_xml_text(
                    desc.captures(window)
                        .and_then(|c| c.get(1))
                        .map_or("", |m| m.as_str()),
                ),
                icon_hash: icon_hash_from_url(image_src),
                unlock_time,
            })
        })
        .collect()
}

/// One schema achievement (SteamGameAchievementSchemaItem).
#[derive(Clone, Debug, PartialEq)]
pub struct SchemaItem {
    pub internal_name: String,
    pub localized_name: String,
    pub localized_desc: String,
    pub icon: String,
    pub icon_hash: Option<String>,
    pub hidden: bool,
}

/// `parseSteamGameAchievementSchema`
pub fn parse_achievement_schema(payload: &Value) -> Vec<SchemaItem> {
    let root = payload.as_object().map(|map| match map.get("response") {
        Some(Value::Object(response)) => response,
        _ => map,
    });
    let Some(Value::Array(items)) = root.and_then(|r| r.get("achievements")) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|item| {
            let internal_name = as_trimmed_string(item.get("internal_name"));
            if internal_name.is_empty() {
                return None;
            }
            let icon = Some(as_trimmed_string(item.get("icon")))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| as_trimmed_string(item.get("icon_gray")));
            Some(SchemaItem {
                internal_name,
                localized_name: as_trimmed_string(item.get("localized_name")),
                localized_desc: as_trimmed_string(item.get("localized_desc")),
                icon_hash: icon_hash_from_url(&icon),
                icon,
                hidden: truthy(item.get("hidden")),
            })
        })
        .collect()
}

fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `mapCommunityHtmlToPlayerstats`: page rows to API names, by icon, then
/// name, then description.
pub fn map_html_to_playerstats(unlocks: &[HtmlUnlock], schema: &[SchemaItem]) -> Value {
    let mut used: HashSet<&str> = HashSet::new();
    let mut achievements = Vec::new();
    for unlock in unlocks {
        let free =
            |item: &&SchemaItem, used: &HashSet<&str>| !used.contains(item.internal_name.as_str());
        let by_icon = unlock.icon_hash.as_ref().and_then(|hash| {
            schema
                .iter()
                .find(|item| item.icon_hash.as_ref() == Some(hash) && free(item, &used))
        });
        let by_name = by_icon.or_else(|| {
            schema
                .iter()
                .find(|item| item.localized_name == unlock.display_name && free(item, &used))
        });
        let by_desc = by_name.or_else(|| {
            (!unlock.description.is_empty())
                .then(|| {
                    schema
                        .iter()
                        .find(|item| item.localized_desc == unlock.description && free(item, &used))
                })
                .flatten()
        });
        let Some(item) = by_desc else {
            continue;
        };
        used.insert(item.internal_name.as_str());
        let unlock_ms = chrono::DateTime::parse_from_rfc3339(&unlock.unlock_time)
            .map(|d| d.timestamp_millis())
            .unwrap_or(0);
        achievements.push(json!({
            "apiname": item.internal_name,
            "achieved": 1,
            "unlocktime": unlock_ms.div_euclid(1000),
        }));
    }
    playerstats(achievements)
}

/// `steamCommunityStatsXmlUrl`
pub fn stats_xml_url(steam_id64: &str, steam_app_id: &str) -> String {
    format!("{COMMUNITY_ORIGIN}/profiles/{steam_id64}/stats/{steam_app_id}/?xml=1")
}

/// `steamCommunityStatsHtmlUrl`
pub fn stats_html_url(steam_id64: &str, steam_app_id: &str) -> String {
    format!("{COMMUNITY_ORIGIN}/profiles/{steam_id64}/stats/{steam_app_id}/achievements?l=english")
}

/// `steamCommunityOwnerStatsHtmlUrl`
pub fn owner_stats_html_url(steam_app_id: &str) -> String {
    format!("{COMMUNITY_ORIGIN}/my/stats/{steam_app_id}")
}

/// `steamCommunityStatsXmlUrlForPage`: the XML form of a page Steam
/// redirected to (vanity URLs).
pub fn stats_xml_url_for_page(page_url: &str) -> Option<String> {
    let mut url = reqwest::Url::parse(page_url).ok()?;
    url.set_query(Some("xml=1"));
    url.set_fragment(None);
    if !url.path().ends_with('/') {
        let path = format!("{}/", url.path());
        url.set_path(&path);
    }
    Some(url.to_string())
}

/// `steamAchievementIconUrl`
pub fn achievement_icon_url(steam_app_id: &str, icon: &str) -> String {
    if icon.is_empty() {
        return String::new();
    }
    let lower = icon.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return icon.to_string();
    }
    let file = if icon.contains('.') {
        icon.to_string()
    } else {
        format!("{icon}.jpg")
    };
    format!(
        "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/{steam_app_id}/{file}"
    )
}

/// `catalogueFromSteamSchema`: the achievement list the game page shows.
pub fn catalogue_from_schema(steam_app_id: &str, payload: &Value) -> Vec<Value> {
    parse_achievement_schema(payload)
        .into_iter()
        .map(|item| {
            let icon = achievement_icon_url(steam_app_id, &item.icon);
            let mut entry = Obj::new();
            entry.insert("name".into(), json!(item.internal_name));
            entry.insert(
                "displayName".into(),
                json!(if item.localized_name.is_empty() {
                    item.internal_name.clone()
                } else {
                    item.localized_name.clone()
                }),
            );
            if !item.localized_desc.is_empty() {
                entry.insert("description".into(), json!(item.localized_desc));
            }
            entry.insert("icon".into(), json!(icon));
            entry.insert("icongray".into(), json!(icon));
            entry.insert("hidden".into(), json!(item.hidden));
            Value::Object(entry)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token() -> SteamToken {
        SteamToken {
            steam_id64: "76561198000000001".into(),
            access_token: "tok".into(),
        }
    }

    #[test]
    fn store_config_gives_the_token() {
        let user = r#"{"logged_in":true,"steamid":"76561198000000001"}"#;
        let store = r#"{"webapi_token":" abc "}"#;
        assert_eq!(
            parse_store_session_config(
                Some(user),
                Some(store),
                "https://store.steampowered.com/explore/"
            ),
            Ok(SteamToken {
                steam_id64: "76561198000000001".into(),
                access_token: "abc".into()
            })
        );
        assert_eq!(
            parse_store_session_config(
                Some(user),
                Some(store),
                "https://store.steampowered.com/login/"
            ),
            Err(SteamError::SessionRequired)
        );
        let logged_out = r#"{"logged_in":false}"#;
        assert_eq!(
            parse_store_session_config(Some(logged_out), Some(store), "https://x/"),
            Err(SteamError::SessionRequired)
        );
        assert_eq!(
            parse_store_session_config(None, Some(store), "https://x/"),
            Err(SteamError::SessionRequired)
        );
    }

    #[test]
    fn community_login_states() {
        assert_eq!(
            parse_community_page_steam_id(
                "https://steamcommunity.com/id/loginking/",
                &json!("76561198000000001")
            ),
            Some("76561198000000001".into())
        );
        assert_eq!(
            parse_community_page_steam_id(
                "https://steamcommunity.com/login/home/",
                &json!("76561198000000001")
            ),
            None
        );
        assert_eq!(
            parse_community_page_steam_id("https://steamcommunity.com/my/", &json!(false)),
            None
        );
        assert_eq!(
            resolve_community_login(None, true),
            CommunityLogin::Unverified
        );
        assert_eq!(
            resolve_community_login(None, false),
            CommunityLogin::LoggedOut
        );
        assert_eq!(
            resolve_community_login(Some(None), true),
            CommunityLogin::LoggedOut
        );
    }

    #[test]
    fn web_api_urls_match_electron() {
        assert_eq!(
            owned_games_url(&token()),
            "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?access_token=tok&steamid=76561198000000001&format=json&include_appinfo=1&include_played_free_games=1"
        );
        assert_eq!(
            family_group_url(&token()),
            "https://api.steampowered.com/IFamilyGroupsService/GetFamilyGroupForUser/v1/?access_token=tok&format=json"
        );
        assert!(owned_game_url(&token(), "620").ends_with(
            "&format=json&input_json=%7B%22include_appinfo%22%3Atrue%2C%22include_played_free_games%22%3Atrue%2C%22appids_filter%22%3A%5B620%5D%7D"
        ));
    }

    #[test]
    fn retry_policy() {
        let rate = SteamError::Http {
            status: 429,
            body: Value::Null,
            retry_after_seconds: None,
        };
        assert!(should_retry(&rate, 4));
        assert!(!should_retry(&rate, 5));
        assert_eq!(retry_delay_ms(&rate, 1), 1000);
        assert_eq!(retry_delay_ms(&rate, 6), 30_000);
        let bad = SteamError::Http {
            status: 502,
            body: Value::Null,
            retry_after_seconds: None,
        };
        assert_eq!(retry_delay_ms(&bad, 2), 1000);
        assert!(!should_retry(&bad, 3));
        assert_eq!(parse_retry_after(Some(" 7 ")), Some(7));
        assert_eq!(parse_retry_after(Some("Wed, 21 Oct")), None);
    }

    #[test]
    fn library_and_titles() {
        let payload = json!({ "response": { "games": [
            { "appid": 620, "name": "Portal 2", "playtime_forever": 10, "playtime_disconnected": 2, "rtime_last_played": 1_700_000_000 },
            { "appid": 0, "name": "Bad" },
            { "appid": "730", "name": "CS", "playtime_forever": 0, "rtime_last_played": 0 },
        ]}});
        let games = parse_source_library(&payload);
        assert_eq!(games.len(), 2);
        assert_eq!(games[0].play_time_in_seconds, 720);
        assert_eq!(
            games[0].last_played_at.as_deref(),
            Some("2023-11-14T22:13:20.000Z")
        );
        assert_eq!(games[1].last_played_at, None);
        assert!(is_skipped_library_title("Game Demo"));
        assert!(is_skipped_library_title("Thing Public-Test"));
        assert!(is_skipped_library_title("Foo PTB"));
        assert!(!is_skipped_library_title("Demolition Man"));
        assert!(!is_skipped_library_title("Portal 2"));
    }

    #[test]
    fn family_games_merge_with_owned() {
        let owned = vec![SourceGame {
            steam_app_id: "1".into(),
            name: "Owned".into(),
            play_time_in_seconds: 60,
            last_played_at: None,
        }];
        let family = parse_shared_library_apps(&json!({ "response": { "apps": [
            { "appid": 1, "name": "Owned again", "rt_playtime": 5 },
            { "appid": 2, "name": " Shared ", "rt_playtime": "3", "rt_last_played": 1_700_000_000 },
            { "appid": 3, "name": "Excluded", "exclude_reason": 1 },
            { "appid": 4, "name": "Tool", "app_type": 4 },
        ]}}));
        assert_eq!(family.len(), 2);
        assert_eq!(family[1].name, "Shared");
        let last_played = parse_last_played_times(&json!({ "response": { "games": [
            { "appid": 1, "playtime_forever": 5, "last_playtime": 1_700_000_000 },
        ]}}));
        let playtime = merge_playtime_maps(&[last_played, playtime_from_shared_apps(&family)]);
        let games = merge_owned_and_family_games(&owned, &family, &playtime);
        assert_eq!(games.len(), 2);
        // 5 minutes beats 60 seconds.
        assert_eq!(games[0].play_time_in_seconds, 300);
        assert_eq!(games[0].name, "Owned");
        assert_eq!(games[1].steam_app_id, "2");
        assert_eq!(games[1].play_time_in_seconds, 180);
        assert_eq!(
            parse_family_group_id(&json!({ "response": { "family_groupid": "0" } })),
            None
        );
        assert_eq!(
            parse_family_group_id(&json!({ "response": { "family_groupid": "123" } })),
            Some("123".into())
        );
        let summary = parse_family_playtime(
            &json!({ "response": { "entries": [
                { "appid": 9, "steamid": "76561198000000001", "seconds": 40 },
                { "appid": 9, "steamid": "other", "seconds": 999 },
            ]}}),
            "76561198000000001",
        );
        assert_eq!(summary[0].1.play_time_in_seconds, 40);
    }

    #[test]
    fn snapshot_chunks_split_achievements() {
        let games = vec![
            SourceGame {
                steam_app_id: "1".into(),
                name: "A".into(),
                play_time_in_seconds: 1,
                last_played_at: None,
            },
            SourceGame {
                steam_app_id: "2".into(),
                name: "B".into(),
                play_time_in_seconds: 2,
                last_played_at: Some("2024-01-01T00:00:00.000Z".into()),
            },
        ];
        let many: Vec<SourceAchievement> = (0..2500)
            .map(|i| SourceAchievement {
                name: format!("a{i}"),
                unlocked: true,
                unlock_time: Some("2024-01-01T00:00:00.000Z".into()),
            })
            .collect();
        let mut by_app = HashMap::new();
        by_app.insert("1".to_string(), None);
        by_app.insert("2".to_string(), Some(many));
        let snapshot = build_snapshot(&games, &by_app);
        assert!(snapshot["games"][0].get("achievements").is_none());
        assert_eq!(snapshot_unlocked_count(&snapshot), 2500);
        let chunks = chunk_snapshot(&snapshot);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0]["totalChunks"], 2);
        assert_eq!(chunks[0]["games"].as_array().unwrap().len(), 2);
        assert_eq!(
            chunks[0]["games"][1]["achievements"]
                .as_array()
                .unwrap()
                .len(),
            2000
        );
        assert_eq!(
            chunks[1]["games"][0]["achievements"]
                .as_array()
                .unwrap()
                .len(),
            500
        );
        let empty = chunk_snapshot(&json!({ "games": [] }));
        assert_eq!(empty, vec![json!({ "totalChunks": 1, "games": [] })]);
        let (legacy, uploads) = legacy_snapshot_fallback(&snapshot);
        assert!(legacy["games"][1].get("achievements").is_none());
        assert_eq!(uploads[0].0, "2");
        assert_eq!(uploads[0].1.len(), 2);
    }

    #[test]
    fn community_xml_and_html() {
        let xml = r#"<playerstats><achievements>
            <achievement closed="1"><apiname><![CDATA[ACH_WIN]]></apiname><unlockTimestamp>1700000000</unlockTimestamp></achievement>
            <achievement closed="0"><apiname>ACH_LOSE</apiname></achievement>
        </achievements></playerstats>"#;
        assert!(is_playerstats_xml(xml));
        assert!(!is_private_stats_xml(xml));
        let parsed = parse_achievements_xml(xml);
        assert_eq!(
            parsed,
            json!({ "playerstats": { "achievements": [
                { "apiname": "ACH_WIN", "achieved": 1, "unlocktime": 1_700_000_000 },
                { "apiname": "ACH_LOSE", "achieved": 0, "unlocktime": 0 },
            ]}})
        );
        let html = r#"<div class="achieveRow "><div class="achieveImgHolder"><img src="https://cdn/x/0123456789abcdef0123.jpg"></div>
            <div class="achieveTxt"><h3 class="ellipsis">Winner &amp; Co</h3><h5>Win once</h5></div>
            <div class="achieveUnlockTime">Unlocked 3 Feb, 2024 @ 4:05pm<br></div></div>
            <div class="achieveRow"><h3 class="ellipsis">Locked</h3></div>"#;
        let rows = parse_achievement_html(html, -10800, 1_750_000_000_000);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].display_name, "Winner & Co");
        assert_eq!(rows[0].icon_hash.as_deref(), Some("0123456789abcdef0123"));
        // 16:05 at UTC-3 is 19:05 UTC.
        assert_eq!(rows[0].unlock_time, "2024-02-03T19:05:00.000Z");
        let schema = parse_achievement_schema(&json!({ "response": { "achievements": [
            { "internal_name": "A1", "localized_name": "Winner & Co", "icon": "abc" },
        ]}}));
        let mapped = map_html_to_playerstats(&rows, &schema);
        assert_eq!(mapped["playerstats"]["achievements"][0]["apiname"], "A1");
        assert_eq!(
            mapped["playerstats"]["achievements"][0]["unlocktime"],
            1_706_987_100
        );
        assert_eq!(parse_timezone_offset_seconds(Some("-10800,0")), -10800);
        assert_eq!(parse_timezone_offset_seconds(Some("x")), 0);
    }

    #[test]
    fn unlock_text_without_a_year() {
        // 2025-06-15 12:00 UTC
        let now = 1_749_988_800_000;
        assert_eq!(
            parse_unlock_time_text("Unlocked Jun 14 @ 9:00am", 0, now).as_deref(),
            Some("2025-06-14T09:00:00.000Z")
        );
        // Dec 31 would be in the future: last year.
        assert_eq!(
            parse_unlock_time_text("Unlocked 31 Dec @ 12:30am", 0, now).as_deref(),
            Some("2024-12-31T00:30:00.000Z")
        );
        assert_eq!(parse_unlock_time_text("nothing", 0, now), None);
    }

    #[test]
    fn icons_and_failure_messages() {
        assert_eq!(
            achievement_icon_url("620", "abc"),
            "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/620/abc.jpg"
        );
        assert_eq!(
            achievement_icon_url("620", "https://x/y.png"),
            "https://x/y.png"
        );
        assert_eq!(
            sync_failure_message(&SteamError::SessionRequired),
            "steam-session-required"
        );
        assert_eq!(
            sync_failure_message(&SteamError::Http {
                status: 429,
                body: Value::Null,
                retry_after_seconds: None
            }),
            "profile/steam-rate-limited"
        );
        assert_eq!(
            sync_failure_message(&SteamError::Hydra {
                status: Some(400),
                message: Some("steam-profile-private".into())
            }),
            "steam-profile-private"
        );
        assert_eq!(
            stats_xml_url_for_page("https://steamcommunity.com/id/me/stats/620?tab=x#y").as_deref(),
            Some("https://steamcommunity.com/id/me/stats/620/?xml=1")
        );
    }
}
