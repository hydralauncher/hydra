//! One Steam sync run: SteamSyncOrchestrator.run and collectGameSyncPayload
//! (services/steam-integration/steam-sync-orchestrator.ts) and the game
//! publish of steam-game-exit-sync.ts.
//!
//! The run is blocking (call it on a worker thread). What needs the
//! browser profile (the store page token, the Community session) and the
//! network comes in through [`SteamAccess`]; the Hydra API through
//! [`HydraCalls`], so a dry run can print the writes instead of sending them;
//! the local library through [`RunHooks`].

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::integrations::{SteamPhase, SteamSync, is_steam_reconnect_required};
use crate::steam_sync::{
    self as steam, CommunityLogin, SourceAchievement, SourceGame, SteamError, SteamToken,
};

pub const INTEGRATION_ENDPOINT: &str = "/profile/integrations/steam";
const GAME_ENDPOINT: &str = "/profile/integrations/steam/games";
const ACHIEVEMENT_FETCH_CONCURRENCY: usize = 8;

/// The Hydra API calls a run makes.
pub trait HydraCalls: Sync {
    fn get(&self, path: &str) -> Result<Value, SteamError>;
    /// `body` Null sends no body.
    fn post(&self, path: &str, body: &Value) -> Result<Value, SteamError>;
    fn put(&self, path: &str, body: &Value) -> Result<Value, SteamError>;
    fn delete(&self, path: &str) -> Result<Value, SteamError>;
}

/// The Community session the scraping uses (SteamCommunitySession).
#[derive(Clone, Debug)]
pub struct CommunitySession {
    pub login: CommunityLogin,
    /// `name=value; …` of the non-empty steamcommunity.com cookies
    pub cookie_header: String,
    pub time_zone_offset_seconds: i64,
}

/// One cookie fetch response (createSteamCommunityCookieFetch).
#[derive(Clone, Debug)]
pub struct CommunityPage {
    pub status: u16,
    pub body: String,
    /// The final URL after redirects.
    pub url: String,
    pub retry_after_seconds: Option<u64>,
}

/// Steam, through the app's `persist:steam` browser profile.
pub trait SteamAccess: Sync {
    /// getSteamWebApiToken: the hidden store page.
    fn web_api_token(&self) -> Result<SteamToken, SteamError>;
    /// readSteamCommunitySession: the hidden Community page + cookies.
    fn community_session(&self) -> Result<CommunitySession, SteamError>;
    /// steamWebApiGet: the parsed body; errors carry Steam's status.
    fn web_api_get(&self, url: &str) -> Result<Value, SteamError>;
    /// A Community page with the session cookies (every status answers).
    fn community_get(
        &self,
        url: &str,
        session: &CommunitySession,
    ) -> Result<CommunityPage, SteamError>;
}

/// SteamSyncFinishedPayload
#[derive(Clone, Debug, PartialEq)]
pub enum Finished {
    Ok { status: Value },
    Failed { message: String },
}

/// `onProgress(processed, total)`
pub type Progress<'a> = &'a (dyn Fn(usize, usize) + Sync);

/// What the run does to the app around it.
pub struct RunHooks<'a> {
    /// setState. `only_if_running`: the achievements loop's progress, which
    /// stops once the state left "running".
    pub set_state: &'a (dyn Fn(SteamSync, bool) + Sync),
    /// emitFinished (once per run)
    pub finished: &'a (dyn Fn(Finished) + Sync),
    /// The cancel button was pressed (AbortSignal).
    pub aborted: &'a (dyn Fn() -> bool + Sync),
    /// persistSyncRunId / clearPersistedSyncRunId
    pub persist_run_id: &'a (dyn Fn(Option<&str>) + Sync),
    /// persistLocalAchievementCounts(steamAppId, schemaCount, unlockedCount)
    pub achievement_counts: &'a (dyn Fn(&str, u64, u64) + Sync),
    /// mergeWithRemoteGames(onProgress) + on-library-batch-complete
    pub merge: &'a (dyn Fn(Progress<'_>) + Sync),
    /// linkImportedSteamGameExecutables(onProgress): the count linked
    pub link_executables: &'a (dyn Fn(Progress<'_>) -> usize + Sync),
    /// steamSyncLogger
    pub log: &'a (dyn Fn(&str) + Sync),
}

struct Run<'a> {
    hydra: &'a dyn HydraCalls,
    steam: &'a dyn SteamAccess,
    hooks: &'a RunHooks<'a>,
    finished_sent: AtomicBool,
}

