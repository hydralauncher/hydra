//! sync-orchestrator.ts (EpicSyncOrchestrator.execute): one library sync.
//!
//! Create or resume a run (POST /profile/integrations/epic/sync, journal in
//! LevelDB), collect the snapshot (Legendary's library, Epic playtime, and
//! achievements when the link supports snapshot version 1), upload it in
//! chunks, commit, then merge the remote library into the local one. The
//! journal lets an interrupted run resume instead of starting over.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::cancel::Cancel;
use crate::error::{EpicError, Result};
use crate::library::{SnapshotGame, apply_playtime};
use crate::protocol::SyncRun;
use crate::session::Context;
use crate::snapshot::{Chunk, build_chunks};
use crate::time::{now_ms, parse_ms};

pub const EPIC_SYNC_TIMEOUT: Duration = Duration::from_secs(5 * 60);
pub const EPIC_RECONCILE_INTERVAL: Duration = Duration::from_secs(2);
pub const EPIC_HYDRA_TIMEOUT: Duration = Duration::from_secs(20);
pub const EPIC_PENDING_EXPIRATION_MS: i64 = 60 * 60_000;
pub const EPIC_RUNNING_EXPIRATION_MS: i64 = 15 * 60_000;
pub const EPIC_ACHIEVEMENT_BUDGET: Duration = Duration::from_secs(90);
pub const EPIC_ACHIEVEMENT_PUBLICATION_RESERVE: Duration = Duration::from_secs(60);

/// EpicSyncJournal
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Journal {
    pub sync_run_id: String,
    pub total_chunks: Option<usize>,
    pub merge_pending: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requires_reconnect: Option<bool>,
}

/// `epicSyncRun:<sha256(JSON [environment, userId, connectionId])>`
pub fn journal_key(context: &Context) -> String {
    let canonical = json!([
        context.auth.environment,
        context.auth.user_id,
        context.connection.connection_id
    ])
    .to_string();
    format!("epicSyncRun:{:x}", Sha256::digest(canonical.as_bytes()))
}

/// EpicSyncPhase
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Starting,
    Library,
    Playtime,
    Achievements,
    Publishing,
    Merging,
    Finishing,
}

impl Phase {
    pub fn as_str(self) -> &'static str {
        match self {
            Phase::Starting => "starting",
            Phase::Library => "library",
            Phase::Playtime => "playtime",
            Phase::Achievements => "achievements",
            Phase::Publishing => "publishing",
            Phase::Merging => "merging",
            Phase::Finishing => "finishing",
        }
    }
}

/// EpicSyncState as the Epic card shows it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SyncState {
    /// "idle" | "running" | "cancelling"
    pub status: &'static str,
    pub hydra_user_id: Option<String>,
    pub connection_id: Option<String>,
    pub sync_run_id: Option<String>,
    pub phase: Option<Phase>,
    pub processed: usize,
    pub total: Option<usize>,
    pub requires_reconnect: bool,
    pub error: Option<String>,
    pub achievement_summary: Option<Value>,
}

impl SyncState {
    pub fn idle(hydra_user_id: Option<String>) -> Self {
        SyncState {
            status: "idle",
            hydra_user_id,
            ..Default::default()
        }
    }

    pub fn is_idle(&self) -> bool {
        self.status.is_empty() || self.status == "idle"
    }
}

/// EpicSyncFinished
#[derive(Clone, Debug, PartialEq)]
pub struct Finished {
    pub hydra_user_id: String,
    pub connection_id: String,
    /// "first-link" | "startup" | "manual"
    pub origin: &'static str,
    pub ok: bool,
    pub error: Option<String>,
    /// "not-published" | "published" | "unknown"
    pub publication: &'static str,
    pub requires_merge: bool,
    pub achievement_summary: Option<Value>,
}

/// What a run needs from the outside (EpicSyncDependencies).
pub trait Dependencies {
    fn current(&self) -> bool;
    fn library(&self, cancel: &Cancel) -> Result<Vec<SnapshotGame>>;
    fn playtime(&self, cancel: &Cancel, fresh: bool) -> Result<HashMap<String, i64>>;
    /// The games with achievements, and whether Epic asked for a reconnect.
    fn achievements(
        &self,
        games: Vec<SnapshotGame>,
        cancel: &Cancel,
        progress: &(dyn Fn(usize, usize) + Sync),
        budget: Duration,
    ) -> Result<(Vec<SnapshotGame>, bool)>;
    fn start(&self, trigger: &str, cancel: &Cancel) -> Result<String>;
    fn run(&self, id: &str, cancel: &Cancel) -> Result<SyncRun>;
    fn upload(&self, id: &str, index: usize, chunk: &Chunk, cancel: &Cancel) -> Result<()>;
    fn commit(&self, id: &str, cancel: &Cancel) -> Result<()>;
    fn cancel_run(&self, id: &str, cancel: &Cancel) -> Result<()>;
    fn journal(&self) -> Option<Journal>;
    fn save_journal(&self, journal: Option<&Journal>) -> Result<()>;
    fn merge(&self, progress: &dyn Fn(usize, usize), cancel: &Cancel) -> Result<bool>;
    fn emit(&self, state: SyncState);
}

