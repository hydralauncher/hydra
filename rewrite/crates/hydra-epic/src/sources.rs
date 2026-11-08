//! source-retry.ts, playtime-source.ts, achievement-source.ts and
//! achievement-protocol.ts: Epic's own APIs read with the session's access
//! token (playtime from the library service, unlocks from the launcher's
//! GraphQL), with Electron's retry policy.

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use reqwest::blocking::{Client, RequestBuilder, Response};
use serde_json::{Value, json};

use crate::cancel::Cancel;
use crate::error::{EpicError, Result, err};
use crate::library::{SnapshotAchievement, SnapshotGame, normalize_playtime};
use crate::protocol::is_integer;
use crate::session::{Context, SessionProvider};
use crate::snapshot::{EPIC_SNAPSHOT_CHUNK_GAMES, EPIC_SNAPSHOT_MAX_CHUNK_BYTES, json_len};
use crate::time::{iso, now_ms, parse_ms};

pub const EPIC_PLAYTIME_ORIGIN: &str = "https://library-service.live.use1a.on.epicgames.com";
pub const EPIC_ACHIEVEMENT_GRAPHQL_URL: &str = "https://launcher.store.epicgames.com/graphql";
pub const EPIC_SOURCE_TIMEOUT: Duration = Duration::from_secs(15);
pub const EPIC_PLAYTIME_CACHE: Duration = Duration::from_secs(15);
pub const EPIC_ACHIEVEMENT_BUDGET: Duration = Duration::from_secs(90);
pub const EPIC_ACHIEVEMENT_CONCURRENCY: usize = 4;
pub const EPIC_ACHIEVEMENT_MAX_PER_GAME: usize = 2_000;
pub const EPIC_ACHIEVEMENT_MAX_PER_SNAPSHOT: usize = 100_000;
pub const EPIC_ACHIEVEMENT_MAX_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;
pub const EPIC_ACHIEVEMENT_MAX_GAME_BYTES: usize = EPIC_SNAPSHOT_MAX_CHUNK_BYTES / 2;
const EPIC_RATE_LIMIT_ATTEMPTS: u32 = 5;
const EPIC_NETWORK_ATTEMPTS: u32 = 3;
const EPIC_RATE_LIMIT_BACKOFF: Duration = Duration::from_millis(1_000);
const EPIC_NETWORK_BACKOFF: Duration = Duration::from_millis(500);
const EPIC_MAX_BACKOFF: Duration = Duration::from_secs(30);

/// The HTTP client for Epic's endpoints (`redirect: "error"`).
pub fn client() -> Client {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_default()
}

/// epicRetryAfter: seconds or an HTTP date.
pub fn retry_after(value: Option<&str>, now: i64) -> Option<Duration> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    if let Ok(seconds) = value.parse::<f64>()
        && seconds.is_finite()
        && seconds >= 0.0
    {
        return Some(Duration::from_millis((seconds * 1000.0) as u64));
    }
    let date = chrono::DateTime::parse_from_rfc2822(value)
        .ok()
        .map(|d| d.timestamp_millis())
        .or_else(|| parse_ms(value))?;
    Some(Duration::from_millis((date - now).max(0) as u64))
}

/// fetchEpicWithRetry: one token refresh on 401, backoff on 429 and 5xx,
/// fixed error codes otherwise.
pub fn fetch_with_retry(
    request: &mut dyn FnMut() -> RequestBuilder,
    cancel: &Cancel,
    refresh: &mut dyn FnMut() -> Result<()>,
) -> Result<Response> {
    let (mut refreshed, mut network, mut rate) = (false, 0u32, 0u32);
    loop {
        cancel.check()?;
        let response = match request().timeout(EPIC_SOURCE_TIMEOUT).send() {
            Ok(response) if response.status().is_redirection() => Err(()),
            Ok(response) => Ok(response),
            Err(_) => Err(()),
        };
        let response = match response {
            Ok(response) => response,
            Err(()) => {
                cancel.check()?;
                network += 1;
                if network >= EPIC_NETWORK_ATTEMPTS {
                    return err("network");
                }
                cancel.sleep(EPIC_NETWORK_BACKOFF * 2u32.pow(network - 1))?;
                continue;
            }
        };
        let status = response.status().as_u16();
        if response.status().is_success() {
            return Ok(response);
        }
        if status == 401 && !refreshed {
            refreshed = true;
            refresh()?;
            continue;
        }
        match status {
            401 => return err("session-expired"),
            403 => return err("source-permission"),
            429 if {
                rate += 1;
                rate < EPIC_RATE_LIMIT_ATTEMPTS
            } =>
            {
                let delay = retry_after(
                    response
                        .headers()
                        .get("retry-after")
                        .and_then(|v| v.to_str().ok()),
                    now_ms(),
                )
                .unwrap_or_else(|| {
                    (EPIC_RATE_LIMIT_BACKOFF * 2u32.pow(rate - 1)).min(EPIC_MAX_BACKOFF)
                });
                cancel.sleep(delay)?;
                continue;
            }
            500 | 502 | 503 | 504
                if {
                    network += 1;
                    network < EPIC_NETWORK_ATTEMPTS
                } =>
            {
                cancel.sleep(EPIC_NETWORK_BACKOFF * 2u32.pow(network - 1))?;
                continue;
            }
            _ => {}
        }
        return err(if status == 429 {
            "rate-limit"
        } else {
            "api-unavailable"
        });
    }
}