impl Run<'_> {
    fn log(&self, message: &str) {
        (self.hooks.log)(message);
    }

    fn check_abort(&self) -> Result<(), SteamError> {
        if (self.hooks.aborted)() {
            Err(SteamError::Aborted)
        } else {
            Ok(())
        }
    }

    /// A request made with the run's signal: a cancel during it aborts.
    fn signalled<T>(&self, result: Result<T, SteamError>) -> Result<T, SteamError> {
        self.check_abort()?;
        result
    }

    fn running(&self, sync_run_id: &str, phase: SteamPhase, found: u64, processed: u64) {
        (self.hooks.set_state)(
            SteamSync::Running {
                sync_run_id: sync_run_id.to_string(),
                phase,
                games_found: found,
                games_processed: processed,
            },
            false,
        );
    }

    fn finish(&self, payload: Finished) {
        if !self.finished_sent.swap(true, Ordering::SeqCst) {
            (self.hooks.finished)(payload);
        }
    }

    /// `withSteamSourceRetry`: 429/420 and 502 wait and retry; the wait
    /// ends early on cancel.
    fn with_retry<T>(
        &self,
        label: &str,
        mut call: impl FnMut() -> Result<T, SteamError>,
    ) -> Result<T, SteamError> {
        let mut failed_attempt = 0;
        loop {
            self.check_abort()?;
            match call() {
                Ok(value) => return Ok(value),
                Err(error) => {
                    failed_attempt += 1;
                    if !steam::should_retry(&error, failed_attempt) {
                        return Err(error);
                    }
                    let delay = steam::retry_delay_ms(&error, failed_attempt);
                    self.log(&format!(
                        "{label} retry {failed_attempt} after HTTP {}, waiting {delay}ms",
                        error
                            .http_status()
                            .map_or("null".to_string(), |s| s.to_string())
                    ));
                    let until = Instant::now() + Duration::from_millis(delay);
                    while Instant::now() < until {
                        self.check_abort()?;
                        std::thread::sleep(Duration::from_millis(50).min(until - Instant::now()));
                    }
                }
            }
        }
    }

    /// createOrResumeRun: a 409 resumes the PENDING run.
    fn create_or_resume_run(&self) -> Result<String, SteamError> {
        self.log(&format!("POST {INTEGRATION_ENDPOINT}/sync"));
        match self.signalled(
            self.hydra
                .post(&format!("{INTEGRATION_ENDPOINT}/sync"), &Value::Null),
        ) {
            Ok(response) => {
                let id = response
                    .get("syncRunId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                self.log(&format!("Created sync run {id}"));
                Ok(id)
            }
            Err(error) if steam::is_conflict(&error) => {
                self.log("POST /sync returned 409, reading latestSyncRun");
                let status = self.signalled(self.hydra.get(INTEGRATION_ENDPOINT))?;
                let connected = status.get("connected") == Some(&Value::Bool(true));
                let run = status.get("latestSyncRun");
                let run_status = run.and_then(|r| r.get("status")).and_then(Value::as_str);
                let run_id = run
                    .and_then(|r| r.get("id"))
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty());
                if connected
                    && run_status == Some("PENDING")
                    && let Some(id) = run_id
                {
                    self.log(&format!("Resuming PENDING run {id}"));
                    return Ok(id.to_string());
                }
                if connected && run_status == Some("RUNNING") {
                    self.log(&format!(
                        "Another Steam sync is RUNNING {}",
                        run_id.unwrap_or_default()
                    ));
                    return Err(SteamError::InProgress);
                }
                self.log(&format!("409 without a resumable PENDING run {status}"));
                Err(error)
            }
            Err(error) => Err(error),
        }
    }

    /// cancelPendingRun
    fn cancel_pending_run(&self, sync_run_id: &str) {
        if sync_run_id.is_empty() {
            return;
        }
        self.log(&format!("DELETE pending run {sync_run_id}"));
        match self
            .hydra
            .delete(&format!("{INTEGRATION_ENDPOINT}/sync/{sync_run_id}"))
        {
            Ok(_) => self.log(&format!("Pending run cancelled {sync_run_id}")),
            Err(error) => self.log(&format!(
                "Failed to cancel pending run {sync_run_id} {error}"
            )),
        }
    }

    /// resolveSteamSession: the store token must belong to the linked account.
    fn resolve_steam_session(&self) -> Result<SteamToken, SteamError> {
        let status = self.signalled(self.hydra.get(INTEGRATION_ENDPOINT))?;
        if status.get("connected") != Some(&Value::Bool(true)) {
            return Err(SteamError::SessionRequired);
        }
        let token = self.signalled(self.steam.web_api_token())?;
        let linked = status
            .get("steamId64")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if token.steam_id64 != linked {
            self.log(&format!(
                "Steam store session does not match linked SteamID64 {} {linked}",
                token.steam_id64
            ));
            return Err(SteamError::AccountMismatch);
        }
        Ok(token)
    }

    fn web_api(&self, url: &str) -> Result<Value, SteamError> {
        self.signalled(self.steam.web_api_get(url))
    }

    /// fetchLastPlayedPlaytimeMap
    fn last_played_map(&self, token: &SteamToken) -> Result<steam::PlaytimeMap, SteamError> {
        self.log("GET Steam ClientGetLastPlayedTimes");
        match self.with_retry("last played times", || {
            self.web_api(&steam::last_played_times_url(token))
        }) {
            Ok(payload) => Ok(steam::parse_last_played_times(&payload)),
            Err(error) if error.is_abort() => Err(error),
            Err(error) => {
                self.log(&format!("Steam last played times unavailable {error}"));
                Ok(Vec::new())
            }
        }
    }

    /// mergeFamilyLibrary
    fn merge_family_library(
        &self,
        owned: &[SourceGame],
        token: &SteamToken,
    ) -> Result<Vec<SourceGame>, SteamError> {
        let mut sources = vec![self.last_played_map(token)?];
        let mut family = Vec::new();
        let result: Result<(), SteamError> = (|| {
            self.log("GET Steam GetFamilyGroupForUser");
            let group = self.with_retry("family group", || {
                self.web_api(&steam::family_group_url(token))
            })?;
            let Some(family_group_id) = steam::parse_family_group_id(&group) else {
                self.log("Steam family group not found");
                return Ok(());
            };
            self.log("GET Steam GetSharedLibraryApps");
            let shared = self.with_retry("family library", || {
                self.web_api(&steam::shared_library_apps_url(token, &family_group_id))
            })?;
            family = steam::parse_shared_library_apps(&shared);
            sources.push(steam::playtime_from_shared_apps(&family));
            self.log("GET Steam GetPlaytimeSummary");
            match self.with_retry("family playtime", || {
                self.web_api(&steam::family_playtime_url(token, &family_group_id))
            }) {
                Ok(payload) => {
                    sources.push(steam::parse_family_playtime(&payload, &token.steam_id64))
                }
                Err(error) if error.is_abort() => return Err(error),
                Err(error) => self.log(&format!("Steam family playtime unavailable {error}")),
            }
            Ok(())
        })();
        match result {
            Err(error) if error.is_abort() => return Err(error),
            Err(error) => self.log(&format!("Steam family library unavailable {error}")),
            Ok(()) => {}
        }
        let playtime = steam::merge_playtime_maps(&sources);
        let games = steam::merge_owned_and_family_games(owned, &family, &playtime);
        self.log(&format!(
            "Family library games found {} merged total {} with playtime {}",
            family.len(),
            games.len(),
            steam::count_playtime_entries(&playtime)
        ));
        Ok(games)
    }

    /// fetchLibrary: owned + family games, demos and tests left out.
    fn fetch_library(&self, token: &SteamToken) -> Result<Vec<SourceGame>, SteamError> {
        self.log("GET Steam GetOwnedGames");
        let result: Result<Vec<SourceGame>, SteamError> = (|| {
            let response =
                self.with_retry("library", || self.web_api(&steam::owned_games_url(token)))?;
            if !(response.is_object() || response.is_array() || response.is_null()) {
                self.log("Unexpected Steam library payload");
            }
            if steam::is_private_profile_payload(&response) {
                return Err(SteamError::PrivateProfile);
            }
            let owned = steam::parse_source_library(&response);
            let merged = self.merge_family_library(&owned, token)?;
            let games: Vec<SourceGame> = merged
                .iter()
                .filter(|g| !steam::is_skipped_library_title(&g.name))
                .cloned()
                .collect();
            self.log(&format!(
                "Library games found {} skipped titles {}",
                games.len(),
                merged.len() - games.len()
            ));
            Ok(games)
        })();
        result.map_err(|error| match &error {
            SteamError::Http {
                status: 401 | 403, ..
            } => SteamError::SessionRequired,
            _ if steam::is_source_library_fatal(&error)
                || matches!(error, SteamError::PrivateProfile) =>
            {
                self.log("Steam library is private");
                SteamError::PrivateProfile
            }
            _ => error,
        })
    }

    /// fetchSteamCommunityPlayerAchievements
    fn community_achievements(
        &self,
        token: &SteamToken,
        session: &CommunitySession,
        steam_app_id: &str,
        load_schema: &dyn Fn() -> Result<Value, SteamError>,
    ) -> Result<Value, SteamError> {
        let read_page = |url: &str| -> Result<(String, String), SteamError> {
            let page = self.signalled(self.steam.community_get(url, session))?;
            if !(200..300).contains(&page.status) {
                return Err(SteamError::Http {
                    status: page.status,
                    body: Value::String(page.body),
                    retry_after_seconds: page.retry_after_seconds,
                });
            }
            if steam::is_community_login_url(&page.url) {
                return Err(SteamError::SessionRequired);
            }
            let final_url = if page.url.is_empty() {
                url.to_string()
            } else {
                page.url
            };
            Ok((page.body, final_url))
        };
        let xml_body = {
            let (body, url) = read_page(&steam::stats_xml_url(&token.steam_id64, steam_app_id))?;
            if steam::is_playerstats_xml(&body) {
                body
            } else {
                match steam::stats_xml_url_for_page(&url) {
                    Some(redirected) if redirected != url => read_page(&redirected)?.0,
                    _ => body,
                }
            }
        };
        if steam::is_playerstats_xml(&xml_body) && !steam::is_private_stats_xml(&xml_body) {
            return Ok(steam::parse_achievements_xml(&xml_body));
        }
        let now = chrono::Utc::now().timestamp_millis();
        let map_unlocks = |html: &str| -> Result<Option<Value>, SteamError> {
            let unlocks =
                steam::parse_achievement_html(html, session.time_zone_offset_seconds, now);
            if unlocks.is_empty() {
                return Ok(None);
            }
            let schema = steam::parse_achievement_schema(&load_schema()?);
            Ok(Some(steam::map_html_to_playerstats(&unlocks, &schema)))
        };
        let (profile_html, _) = read_page(&steam::stats_html_url(&token.steam_id64, steam_app_id))?;
        if let Some(found) = map_unlocks(&profile_html)? {
            return Ok(found);
        }
        let (owner_html, _) = read_page(&steam::owner_stats_html_url(steam_app_id))?;
        if let Some(found) = map_unlocks(&owner_html)? {
            return Ok(found);
        }
        Ok(json!({ "playerstats": { "achievements": [] } }))
    }

    /// fetchAchievements: eight games at a time. A game's failure skips it
    /// unless it is fatal; rate limits and a gone run skip the rest.
    fn fetch_achievements(
        &self,
        token: &SteamToken,
        session: &CommunitySession,
        games: &[SourceGame],
        track_progress: bool,
        sync_run_id: &str,
    ) -> Result<HashMap<String, Option<Vec<SourceAchievement>>>, SteamError> {
        let results: Mutex<HashMap<String, Option<Vec<SourceAchievement>>>> =
            Mutex::new(HashMap::new());
        let next = AtomicUsize::new(0);
        let processed = AtomicUsize::new(0);
        let rate_limited = AtomicBool::new(false);
        let run_gone = AtomicBool::new(false);
        let fatal: Mutex<Option<SteamError>> = Mutex::new(None);
        let total = games.len();
        let workers = ACHIEVEMENT_FETCH_CONCURRENCY.min(total);
        let one = |index: usize, game: &SourceGame| -> Result<(), SteamError> {
            let set = |value: Option<Vec<SourceAchievement>>| {
                results
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(game.steam_app_id.clone(), value);
            };
            let outcome: Result<(), SteamError> = (|| {
                self.check_abort()?;
                if rate_limited.load(Ordering::SeqCst) || run_gone.load(Ordering::SeqCst) {
                    self.log(&format!(
                        "Skipping achievements for {} {} (HTTP {})",
                        game.steam_app_id,
                        game.name,
                        if run_gone.load(Ordering::SeqCst) {
                            "409"
                        } else {
                            "429"
                        }
                    ));
                    set(None);
                    return Ok(());
                }
                let scrape = steam::should_fetch_community_achievements(game.play_time_in_seconds);
                self.log(&format!(
                    "GET Steam achievements {}/{} {} {} {}",
                    index + 1,
                    total,
                    game.steam_app_id,
                    game.name,
                    if scrape { "community" } else { "schema only" }
                ));
                let schema: Mutex<Option<Value>> = Mutex::new(None);
                let load_schema = || -> Result<Value, SteamError> {
                    let payload =
                        self.web_api(&steam::achievement_schema_url(token, &game.steam_app_id))?;
                    *schema.lock().unwrap_or_else(|e| e.into_inner()) = Some(payload.clone());
                    Ok(payload)
                };
                let response = if scrape {
                    self.with_retry(&format!("achievements {}", game.steam_app_id), || {
                        self.community_achievements(
                            token,
                            session,
                            &game.steam_app_id,
                            &load_schema,
                        )
                    })?
                } else {
                    json!({ "achievements": [] })
                };
                if schema.lock().unwrap_or_else(|e| e.into_inner()).is_none()
                    && let Err(error) = load_schema()
                {
                    self.log(&format!(
                        "Schema unavailable for {} {} {error}",
                        game.steam_app_id, game.name
                    ));
                }
                let achievements = steam::parse_source_achievements(&response);
                let catalogue = schema
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .as_ref()
                    .map(|payload| steam::catalogue_from_schema(&game.steam_app_id, payload))
                    .unwrap_or_default();
                let schema_count = if catalogue.is_empty() {
                    achievements.len()
                } else {
                    catalogue.len()
                };
                let unlocked = achievements
                    .iter()
                    .filter(|a| {
                        a.unlocked && a.unlock_time.as_deref().is_some_and(|t| !t.is_empty())
                    })
                    .count();
                self.log(&format!(
                    "Achievements for {} {}: {unlocked} unlocked / {schema_count}",
                    game.steam_app_id, game.name
                ));
                // TODO(achievements): AchievementMemoryStore.set with the catalogue
                // and UnlockedAchievementsCache.invalidate, once the store exists.
                (self.hooks.achievement_counts)(
                    &game.steam_app_id,
                    schema_count as u64,
                    unlocked as u64,
                );
                set(Some(achievements));
                Ok(())
            })();
            let result = match outcome {
                Ok(()) => Ok(()),
                Err(error) if error.is_abort() => Err(error),
                Err(SteamError::SessionRequired) => {
                    // A login page for one game; the session was checked first.
                    self.log(&format!(
                        "Skipping achievements for {} {} (login page)",
                        game.steam_app_id, game.name
                    ));
                    set(None);
                    Ok(())
                }
                Err(error) => {
                    let status = error.http_status();
                    let detail = format!(
                        "HTTP {}{}",
                        status.map_or("null".to_string(), |s| s.to_string()),
                        match &error {
                            SteamError::Http { body, .. } if !body.is_null() => format!(
                                ", {}",
                                body.as_str()
                                    .map(|s| s.chars().take(200).collect::<String>())
                                    .unwrap_or_else(|| body.to_string())
                            ),
                            SteamError::Hydra {
                                message: Some(m), ..
                            } => format!(", {m}"),
                            _ => String::new(),
                        }
                    );
                    if status == Some(401) {
                        Err(SteamError::SessionRequired)
                    } else if steam::is_achievement_skippable(&error) {
                        self.log(&format!(
                            "Skipping achievements for {} {} ({detail})",
                            game.steam_app_id, game.name
                        ));
                        set(None);
                        if steam::is_rate_limit_status(status) {
                            rate_limited.store(true, Ordering::SeqCst);
                            if track_progress {
                                (self.hooks.set_state)(SteamSync::default(), false);
                                self.finish(Finished::Failed {
                                    message: "profile/steam-rate-limited".into(),
                                });
                            }
                        }
                        if status == Some(409) {
                            run_gone.store(true, Ordering::SeqCst);
                        }
                        Ok(())
                    } else {
                        self.log(&format!(
                            "Failed achievements for {} {} ({detail})",
                            game.steam_app_id, game.name
                        ));
                        Err(error)
                    }
                }
            };
            let done = processed.fetch_add(1, Ordering::SeqCst) + 1;
            if track_progress {
                (self.hooks.set_state)(
                    SteamSync::Running {
                        sync_run_id: sync_run_id.to_string(),
                        phase: SteamPhase::Achievements,
                        games_found: total as u64,
                        games_processed: done as u64,
                    },
                    true,
                );
            }
            result
        };
        std::thread::scope(|scope| {
            for _ in 0..workers {
                scope.spawn(|| {
                    loop {
                        if fatal.lock().unwrap_or_else(|e| e.into_inner()).is_some() {
                            return;
                        }
                        if (self.hooks.aborted)() {
                            fatal
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .get_or_insert(SteamError::Aborted);
                            return;
                        }
                        let index = next.fetch_add(1, Ordering::SeqCst);
                        if index >= total {
                            return;
                        }
                        if let Err(error) = one(index, &games[index]) {
                            fatal
                                .lock()
                                .unwrap_or_else(|e| e.into_inner())
                                .get_or_insert(error);
                            return;
                        }
                    }
                });
            }
        });
        if let Some(error) = fatal.into_inner().unwrap_or_else(|e| e.into_inner()) {
            return Err(error);
        }
        if run_gone.load(Ordering::SeqCst) {
            return Err(SteamError::RunNotPending);
        }
        if rate_limited.load(Ordering::SeqCst) {
            return Err(SteamError::RateLimited);
        }
        Ok(results.into_inner().unwrap_or_else(|e| e.into_inner()))
    }

    /// publishSnapshot: staged chunks and a commit, or the legacy endpoint
    /// on APIs without chunks (404).
    fn publish_snapshot(&self, sync_run_id: &str, snapshot: &Value) -> Result<(), SteamError> {
        self.check_abort()?;
        let chunks = steam::chunk_snapshot(snapshot);
        let total = chunks.len() as u64 + 1;
        let set_publish = |uploaded: u64| {
            self.running(sync_run_id, SteamPhase::Publishing, total, uploaded);
        };
        set_publish(0);
        self.log(&format!(
            "PUT snapshot chunks {} chunks, {} games, {} unlocked achievements",
            chunks.len(),
            snapshot["games"].as_array().map_or(0, Vec::len),
            steam::snapshot_unlocked_count(snapshot)
        ));
        let staged: Result<(), SteamError> = (|| {
            for (index, chunk) in chunks.iter().enumerate() {
                self.check_abort()?;
                self.signalled(self.hydra.put(
                    &format!("{INTEGRATION_ENDPOINT}/sync/{sync_run_id}/snapshot/chunks/{index}"),
                    chunk,
                ))?;
                set_publish(index as u64 + 1);
            }
            self.check_abort()?;
            self.signalled(self.hydra.post(
                &format!("{INTEGRATION_ENDPOINT}/sync/{sync_run_id}/snapshot/commit"),
                &Value::Null,
            ))?;
            set_publish(total);
            Ok(())
        })();
        if let Err(error) = staged {
            if error.http_status() != Some(404) {
                return Err(error);
            }
            let (legacy, uploads) = steam::legacy_snapshot_fallback(snapshot);
            self.log(&format!(
                "Chunked snapshot endpoint unavailable; using legacy snapshot endpoint {{ deferredAchievementGames: {} }}",
                uploads.len()
            ));
            self.check_abort()?;
            self.signalled(self.hydra.put(
                &format!("{INTEGRATION_ENDPOINT}/sync/{sync_run_id}/snapshot"),
                &legacy,
            ))?;
            for (steam_app_id, game_chunks) in uploads {
                for chunk in game_chunks {
                    self.check_abort()?;
                    self.signalled(self.hydra.put(
                        &format!(
                            "{INTEGRATION_ENDPOINT}/games/{}",
                            crate::library_sync::encode_component(&steam_app_id)
                        ),
                        &chunk,
                    ))?;
                }
            }
        }
        self.log("Snapshot published");
        Ok(())
    }

    fn run(&self) {
        let mut sync_run_id = String::new();
        let mut published = false;
        self.log("Steam sync started");
        let result: Result<Value, SteamError> = (|| {
            sync_run_id = self.create_or_resume_run()?;
            self.check_abort()?;
            (self.hooks.persist_run_id)(Some(&sync_run_id));
            self.running(&sync_run_id, SteamPhase::Library, 0, 0);
            let token = self.resolve_steam_session()?;
            self.check_abort()?;
            let community = self.signalled(self.steam.community_session())?;
            match &community.login {
                CommunityLogin::LoggedOut => return Err(SteamError::SessionRequired),
                CommunityLogin::LoggedIn(id) if *id != token.steam_id64 => {
                    self.log(&format!(
                        "Steam Community session does not match linked SteamID64 {id} {}",
                        token.steam_id64
                    ));
                    return Err(SteamError::AccountMismatch);
                }
                _ => {}
            }
            let games = self.fetch_library(&token)?;
            self.check_abort()?;
            self.running(
                &sync_run_id,
                SteamPhase::Achievements,
                games.len() as u64,
                0,
            );
            let achievements =
                self.fetch_achievements(&token, &community, &games, true, &sync_run_id)?;
            self.check_abort()?;
            let snapshot = steam::build_snapshot(&games, &achievements);
            self.publish_snapshot(&sync_run_id, &snapshot)?;
            published = true;
            self.log("Merging remote games into local library");
            self.running(&sync_run_id, SteamPhase::Merging, 0, 0);
            let id = sync_run_id.clone();
            (self.hooks.merge)(&|processed, total| {
                if !(self.hooks.aborted)() {
                    self.running(&id, SteamPhase::Merging, total as u64, processed as u64);
                }
            });
            self.log("Remote games merged");
            self.running(&sync_run_id, SteamPhase::Executables, 0, 0);
            let linked = (self.hooks.link_executables)(&|processed, total| {
                if !(self.hooks.aborted)() {
                    self.running(&id, SteamPhase::Executables, total as u64, processed as u64);
                }
            });
            self.log(&format!(
                "Library merge finished {{ linkedExecutableCount: {linked} }}"
            ));
            self.running(&sync_run_id, SteamPhase::Finishing, 0, 0);
            let status = self.hydra.get(INTEGRATION_ENDPOINT)?;
            let account = status.get("connected") == Some(&Value::Bool(true))
                || status.get("snapshotPreserved") == Some(&Value::Bool(true));
            self.log(&format!(
                "Steam sync succeeded {{ lastSyncedAt: {}, latestSyncRun: {} }}",
                if account {
                    status.get("lastSyncedAt").cloned().unwrap_or(Value::Null)
                } else {
                    Value::Null
                },
                if account {
                    status.get("latestSyncRun").cloned().unwrap_or(Value::Null)
                } else {
                    Value::Null
                }
            ));
            Ok(status)
        })();
        match result {
            Ok(status) => {
                (self.hooks.persist_run_id)(None);
                (self.hooks.set_state)(SteamSync::default(), false);
                self.finish(Finished::Ok { status });
            }
            Err(SteamError::Aborted) => {
                self.log(&format!(
                    "Steam sync aborted {}",
                    if sync_run_id.is_empty() {
                        "(no run id)"
                    } else {
                        &sync_run_id
                    }
                ));
                if !published {
                    self.cancel_pending_run(&sync_run_id);
                }
                (self.hooks.persist_run_id)(None);
                (self.hooks.set_state)(SteamSync::default(), false);
                self.finish(Finished::Failed {
                    message: "steam-sync-aborted".into(),
                });
            }
            Err(SteamError::InProgress) => {
                self.log("Steam sync already running on the server");
                (self.hooks.set_state)(SteamSync::default(), false);
                self.finish(Finished::Failed {
                    message: SteamError::InProgress.message(),
                });
            }
            Err(error) => {
                let message = steam::sync_failure_message(&error);
                self.log(&format!("Steam sync failed {message}"));
                (self.hooks.set_state)(
                    SteamSync::Idle {
                        requires_reconnect: is_steam_reconnect_required(Some(message.as_str())),
                    },
                    false,
                );
                self.finish(Finished::Failed { message });
                if !published && error != SteamError::RunNotPending {
                    self.cancel_pending_run(&sync_run_id);
                }
                (self.hooks.persist_run_id)(None);
            }
        }
    }
}