struct Run<'a, D: Dependencies + Sync> {
    deps: &'a D,
    context: &'a Context,
    cancel: &'a Cancel,
    trigger: &'a str,
    id: Option<String>,
}

impl<D: Dependencies + Sync> Run<'_, D> {
    fn assert(&self) -> Result<()> {
        if self.deps.current() {
            Ok(())
        } else {
            Err(EpicError::cancelled())
        }
    }

    /// publish(operation, phase, processed, total)
    fn publish(&self, phase: Phase, processed: usize, total: Option<usize>) -> Result<()> {
        self.assert()?;
        self.deps.emit(SyncState {
            status: if self.cancel.is_cancelled() {
                "cancelling"
            } else {
                "running"
            },
            hydra_user_id: Some(self.context.auth.user_id.clone()),
            connection_id: Some(self.context.connection.connection_id.clone()),
            sync_run_id: self.id.clone(),
            phase: Some(phase),
            processed,
            total,
            ..Default::default()
        });
        Ok(())
    }

    /// terminal(): wait while the server reconciles a RUNNING run.
    fn terminal(&self, cancel: &Cancel) -> Result<SyncRun> {
        loop {
            self.assert()?;
            let run = self
                .deps
                .run(self.id.as_deref().unwrap_or_default(), cancel)?;
            if run.status != "RUNNING" {
                return Ok(run);
            }
            cancel.sleep(EPIC_RECONCILE_INTERVAL)?;
        }
    }
}

fn expired(run: &SyncRun) -> bool {
    let now = now_ms();
    (run.status == "PENDING"
        && parse_ms(&run.created_at).is_some_and(|at| now - at >= EPIC_PENDING_EXPIRATION_MS))
        || (run.status == "RUNNING"
            && run
                .started_at
                .as_deref()
                .and_then(parse_ms)
                .is_some_and(|at| now - at >= EPIC_RUNNING_EXPIRATION_MS))
}