fn read_json(response: Response, max: u64) -> Result<Value> {
    let mut bytes = Vec::new();
    let read = response
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| EpicError::new("invalid-response"))?;
    if read as u64 > max {
        return err("snapshot-too-large");
    }
    serde_json::from_slice(&bytes).map_err(|_| EpicError::new("invalid-response"))
}

/// EpicPlaytimeSource: Epic's playtime per artifact, cached for 15s.
pub struct PlaytimeSource {
    client: Client,
    cache: Mutex<HashMap<String, (Instant, HashMap<String, i64>)>>,
    flight: Mutex<()>,
}

impl Default for PlaytimeSource {
    fn default() -> Self {
        PlaytimeSource {
            client: client(),
            cache: Mutex::new(HashMap::new()),
            flight: Mutex::new(()),
        }
    }
}

fn cache_key(context: &Context) -> String {
    json!([
        context.auth.environment,
        context.auth.user_id,
        context.auth.generation,
        context.connection.connection_id,
        context.connection.epic_account_id
    ])
    .to_string()
}

impl PlaytimeSource {
    pub fn clear_cache(&self) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.clear();
        }
    }

    pub fn get(
        &self,
        session: &SessionProvider,
        context: &Context,
        cancel: &Cancel,
        is_current: &dyn Fn() -> bool,
        fresh: bool,
    ) -> Result<HashMap<String, i64>> {
        cancel.check()?;
        let key = cache_key(context);
        let _flight = self.flight.lock().unwrap_or_else(|e| e.into_inner());
        if !fresh
            && let Some((at, value)) = self.cache.lock().ok().and_then(|c| c.get(&key).cloned())
            && at.elapsed() < EPIC_PLAYTIME_CACHE
        {
            return Ok(value);
        }
        let cancel = cancel.with_timeout(crate::runner::EPIC_SYNC_TIMEOUT);
        let mut token = session.token(context, &cancel, is_current, false)?;
        let url = format!(
            "{EPIC_PLAYTIME_ORIGIN}/library/api/public/playtime/account/{}/all",
            context.connection.epic_account_id
        );
        let token_cell = std::cell::RefCell::new(&mut token);
        let response = fetch_with_retry(
            &mut || {
                self.client
                    .get(&url)
                    .header("Authorization", format!("Bearer {}", token_cell.borrow()))
                    .header("Accept", "application/json")
            },
            &cancel,
            &mut || {
                if let Ok(mut cache) = self.cache.lock() {
                    cache.remove(&key);
                }
                let fresh = session.token(context, &cancel, is_current, true)?;
                **token_cell.borrow_mut() = fresh;
                Ok(())
            },
        )?;
        let input = read_json(response, u64::MAX / 2)?;
        let value = normalize_playtime(&input, &context.connection.epic_account_id)?;
        cancel.check()?;
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(key, (Instant::now(), value.clone()));
        }
        Ok(value)
    }
}

pub const EPIC_PLAYER_ACHIEVEMENT_QUERY: &str = "query PlayerAchievement($epicAccountId: String!, $sandboxId: String!) {
  PlayerAchievement { playerAchievementGameRecordsBySandbox(epicAccountId: $epicAccountId, sandboxId: $sandboxId) {
    records { totalUnlocked playerAchievements { playerAchievement { epicAccountId sandboxId achievementSetId achievementName unlocked unlockDate } } }
  } }
}";