/// `SteamSyncOrchestrator.run`: create (or resume) the run, read Steam,
/// publish the snapshot, merge the account library, finish. Every outcome
/// ends in exactly one `finished` call and an idle state.
pub fn run(hydra: &dyn HydraCalls, steam: &dyn SteamAccess, hooks: &RunHooks<'_>) {
    Run {
        hydra,
        steam,
        hooks,
        finished_sent: AtomicBool::new(false),
    }
    .run();
}

/// `collectGameSyncPayload`: one game's playtime and achievements (the game
/// page and game exit syncs).
pub fn collect_game_sync_payload(
    hydra: &dyn HydraCalls,
    steam_access: &dyn SteamAccess,
    hooks: &RunHooks<'_>,
    steam_app_id: &str,
) -> Result<Value, SteamError> {
    let run = Run {
        hydra,
        steam: steam_access,
        hooks,
        finished_sent: AtomicBool::new(true),
    };
    let token = run.resolve_steam_session()?;
    run.check_abort()?;
    let owned_payload = run.with_retry(&format!("game {steam_app_id}"), || {
        run.web_api(&steam::owned_game_url(&token, steam_app_id))
    })?;
    let owned: Vec<SourceGame> = steam::parse_source_library(&owned_payload)
        .into_iter()
        .filter(|g| g.steam_app_id == steam_app_id)
        .collect();
    let mut sources = vec![run.last_played_map(&token)?];
    let mut family = Vec::new();
    if owned.is_empty() {
        // fetchFamilyGame
        let group = run.with_retry("family group", || {
            run.web_api(&steam::family_group_url(&token))
        })?;
        if let Some(group_id) = steam::parse_family_group_id(&group) {
            let shared = run.with_retry(&format!("family game {steam_app_id}"), || {
                run.web_api(&steam::shared_library_apps_url(&token, &group_id))
            })?;
            family = steam::parse_shared_library_apps(&shared)
                .into_iter()
                .filter(|g| g.steam_app_id == steam_app_id)
                .collect();
            sources.push(steam::playtime_from_shared_apps(&family));
            match run.with_retry(&format!("family playtime {steam_app_id}"), || {
                run.web_api(&steam::family_playtime_url(&token, &group_id))
            }) {
                Ok(payload) => {
                    sources.push(steam::parse_family_playtime(&payload, &token.steam_id64))
                }
                Err(error) if error.is_abort() => return Err(error),
                Err(error) => run.log(&format!("Steam family playtime unavailable {error}")),
            }
        }
    }
    let playtime = steam::merge_playtime_maps(&sources);
    let game = steam::merge_owned_and_family_games(&owned, &family, &playtime)
        .into_iter()
        .find(|g| g.steam_app_id == steam_app_id)
        .ok_or_else(|| SteamError::Other(format!("steam-game-not-found:{steam_app_id}")))?;
    let mut achievements: Option<Value> = None;
    let attempt: Result<(), SteamError> = (|| {
        let session = run.signalled(steam_access.community_session())?;
        match &session.login {
            CommunityLogin::LoggedIn(id) if *id != token.steam_id64 => {
                run.log(&format!(
                    "Skipping Steam achievements for {steam_app_id}: Community session belongs to another account"
                ));
            }
            CommunityLogin::LoggedOut => {}
            _ => {
                let by_app = run.fetch_achievements(
                    &token,
                    &session,
                    std::slice::from_ref(&game),
                    false,
                    "",
                )?;
                let snapshot = steam::build_snapshot(std::slice::from_ref(&game), &by_app);
                achievements = snapshot["games"][0].get("achievements").cloned();
            }
        }
        Ok(())
    })();
    match attempt {
        Err(error) if error.is_abort() => return Err(error),
        Err(error) => run.log(&format!(
            "Steam achievements unavailable for {steam_app_id} {error}"
        )),
        Ok(()) => {}
    }
    let mut payload = json!({
        "playTimeInSeconds": game.play_time_in_seconds,
        "lastPlayedAt": game.last_played_at,
    });
    if let Some(achievements) = achievements {
        payload["achievements"] = achievements;
    }
    Ok(payload)
}