/// execute(operation): one sync from start (or resume) to the merge.
pub fn execute<D: Dependencies + Sync>(
    deps: &D,
    context: &Context,
    trigger: &str,
    parent: &Cancel,
) -> Finished {
    let started = Instant::now();
    let cancel = parent.with_timeout(EPIC_SYNC_TIMEOUT);
    let mut run = Run {
        deps,
        context,
        cancel: &cancel,
        trigger,
        id: None,
    };
    let capabilities = context.connection.achievements_snapshot_version;
    let mut publication: &'static str = "not-published";
    let mut requires_merge = false;
    let mut requires_reconnect = false;
    let mut achievement_summary: Option<Value> = None;
    let mut achievements_requested = capabilities;
    let mut journal: Option<Journal> = None;

    let mut body = || -> Result<()> {
        let start_run = |run: &mut Run<D>, requested: &mut bool| -> Result<String> {
            let id = run.deps.start(run.trigger, run.cancel)?;
            *requested = capabilities;
            Ok(id)
        };
        journal = deps.journal();
        let mut resuming = journal.is_some();
        if let Some(saved) = journal.clone() {
            run.id = Some(saved.sync_run_id.clone());
            publication = "unknown";
            let mut server = deps.run(&saved.sync_run_id, &cancel)?;
            if !server.achievement_snapshot_version {
                achievements_requested = false;
            }
            requires_reconnect = saved.requires_reconnect.unwrap_or(false);
            if expired(&server) {
                // The server decides expiry under its lock; never claim RUNNING locally.
                let id = start_run(&mut run, &mut achievements_requested)?;
                run.id = Some(id.clone());
                journal = Some(Journal {
                    sync_run_id: id.clone(),
                    total_chunks: None,
                    merge_pending: false,
                    requires_reconnect: None,
                });
                deps.save_journal(journal.as_ref())?;
                resuming = false;
                server = deps.run(&id, &cancel)?;
            } else if server.status == "RUNNING" {
                server = run.terminal(&cancel)?;
            }
            if server.status != "SUCCEEDED" {
                publication = "not-published";
            }
            if server.status == "SUCCEEDED" {
                publication = "published";
            } else if server.status == "FAILED" {
                deps.save_journal(None)?;
                journal = None;
                run.id = None;
                resuming = false;
            } else if server.status == "PENDING"
                && !server.achievement_snapshot_version
                && capabilities
            {
                // Replace legacy staging before collecting a versioned snapshot.
                deps.cancel_run(run.id.as_deref().unwrap_or_default(), &cancel)?;
                deps.save_journal(None)?;
                journal = None;
                run.id = None;
                resuming = false;
            }
        }
        if publication != "published" {
            // Only ids returned to this launcher (or its journal) are writable.
            if run.id.is_none() {
                let id = start_run(&mut run, &mut achievements_requested)?;
                run.id = Some(id.clone());
                run.assert()?;
                journal = Some(Journal {
                    sync_run_id: id,
                    total_chunks: None,
                    merge_pending: false,
                    requires_reconnect: None,
                });
                deps.save_journal(journal.as_ref())?;
            }
            requires_reconnect = false;
            run.publish(Phase::Library, 0, None)?;
            let games = deps.library(&cancel)?;
            run.publish(Phase::Playtime, 0, Some(games.len()))?;
            let times = deps.playtime(&cancel, true)?;
            let mut snapshot = apply_playtime(games, &times);
            if !context.connection.dlc_snapshot_version {
                for game in &mut snapshot {
                    game.dlcs = None;
                }
            }
            run.assert()?;
            if achievements_requested {
                run.publish(Phase::Achievements, 0, Some(snapshot.len()))?;
                let elapsed = started.elapsed();
                let budget = EPIC_ACHIEVEMENT_BUDGET.min(
                    EPIC_SYNC_TIMEOUT
                        .saturating_sub(elapsed)
                        .saturating_sub(EPIC_ACHIEVEMENT_PUBLICATION_RESERVE)
                        .max(Duration::from_millis(1)),
                );
                let progress = |processed: usize, total: usize| {
                    let _ = run.publish(Phase::Achievements, processed, Some(total));
                };
                let (games, reconnect) = deps.achievements(snapshot, &cancel, &progress, budget)?;
                run.assert()?;
                snapshot = games;
                requires_reconnect = reconnect;
            }
            let chunks = build_chunks(&context.connection.connection_id, &snapshot)?;
            if resuming
                && journal
                    .as_ref()
                    .is_none_or(|j| j.total_chunks != Some(chunks.len()))
            {
                deps.cancel_run(run.id.as_deref().unwrap_or_default(), &cancel)?;
                let id = start_run(&mut run, &mut achievements_requested)?;
                run.id = Some(id);
            }
            let id = run.id.clone().unwrap_or_default();
            journal = Some(Journal {
                sync_run_id: id.clone(),
                total_chunks: Some(chunks.len()),
                merge_pending: false,
                requires_reconnect: Some(requires_reconnect),
            });
            deps.save_journal(journal.as_ref())?;
            for (index, chunk) in chunks.iter().enumerate() {
                run.publish(Phase::Publishing, index, Some(chunks.len()))?;
                deps.upload(&id, index, chunk, &cancel)?;
            }
            run.publish(Phase::Publishing, chunks.len(), Some(chunks.len()))?;
            publication = "unknown";
            if let Err(commit_error) = deps.commit(&id, &cancel) {
                run.assert()?;
                let check = Cancel::new().with_timeout(EPIC_HYDRA_TIMEOUT);
                let server = run.terminal(&check)?;
                if server.status == "SUCCEEDED" {
                    publication = "published";
                } else {
                    publication = "not-published";
                    return Err(commit_error);
                }
            } else {
                publication = "published";
            }
        }
        if achievements_requested {
            let check = Cancel::new().with_timeout(EPIC_HYDRA_TIMEOUT);
            let server = deps.run(run.id.as_deref().unwrap_or_default(), &check)?;
            run.assert()?;
            achievement_summary = server.achievement_summary;
        }
        run.assert()?;
        requires_merge = true;
        deps.save_journal(Some(&Journal {
            sync_run_id: run.id.clone().unwrap_or_default(),
            total_chunks: journal.as_ref().and_then(|j| j.total_chunks),
            merge_pending: true,
            requires_reconnect: Some(requires_reconnect),
        }))?;
        run.publish(Phase::Merging, 0, None)?;
        let progress = |processed: usize, total: usize| {
            let _ = run.publish(Phase::Merging, processed, Some(total));
        };
        if !deps.merge(&progress, &cancel)? {
            return Err(EpicError::new("merge-failed"));
        }
        run.assert()?;
        requires_merge = false;
        deps.save_journal(None)?;
        run.publish(Phase::Finishing, 0, None)?;
        Ok(())
    };
    let outcome = body();
    let mut error = outcome.err().map(|e| e.0);
    if cancel.is_cancelled() && error.is_some() && publication != "published" {
        error = Some("operation-cancelled".into());
    }
    // Cancelling discards only staging; a confirmed commit still needs the merge.
    if cancel.is_cancelled()
        && publication == "not-published"
        && let Some(id) = run.id.as_deref()
        && deps.current()
    {
        let check = Cancel::new().with_timeout(EPIC_HYDRA_TIMEOUT);
        if deps.cancel_run(id, &check).is_ok() {
            let _ = deps.save_journal(None);
        }
    }
    let requires_reconnect = requires_reconnect || error.as_deref() == Some("session-expired");
    if deps.current() {
        deps.emit(SyncState {
            status: "idle",
            hydra_user_id: Some(context.auth.user_id.clone()),
            connection_id: Some(context.connection.connection_id.clone()),
            requires_reconnect,
            achievement_summary: achievement_summary.clone(),
            error: error.clone(),
            ..Default::default()
        });
    }
    Finished {
        hydra_user_id: context.auth.user_id.clone(),
        connection_id: context.connection.connection_id.clone(),
        origin: match trigger {
            "FIRST_LINK" => "first-link",
            "STARTUP" => "startup",
            _ => "manual",
        },
        ok: error.is_none(),
        error,
        publication,
        requires_merge,
        achievement_summary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::validate_connection;
    use crate::session::AuthContext;
    use std::cell::RefCell;
    use std::sync::Mutex;

    struct Fake {
        log: Mutex<Vec<String>>,
        journal: RefCell<Option<Journal>>,
        runs: RefCell<HashMap<String, SyncRun>>,
        next: RefCell<u32>,
        fail_library: Option<&'static str>,
        fail_commit: bool,
    }

    // SAFETY: tests run single-threaded through the fake.
    unsafe impl Sync for Fake {}

    fn run_of(id: &str, status: &str, versioned: bool) -> SyncRun {
        SyncRun {
            id: id.into(),
            trigger: "MANUAL".into(),
            status: status.into(),
            games_count: 0,
            error: None,
            started_at: None,
            completed_at: None,
            created_at: crate::time::iso(now_ms()),
            achievement_snapshot_version: versioned,
            achievement_summary: None,
        }
    }

    impl Fake {
        fn new() -> Self {
            Fake {
                log: Mutex::new(vec![]),
                journal: RefCell::new(None),
                runs: RefCell::new(HashMap::new()),
                next: RefCell::new(0),
                fail_library: None,
                fail_commit: false,
            }
        }
        fn note(&self, what: String) {
            self.log.lock().unwrap().push(what);
        }
        fn log(&self) -> Vec<String> {
            self.log.lock().unwrap().clone()
        }
    }

    impl Dependencies for Fake {
        fn current(&self) -> bool {
            true
        }
        fn library(&self, _: &Cancel) -> Result<Vec<SnapshotGame>> {
            self.note("library".into());
            if let Some(code) = self.fail_library {
                return Err(EpicError::new(code));
            }
            Ok(vec![SnapshotGame {
                namespace: "ns".into(),
                catalog_item_id: "id".into(),
                artifact_ids: vec!["A".into()],
                name: "Game".into(),
                play_time_in_seconds: 0,
                achievements: None,
                dlcs: Some(vec![]),
            }])
        }
        fn playtime(&self, _: &Cancel, _: bool) -> Result<HashMap<String, i64>> {
            Ok(HashMap::from([("A".to_string(), 60)]))
        }
        fn achievements(
            &self,
            games: Vec<SnapshotGame>,
            _: &Cancel,
            _: &(dyn Fn(usize, usize) + Sync),
            _: Duration,
        ) -> Result<(Vec<SnapshotGame>, bool)> {
            self.note("achievements".into());
            Ok((games, false))
        }
        fn start(&self, trigger: &str, _: &Cancel) -> Result<String> {
            *self.next.borrow_mut() += 1;
            let id = format!("run0000000{}", self.next.borrow());
            self.note(format!("start {trigger} {id}"));
            self.runs
                .borrow_mut()
                .insert(id.clone(), run_of(&id, "PENDING", true));
            Ok(id)
        }
        fn run(&self, id: &str, _: &Cancel) -> Result<SyncRun> {
            Ok(self.runs.borrow()[id].clone())
        }
        fn upload(&self, id: &str, index: usize, chunk: &Chunk, _: &Cancel) -> Result<()> {
            self.note(format!(
                "upload {id} {index}/{} play={}",
                chunk.total_chunks, chunk.games[0].play_time_in_seconds
            ));
            assert!(chunk.games[0].dlcs.is_none(), "no dlc capability");
            Ok(())
        }
        fn commit(&self, id: &str, _: &Cancel) -> Result<()> {
            self.note(format!("commit {id}"));
            if self.fail_commit {
                return Err(EpicError::new("network"));
            }
            self.runs.borrow_mut().get_mut(id).unwrap().status = "SUCCEEDED".into();
            Ok(())
        }
        fn cancel_run(&self, id: &str, _: &Cancel) -> Result<()> {
            self.note(format!("cancel {id}"));
            Ok(())
        }
        fn journal(&self) -> Option<Journal> {
            self.journal.borrow().clone()
        }
        fn save_journal(&self, journal: Option<&Journal>) -> Result<()> {
            *self.journal.borrow_mut() = journal.cloned();
            Ok(())
        }
        fn merge(&self, _: &dyn Fn(usize, usize), _: &Cancel) -> Result<bool> {
            self.note("merge".into());
            Ok(true)
        }
        fn emit(&self, _: SyncState) {}
    }

    fn context(achievements: bool) -> Context {
        let mut connection = validate_connection(&json!({
            "connected": true,
            "connectionId": "conn12345678",
            "epicAccountId": "0123456789abcdef0123456789abcdef",
            "displayName": "Player",
            "connectedAt": "2026-01-01T00:00:00.000Z",
        }))
        .unwrap()
        .unwrap();
        connection.achievements_snapshot_version = achievements;
        Context {
            auth: AuthContext {
                environment: "https://api".into(),
                user_id: "u".into(),
                generation: 1,
            },
            connection,
        }
    }

    #[test]
    fn a_full_run() {
        let fake = Fake::new();
        let done = execute(&fake, &context(true), "MANUAL", &Cancel::new());
        assert!(done.ok, "{done:?}");
        assert_eq!(done.publication, "published");
        assert_eq!(done.origin, "manual");
        assert_eq!(
            fake.log(),
            [
                "start MANUAL run00000001",
                "library",
                "achievements",
                "upload run00000001 0/1 play=60",
                "commit run00000001",
                "merge"
            ]
        );
        assert!(fake.journal().is_none());
    }

    #[test]
    fn resumes_a_published_run_with_only_the_merge() {
        let fake = Fake::new();
        fake.runs.borrow_mut().insert(
            "run00000009".into(),
            run_of("run00000009", "SUCCEEDED", false),
        );
        *fake.journal.borrow_mut() = Some(Journal {
            sync_run_id: "run00000009".into(),
            total_chunks: Some(1),
            merge_pending: true,
            requires_reconnect: None,
        });
        let done = execute(&fake, &context(false), "STARTUP", &Cancel::new());
        assert!(done.ok);
        assert_eq!(fake.log(), ["merge"]);
    }

    #[test]
    fn a_failed_library_keeps_the_journal() {
        let mut fake = Fake::new();
        fake.fail_library = Some("session-expired");
        let done = execute(&fake, &context(false), "STARTUP", &Cancel::new());
        assert_eq!(done.error.as_deref(), Some("session-expired"));
        assert!(!done.ok);
        assert_eq!(done.origin, "startup");
        assert_eq!(fake.journal().unwrap().sync_run_id, "run00000001");
    }

    #[test]
    fn a_lost_commit_checks_the_server() {
        let mut fake = Fake::new();
        fake.fail_commit = true;
        let done = execute(&fake, &context(false), "MANUAL", &Cancel::new());
        assert!(!done.ok);
        assert_eq!(done.publication, "not-published");
        assert!(!done.requires_merge);
    }

    #[test]
    fn journal_keys_match_electron() {
        let key = journal_key(&context(false));
        let expected = format!(
            "epicSyncRun:{:x}",
            Sha256::digest(br#"["https://api","u","conn12345678"]"#)
        );
        assert_eq!(key, expected);
        let journal = Journal {
            sync_run_id: "r".into(),
            total_chunks: None,
            merge_pending: false,
            requires_reconnect: None,
        };
        assert_eq!(
            serde_json::to_value(&journal).unwrap(),
            json!({"syncRunId": "r", "totalChunks": null, "mergePending": false})
        );
    }
}