/// EpicAchievementTarget
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AchievementTarget {
    pub object_id: String,
    pub status: String,
    pub sandbox_id: Option<String>,
}

fn achievement_id(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str).filter(|v| {
        !v.is_empty()
            && v.encode_utf16().count() <= crate::library::EPIC_ID_MAX_LENGTH
            && !v.chars().any(|c| c.is_control())
    })
}

/// parseEpicAchievementTargets: POST …/achievement-targets.
pub fn parse_achievement_targets(
    value: &Value,
    object_ids: &[String],
) -> Result<Vec<AchievementTarget>> {
    let invalid = || EpicError::new("invalid-response");
    let rows = value
        .get("targets")
        .and_then(Value::as_array)
        .filter(|t| value.is_object() && t.len() == object_ids.len())
        .ok_or_else(invalid)?;
    let expected: HashSet<&str> = object_ids.iter().map(String::as_str).collect();
    let mut seen = HashSet::new();
    rows.iter()
        .map(|row| {
            let object_id = row
                .get("objectId")
                .and_then(Value::as_str)
                .ok_or_else(invalid)?;
            let status = row
                .get("status")
                .and_then(Value::as_str)
                .ok_or_else(invalid)?;
            let sandbox = achievement_id(row.get("achievementSandboxId"));
            if !row.is_object()
                || !expected.contains(object_id)
                || !seen.insert(object_id.to_string())
                || !["supported", "unsupported", "unavailable"].contains(&status)
                || (status == "supported" && sandbox.is_none())
            {
                return Err(invalid());
            }
            Ok(AchievementTarget {
                object_id: object_id.into(),
                status: status.into(),
                sandbox_id: sandbox.map(str::to_string),
            })
        })
        .collect()
}

/// parseEpicPlayerAchievements: the unlocked achievements of one sandbox.
pub fn parse_player_achievements(
    value: &Value,
    account_id: &str,
    sandbox_id: &str,
) -> Result<Vec<SnapshotAchievement>> {
    let invalid = || EpicError::new("invalid-response");
    if !value.is_object() {
        return Err(invalid());
    }
    if let Some(errors) = value.get("errors") {
        let list = errors.as_array().cloned().unwrap_or_default();
        if !errors.is_array() || !list.is_empty() {
            let codes: Vec<String> = list
                .iter()
                .map(|e| {
                    e.get("extensions")
                        .filter(|x| x.is_object())
                        .and_then(|x| x.get("code"))
                        .map(|c| {
                            c.as_str()
                                .map(str::to_string)
                                .unwrap_or_else(|| c.to_string())
                        })
                        .unwrap_or_default()
                        .to_ascii_lowercase()
                })
                .collect();
            let any = |patterns: &[&str]| {
                codes.iter().any(|code| {
                    let flat = code.replace(['_', '-', ' ', '.'], "");
                    patterns
                        .iter()
                        .any(|p| code.contains(p) || flat.contains(p))
                })
            };
            if any(&["unauthenticated", "invalidtoken", "authentication"]) {
                return err("session-expired");
            }
            if any(&["forbidden", "permission", "privacy"]) {
                return err("source-permission");
            }
            if any(&["ratelimit", "toomany"]) {
                return err("rate-limit");
            }
            return Err(invalid());
        }
    }
    let records = value
        .get("data")
        .and_then(|d| d.get("PlayerAchievement"))
        .and_then(|p| p.get("playerAchievementGameRecordsBySandbox"))
        .and_then(|r| r.get("records"))
        .and_then(Value::as_array)
        .filter(|r| r.len() == 1)
        .ok_or_else(invalid)?;
    let record = &records[0];
    let total = record
        .get("totalUnlocked")
        .filter(|t| is_integer(t))
        .and_then(Value::as_f64)
        .filter(|t| *t >= 0.0)
        .ok_or_else(invalid)? as usize;
    let entries = record
        .get("playerAchievements")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    let mut unlocked = Vec::new();
    let mut seen = HashSet::new();
    for entry in entries {
        let row = entry
            .get("playerAchievement")
            .filter(|r| r.is_object())
            .ok_or_else(invalid)?;
        let set = achievement_id(row.get("achievementSetId"));
        let name = achievement_id(row.get("achievementName"));
        let (Some(set), Some(name), Some(is_unlocked)) =
            (set, name, row.get("unlocked").and_then(Value::as_bool))
        else {
            return Err(invalid());
        };
        if row.get("epicAccountId").and_then(Value::as_str) != Some(account_id)
            || row.get("sandboxId").and_then(Value::as_str) != Some(sandbox_id)
            || !seen.insert((set.to_string(), name.to_string()))
        {
            return Err(invalid());
        }
        if !is_unlocked {
            continue;
        }
        let date = row
            .get("unlockDate")
            .and_then(Value::as_str)
            .filter(|d| {
                let shaped = d.len() >= 11
                    && d.as_bytes()[4] == b'-'
                    && d.as_bytes()[7] == b'-'
                    && d.as_bytes()[10] == b'T'
                    && d[..4].chars().all(|c| c.is_ascii_digit())
                    && (d.ends_with('Z') || {
                        let tail = &d[d.len().saturating_sub(6)..];
                        (tail.starts_with('+') || tail.starts_with('-')) && &tail[3..4] == ":"
                    });
                shaped
            })
            .and_then(parse_ms)
            .filter(|ms| *ms > 0)
            .ok_or_else(invalid)?;
        unlocked.push(SnapshotAchievement {
            external_set_id: set.into(),
            external_id: name.into(),
            unlock_time: iso(date),
        });
    }
    if unlocked.len() != total || unlocked.len() > EPIC_ACHIEVEMENT_MAX_PER_GAME {
        return Err(invalid());
    }
    let key = |a: &SnapshotAchievement| json!([a.external_set_id, a.external_id]).to_string();
    unlocked.sort_by(|a, b| crate::library::compare_epic_strings(&key(a), &key(b)));
    Ok(unlocked)
}