/// steam-game-exit-sync.ts `publishGame`: the chunks, then the account's
/// row for that game (merged by the caller with mergeImportedProfileGame).
pub fn publish_game(
    hydra: &dyn HydraCalls,
    steam_app_id: &str,
    payload: &Value,
) -> Result<Option<Value>, SteamError> {
    let encoded = crate::library_sync::encode_component(steam_app_id);
    for chunk in steam::chunk_game_sync_payload(payload) {
        hydra.put(&format!("{GAME_ENDPOINT}/{encoded}"), &chunk)?;
    }
    let remote = hydra.get(&format!("/profile/games/steam/{encoded}"))?;
    let matches = remote.get("shop").and_then(Value::as_str) == Some("steam")
        && remote.get("objectId").and_then(Value::as_str) == Some(steam_app_id);
    Ok(matches.then_some(remote))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Records every Hydra call; answers like the API would for a connected
    /// account, with an optional failure per path prefix.
    struct FakeHydra {
        calls: Mutex<Vec<(String, String, Value)>>,
        steam_id64: String,
        fail_post_sync: Option<u16>,
    }

    impl FakeHydra {
        fn new() -> Self {
            FakeHydra {
                calls: Mutex::new(Vec::new()),
                steam_id64: "76561198000000001".into(),
                fail_post_sync: None,
            }
        }
        fn record(&self, method: &str, path: &str, body: &Value) {
            self.calls
                .lock()
                .unwrap()
                .push((method.into(), path.into(), body.clone()));
        }
        fn calls(&self) -> Vec<(String, String)> {
            self.calls
                .lock()
                .unwrap()
                .iter()
                .map(|(m, p, _)| (m.clone(), p.clone()))
                .collect()
        }
    }

    impl HydraCalls for FakeHydra {
        fn get(&self, path: &str) -> Result<Value, SteamError> {
            self.record("GET", path, &Value::Null);
            Ok(json!({
                "connected": true,
                "steamId64": self.steam_id64,
                "lastSyncedAt": "2026-01-01T00:00:00.000Z",
                "latestSyncRun": { "id": "run-1", "status": "PENDING" },
            }))
        }
        fn post(&self, path: &str, body: &Value) -> Result<Value, SteamError> {
            self.record("POST", path, body);
            if path.ends_with("/sync")
                && let Some(status) = self.fail_post_sync
            {
                return Err(SteamError::Hydra {
                    status: Some(status),
                    message: None,
                });
            }
            Ok(json!({ "syncRunId": "run-1" }))
        }
        fn put(&self, path: &str, body: &Value) -> Result<Value, SteamError> {
            self.record("PUT", path, body);
            Ok(Value::Null)
        }
        fn delete(&self, path: &str) -> Result<Value, SteamError> {
            self.record("DELETE", path, &Value::Null);
            Ok(Value::Null)
        }
    }

    struct FakeSteam {
        token: Result<SteamToken, SteamError>,
        login: CommunityLogin,
    }

    impl SteamAccess for FakeSteam {
        fn web_api_token(&self) -> Result<SteamToken, SteamError> {
            self.token.clone()
        }
        fn community_session(&self) -> Result<CommunitySession, SteamError> {
            Ok(CommunitySession {
                login: self.login.clone(),
                cookie_header: "steamLoginSecure=x".into(),
                time_zone_offset_seconds: 0,
            })
        }
        fn web_api_get(&self, url: &str) -> Result<Value, SteamError> {
            if url.contains("GetOwnedGames") {
                return Ok(json!({ "response": { "games": [
                    { "appid": 620, "name": "Portal 2", "playtime_forever": 60 },
                    { "appid": 440, "name": "Team Fortress 2", "playtime_forever": 0 },
                    { "appid": 999, "name": "Some Demo", "playtime_forever": 5 },
                ]}}));
            }
            if url.contains("GetGameAchievements") {
                return Ok(json!({ "response": { "achievements": [
                    { "internal_name": "A", "localized_name": "Alpha", "icon": "a" },
                    { "internal_name": "B", "localized_name": "Beta", "icon": "b" },
                ]}}));
            }
            if url.contains("GetFamilyGroupForUser") {
                return Ok(json!({ "response": { "is_not_member_of_any_group": true } }));
            }
            Ok(json!({ "response": {} }))
        }
        fn community_get(
            &self,
            url: &str,
            _session: &CommunitySession,
        ) -> Result<CommunityPage, SteamError> {
            Ok(CommunityPage {
                status: 200,
                body: r#"<playerstats><achievements><achievement closed="1"><apiname>A</apiname><unlockTimestamp>1700000000</unlockTimestamp></achievement><achievement closed="0"><apiname>B</apiname></achievement></achievements></playerstats>"#.into(),
                url: url.into(),
                retry_after_seconds: None,
            })
        }
    }

    fn token() -> SteamToken {
        SteamToken {
            steam_id64: "76561198000000001".into(),
            access_token: "t".into(),
        }
    }

    struct Recorded {
        states: Mutex<Vec<SteamSync>>,
        finished: Mutex<Vec<Finished>>,
        run_ids: Mutex<Vec<Option<String>>>,
        counts: Mutex<Vec<(String, u64, u64)>>,
        merged: AtomicBool,
    }

    fn run_with(hydra: &FakeHydra, steam_access: &FakeSteam, abort: &AtomicBool) -> Recorded {
        let recorded = Recorded {
            states: Mutex::new(Vec::new()),
            finished: Mutex::new(Vec::new()),
            run_ids: Mutex::new(Vec::new()),
            counts: Mutex::new(Vec::new()),
            merged: AtomicBool::new(false),
        };
        let set_state = |state: SteamSync, _only: bool| recorded.states.lock().unwrap().push(state);
        let finished = |payload: Finished| recorded.finished.lock().unwrap().push(payload);
        let aborted = || abort.load(Ordering::SeqCst);
        let persist = |id: Option<&str>| {
            recorded
                .run_ids
                .lock()
                .unwrap()
                .push(id.map(str::to_string))
        };
        let counts = |app: &str, schema: u64, unlocked: u64| {
            recorded
                .counts
                .lock()
                .unwrap()
                .push((app.to_string(), schema, unlocked))
        };
        let merge = |progress: &(dyn Fn(usize, usize) + Sync)| {
            progress(0, 2);
            progress(2, 2);
            recorded.merged.store(true, Ordering::SeqCst);
        };
        let link = |progress: &(dyn Fn(usize, usize) + Sync)| {
            progress(0, 0);
            0
        };
        let log = |_: &str| {};
        {
            let hooks = RunHooks {
                set_state: &set_state,
                finished: &finished,
                aborted: &aborted,
                persist_run_id: &persist,
                achievement_counts: &counts,
                merge: &merge,
                link_executables: &link,
                log: &log,
            };
            run(hydra, steam_access, &hooks);
        }
        recorded
    }

    #[test]
    fn a_full_run_publishes_and_merges() {
        let hydra = FakeHydra::new();
        let steam_access = FakeSteam {
            token: Ok(token()),
            login: CommunityLogin::LoggedIn("76561198000000001".into()),
        };
        let abort = AtomicBool::new(false);
        let recorded = run_with(&hydra, &steam_access, &abort);
        let calls = hydra.calls();
        assert_eq!(
            calls[0],
            ("POST".into(), "/profile/integrations/steam/sync".into())
        );
        assert_eq!(
            calls[1],
            ("GET".into(), "/profile/integrations/steam".into())
        );
        assert!(calls.contains(&(
            "PUT".into(),
            "/profile/integrations/steam/sync/run-1/snapshot/chunks/0".into()
        )));
        assert!(calls.contains(&(
            "POST".into(),
            "/profile/integrations/steam/sync/run-1/snapshot/commit".into()
        )));
        assert!(!calls.iter().any(|(m, _)| m == "DELETE"));
        // The snapshot: Portal 2 with its unlock, TF2 read schema-only, no demo.
        let body = hydra
            .calls
            .lock()
            .unwrap()
            .iter()
            .find(|(_, p, _)| p.ends_with("/chunks/0"))
            .map(|(_, _, b)| b.clone())
            .unwrap();
        assert_eq!(body["totalChunks"], 1);
        let games = body["games"].as_array().unwrap();
        assert_eq!(games.len(), 2);
        assert_eq!(games[0]["steamAppId"], "620");
        assert_eq!(games[0]["playTimeInSeconds"], 3600);
        assert_eq!(
            games[0]["achievements"],
            json!([{ "name": "A", "unlockTime": "2023-11-14T22:13:20.000Z" }])
        );
        assert_eq!(games[1]["achievements"], json!([]));
        assert!(recorded.merged.load(Ordering::SeqCst));
        assert_eq!(
            recorded.run_ids.lock().unwrap().clone(),
            vec![Some("run-1".to_string()), None]
        );
        let mut counts = recorded.counts.lock().unwrap().clone();
        counts.sort();
        assert_eq!(counts, vec![("440".into(), 2, 0), ("620".into(), 2, 1)]);
        assert!(matches!(
            recorded.finished.lock().unwrap().as_slice(),
            [Finished::Ok { .. }]
        ));
        assert_eq!(
            recorded.states.lock().unwrap().last(),
            Some(&SteamSync::default())
        );
    }

    #[test]
    fn no_store_session_cancels_the_pending_run() {
        let hydra = FakeHydra::new();
        let steam_access = FakeSteam {
            token: Err(SteamError::SessionRequired),
            login: CommunityLogin::LoggedOut,
        };
        let abort = AtomicBool::new(false);
        let recorded = run_with(&hydra, &steam_access, &abort);
        assert_eq!(
            hydra.calls(),
            vec![
                ("POST".into(), "/profile/integrations/steam/sync".into()),
                ("GET".into(), "/profile/integrations/steam".into()),
                (
                    "DELETE".into(),
                    "/profile/integrations/steam/sync/run-1".into()
                ),
            ]
        );
        assert_eq!(
            recorded.finished.lock().unwrap().as_slice(),
            [Finished::Failed {
                message: "steam-session-required".into()
            }]
        );
        assert_eq!(
            recorded.states.lock().unwrap().last(),
            Some(&SteamSync::Idle {
                requires_reconnect: true
            })
        );
    }

    #[test]
    fn a_conflict_resumes_the_pending_run() {
        let mut hydra = FakeHydra::new();
        hydra.fail_post_sync = Some(409);
        let steam_access = FakeSteam {
            token: Ok(SteamToken {
                steam_id64: "76561198000000002".into(),
                access_token: "t".into(),
            }),
            login: CommunityLogin::Unverified,
        };
        let abort = AtomicBool::new(false);
        let recorded = run_with(&hydra, &steam_access, &abort);
        // resumed run-1, then the token belongs to another account
        assert_eq!(
            recorded.finished.lock().unwrap().as_slice(),
            [Finished::Failed {
                message: "steam-account-mismatch".into()
            }]
        );
        assert!(hydra.calls().contains(&(
            "DELETE".into(),
            "/profile/integrations/steam/sync/run-1".into()
        )));
    }

    #[test]
    fn cancel_before_publishing_deletes_the_run() {
        let hydra = FakeHydra::new();
        let steam_access = FakeSteam {
            token: Ok(token()),
            login: CommunityLogin::LoggedIn("76561198000000001".into()),
        };
        let abort = AtomicBool::new(true);
        let recorded = run_with(&hydra, &steam_access, &abort);
        assert_eq!(
            recorded.finished.lock().unwrap().as_slice(),
            [Finished::Failed {
                message: "steam-sync-aborted".into()
            }]
        );
        assert!(!hydra.calls().iter().any(|(_, p)| p.contains("snapshot")));
    }

    #[test]
    fn game_payload_for_one_game() {
        let hydra = FakeHydra::new();
        let steam_access = FakeSteam {
            token: Ok(token()),
            login: CommunityLogin::LoggedIn("76561198000000001".into()),
        };
        let abort = AtomicBool::new(false);
        let set_state = |_: SteamSync, _: bool| {};
        let finished = |_: Finished| panic!("no finish for a game sync");
        let aborted = || abort.load(Ordering::SeqCst);
        let persist = |_: Option<&str>| {};
        let counts = |_: &str, _: u64, _: u64| {};
        let merge = |_: &(dyn Fn(usize, usize) + Sync)| {};
        let link = |_: &(dyn Fn(usize, usize) + Sync)| 0;
        let log = |_: &str| {};
        let hooks = RunHooks {
            set_state: &set_state,
            finished: &finished,
            aborted: &aborted,
            persist_run_id: &persist,
            achievement_counts: &counts,
            merge: &merge,
            link_executables: &link,
            log: &log,
        };
        let payload = collect_game_sync_payload(&hydra, &steam_access, &hooks, "620").unwrap();
        assert_eq!(payload["playTimeInSeconds"], 3600);
        assert_eq!(payload["achievements"][0]["name"], "A");
    }
}