/// EpicAchievementCollection
pub struct AchievementCollection {
    pub games: Vec<SnapshotGame>,
    pub pending_object_ids: Vec<String>,
    pub requires_reconnect: bool,
}

/// EpicAchievementSource.collect: unlocks for the supported games, pending
/// games first, within the time budget.
pub fn collect_achievements(
    session: &SessionProvider,
    context: &Context,
    games: &[SnapshotGame],
    parent: &Cancel,
    is_current: &(dyn Fn() -> bool + Sync),
    targets: &dyn Fn(&[String], &Cancel) -> Result<Vec<AchievementTarget>>,
    pending: &[String],
    progress: &(dyn Fn(usize, usize) + Sync),
    budget: Duration,
) -> Result<AchievementCollection> {
    parent.check()?;
    let cancel = parent.with_timeout(budget.max(Duration::from_millis(1)));
    let priority: HashSet<&str> = pending.iter().map(String::as_str).collect();
    let mut ordered: Vec<SnapshotGame> = games.to_vec();
    ordered.sort_by_key(|g| !priority.contains(g.object_id().as_str()));
    let total = games.len();
    let client = client();
    let results: Mutex<HashMap<String, Option<Vec<SnapshotAchievement>>>> =
        Mutex::new(HashMap::new());
    let completed: Mutex<HashMap<String, Option<Vec<SnapshotAchievement>>>> =
        Mutex::new(HashMap::new());
    let mut unsupported: HashSet<String> = HashSet::new();
    let processed = Mutex::new(0usize);
    let requires_reconnect = std::sync::atomic::AtomicBool::new(false);
    let bump = |count: usize| {
        let mut done = processed.lock().unwrap_or_else(|e| e.into_inner());
        *done += count;
        progress(*done, total);
    };
    let reconnect = || requires_reconnect.load(std::sync::atomic::Ordering::SeqCst);
    let mut start = 0;
    while start < ordered.len() && !cancel.is_cancelled() && !reconnect() {
        let ids: Vec<String> = ordered
            [start..(start + EPIC_SNAPSHOT_CHUNK_GAMES).min(ordered.len())]
            .iter()
            .map(SnapshotGame::object_id)
            .collect();
        start += EPIC_SNAPSHOT_CHUNK_GAMES;
        let mut supported: Vec<(String, Vec<String>)> = Vec::new();
        match targets(&ids, &cancel) {
            Ok(list) => {
                for target in list {
                    if target.status == "unsupported" {
                        unsupported.insert(target.object_id.clone());
                    }
                    let Some(sandbox) = target.sandbox_id.filter(|_| target.status == "supported")
                    else {
                        bump(1);
                        continue;
                    };
                    let done = completed.lock().ok().and_then(|c| c.get(&sandbox).cloned());
                    if let Some(achievements) = done {
                        if let Ok(mut r) = results.lock() {
                            r.insert(target.object_id.clone(), achievements);
                        }
                        bump(1);
                        continue;
                    }
                    match supported.iter_mut().find(|(s, _)| *s == sandbox) {
                        Some((_, members)) => members.push(target.object_id),
                        None => supported.push((sandbox, vec![target.object_id])),
                    }
                }
            }
            Err(_) => parent.check()?,
        }
        let next = Mutex::new(0usize);
        let refresh_lock = Mutex::new(());
        std::thread::scope(|scope| {
            for _ in 0..EPIC_ACHIEVEMENT_CONCURRENCY {
                scope.spawn(|| {
                    loop {
                        if cancel.is_cancelled() || reconnect() {
                            break;
                        }
                        let item = {
                            let mut index = next.lock().unwrap_or_else(|e| e.into_inner());
                            let item = supported.get(*index).cloned();
                            *index += 1;
                            item
                        };
                        let Some((sandbox, members)) = item else {
                            break;
                        };
                        let outcome = (|| -> Result<Vec<SnapshotAchievement>> {
                            let mut token = session.token(context, &cancel, is_current, false)?;
                            let mut graphql_refreshed = false;
                            loop {
                                let token_cell = std::cell::RefCell::new(token.clone());
                                let body = json!({
                                    "query": EPIC_PLAYER_ACHIEVEMENT_QUERY,
                                    "variables": {
                                        "epicAccountId": context.connection.epic_account_id,
                                        "sandboxId": sandbox,
                                    },
                                });
                                let renew = |used: &str| -> Result<String> {
                                    let _guard =
                                        refresh_lock.lock().unwrap_or_else(|e| e.into_inner());
                                    let current =
                                        session.token(context, &cancel, is_current, false)?;
                                    if current != used {
                                        Ok(current)
                                    } else {
                                        session.token(context, &cancel, is_current, true)
                                    }
                                };
                                let response = fetch_with_retry(
                                    &mut || {
                                        client
                                            .post(EPIC_ACHIEVEMENT_GRAPHQL_URL)
                                            .header(
                                                "Authorization",
                                                format!("Bearer {}", token_cell.borrow()),
                                            )
                                            .header("Content-Type", "application/json")
                                            .header("Accept", "application/json")
                                            .header("User-Agent", "EpicGamesLauncher/15.0.0")
                                            .header("Origin", "https://store.epicgames.com")
                                            .header("Referer", "https://store.epicgames.com/")
                                            .body(body.to_string())
                                    },
                                    &cancel,
                                    &mut || {
                                        let fresh = renew(&token_cell.borrow())?;
                                        *token_cell.borrow_mut() = fresh;
                                        Ok(())
                                    },
                                )?;
                                token = token_cell.into_inner();
                                let value =
                                    read_json(response, EPIC_ACHIEVEMENT_MAX_RESPONSE_BYTES)?;
                                match parse_player_achievements(
                                    &value,
                                    &context.connection.epic_account_id,
                                    &sandbox,
                                ) {
                                    Ok(achievements) => {
                                        cancel.check()?;
                                        return Ok(achievements);
                                    }
                                    Err(error)
                                        if error.is("session-expired") && !graphql_refreshed =>
                                    {
                                        graphql_refreshed = true;
                                        token = renew(&token)?;
                                    }
                                    Err(error) => return Err(error),
                                }
                            }
                        })();
                        let achievements = match outcome {
                            Ok(list) => Some(list),
                            Err(error) => {
                                if error.is("session-expired") {
                                    requires_reconnect
                                        .store(true, std::sync::atomic::Ordering::SeqCst);
                                }
                                None
                            }
                        };
                        if let Ok(mut c) = completed.lock() {
                            c.insert(sandbox.clone(), achievements.clone());
                        }
                        if let Ok(mut r) = results.lock() {
                            for id in &members {
                                r.insert(id.clone(), achievements.clone());
                            }
                        }
                        bump(members.len());
                    }
                });
            }
        });
        parent.check()?;
    }
    parent.check()?;
    let results = results.into_inner().unwrap_or_default();
    let mut count = 0usize;
    let enriched: Vec<SnapshotGame> = ordered
        .into_iter()
        .map(|mut game| {
            let mut achievements = results.get(&game.object_id()).cloned().flatten();
            if let Some(list) = &achievements {
                let mut probe = game.clone();
                probe.achievements = Some(Some(list.clone()));
                if count + list.len() > EPIC_ACHIEVEMENT_MAX_PER_SNAPSHOT
                    || json_len(&probe) > EPIC_ACHIEVEMENT_MAX_GAME_BYTES
                {
                    achievements = None;
                }
            }
            count += achievements.as_ref().map_or(0, Vec::len);
            game.achievements = Some(achievements);
            game
        })
        .collect();
    let pending_object_ids = enriched
        .iter()
        .filter(|g| matches!(g.achievements, Some(None)) && !unsupported.contains(&g.object_id()))
        .map(SnapshotGame::object_id)
        .collect();
    Ok(AchievementCollection {
        games: enriched,
        pending_object_ids,
        requires_reconnect: requires_reconnect.into_inner(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_after_values() {
        assert_eq!(retry_after(Some("2"), 0), Some(Duration::from_secs(2)));
        assert_eq!(retry_after(Some(""), 0), None);
        assert_eq!(retry_after(None, 0), None);
        let date = "Thu, 01 Jan 1970 00:00:10 GMT";
        assert_eq!(retry_after(Some(date), 4_000), Some(Duration::from_secs(6)));
        assert_eq!(retry_after(Some(date), 20_000), Some(Duration::ZERO));
    }

    #[test]
    fn achievement_targets() {
        let ids = vec!["a:1".to_string(), "b:2".to_string()];
        let parsed = parse_achievement_targets(
            &json!({"targets": [
                {"objectId": "a:1", "status": "supported", "achievementSandboxId": "sb"},
                {"objectId": "b:2", "status": "unsupported"},
            ]}),
            &ids,
        )
        .unwrap();
        assert_eq!(parsed[0].sandbox_id.as_deref(), Some("sb"));
        assert!(parse_achievement_targets(&json!({"targets": []}), &ids).is_err());
        assert!(
            parse_achievement_targets(
                &json!({"targets": [
                    {"objectId": "a:1", "status": "supported"},
                    {"objectId": "b:2", "status": "unsupported"},
                ]}),
                &ids
            )
            .is_err()
        );
    }

    fn achievements(unlocked: &[(&str, bool, &str)], total: usize) -> Value {
        json!({"data": {"PlayerAchievement": {"playerAchievementGameRecordsBySandbox": {"records": [{
            "totalUnlocked": total,
            "playerAchievements": unlocked.iter().map(|(name, done, date)| json!({"playerAchievement": {
                "epicAccountId": "acc", "sandboxId": "sb", "achievementSetId": "set",
                "achievementName": name, "unlocked": done, "unlockDate": date,
            }})).collect::<Vec<_>>(),
        }]}}}})
    }

    #[test]
    fn player_achievements() {
        let parsed = parse_player_achievements(
            &achievements(
                &[
                    ("b", true, "2024-01-01T00:00:00.000Z"),
                    ("a", true, "2024-01-02T00:00:00+02:00"),
                    ("c", false, ""),
                ],
                2,
            ),
            "acc",
            "sb",
        )
        .unwrap();
        assert_eq!(
            parsed
                .iter()
                .map(|a| a.external_id.as_str())
                .collect::<Vec<_>>(),
            ["a", "b"]
        );
        assert_eq!(parsed[0].unlock_time, "2024-01-01T22:00:00.000Z");
        assert!(
            parse_player_achievements(
                &achievements(&[("a", true, "2024-01-01T00:00:00Z")], 2),
                "acc",
                "sb"
            )
            .is_err()
        );
        assert_eq!(
            parse_player_achievements(
                &json!({"errors": [{"extensions": {"code": "errors.com.epicgames.common.authentication.token_verification_failed"}}]}),
                "acc",
                "sb"
            )
            .unwrap_err()
            .code(),
            "session-expired"
        );
        assert_eq!(
            parse_player_achievements(
                &json!({"errors": [{"extensions": {"code": "PRIVACY_RESTRICTED"}}]}),
                "acc",
                "sb"
            )
            .unwrap_err()
            .code(),
            "source-permission"
        );
    }
}
