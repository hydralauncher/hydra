//! screenshots/foreground-game.ts: which running game the screenshot is of.
//! The matching rules are hydra_core::screenshots::matching; this gathers
//! the running games, the foreground window and the process list.

use std::collections::HashMap;
use std::sync::Mutex;

use hydra_capture::foreground::{ForegroundWindow, foreground_window, is_wayland_session};
use hydra_core::screenshots::matching::{
    self, Foreground, GameTarget, MatchInput, Platform, Process,
};
use serde_json::Value;

use super::Service;
use super::capture::TriggerSource;

pub struct Candidate {
    pub target: GameTarget,
    pub game: Value,
}

pub enum Lookup {
    Resolved {
        target: GameTarget,
        game: Option<Value>,
        foreground: Option<ForegroundWindow>,
    },
    Unresolved {
        candidates: Vec<Candidate>,
        foreground: Option<ForegroundWindow>,
    },
}

/// matchedForegroundProcesses: pid → (gameKey, window key)
static REMEMBERED: Mutex<Option<HashMap<u32, (String, Option<String>)>>> = Mutex::new(None);

/// forgetForegroundGame
pub fn forget(game_key: &str) {
    if let Some(map) = REMEMBERED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_mut()
    {
        map.retain(|_, (key, _)| key != game_key);
    }
}

fn text(game: &Value, key: &str) -> Option<String> {
    game.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// getTrackedGameTarget
fn tracked_target(game_key: &str, game: &Value) -> GameTarget {
    let mut executable_paths: Vec<String> = text(game, "executablePath").into_iter().collect();
    if let Some(tracking) = game
        .get("trackingExecutablePaths")
        .and_then(Value::as_array)
    {
        executable_paths.extend(
            tracking
                .iter()
                .filter_map(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string),
        );
    }
    GameTarget {
        game_key: game_key.to_string(),
        shop: text(game, "shop").unwrap_or_default(),
        object_id: text(game, "objectId").unwrap_or_default(),
        title: text(game, "title").unwrap_or_default(),
        process_id: hydra_launch::watcher::launched_pid(game_key),
        executable_paths,
        // TODO(wine): Wine.getEffectivePrefixPath (the default prefix per game)
        wine_prefix_path: if cfg!(target_os = "linux") {
            text(game, "winePrefixPath")
        } else {
            None
        },
        is_emulator: false,
    }
}

/// getScreenshotGameTargets (emulator sessions come with emulators)
pub fn candidates(service: &Service) -> Vec<Candidate> {
    service
        .running_games()
        .into_iter()
        .filter_map(|key| {
            let game = service.game(&key)?;
            Some(Candidate {
                target: tracked_target(&key, &game),
                game,
            })
        })
        .collect()
}

pub fn to_match_foreground(window: &ForegroundWindow) -> Foreground {
    Foreground {
        process_id: window.process_id,
        client_process_id: window.client_process_id,
    }
}

/// toForegroundProcesses
pub fn processes() -> Vec<Process> {
    hydra_capture::processes::list()
        .into_iter()
        .map(|p| Process {
            pid: p.pid,
            parent_pid: p.parent_pid,
            exe: p.exe,
            cwd: p.cwd,
            environ: p.environ,
        })
        .collect()
}

/// readNamespacedPids: /proc/<pid>/status NSpid
fn read_namespaced_pids(host_pid: u32) -> Option<Vec<u32>> {
    let status = std::fs::read_to_string(format!("/proc/{host_pid}/status")).ok()?;
    matching::parse_namespaced_pids(&status)
}

/// findProcessTreeTarget
fn process_tree_target(candidates: &[Candidate], foreground: &ForegroundWindow) -> Option<usize> {
    let processes = processes();
    let targets: Vec<GameTarget> = candidates.iter().map(|c| c.target.clone()).collect();
    let input = MatchInput {
        platform: Platform::current(),
        targets: &targets,
        foreground: to_match_foreground(foreground),
        processes: &processes,
        namespaced_pids: None,
    };
    let found = matching::find_foreground_target(&input);
    let needs_namespaced = cfg!(target_os = "linux")
        && foreground.client_process_id.is_none()
        && foreground.process_id.is_some()
        && targets.iter().any(|t| t.process_id.is_some());
    if found.is_some() || !needs_namespaced {
        return found;
    }
    let lookup: HashMap<u32, Option<Vec<u32>>> = processes
        .iter()
        .map(|p| (p.pid, read_namespaced_pids(p.pid)))
        .collect();
    let namespaced = move |pid: u32| lookup.get(&pid).cloned().flatten();
    matching::find_foreground_target(&MatchInput {
        namespaced_pids: Some(&namespaced),
        ..input
    })
}

fn log_match(source: TriggerSource, matched_by: &str, game_key: &str) {
    eprintln!(
        "Screenshot foreground game resolved: {game_key} by {matched_by} ({})",
        source.as_str()
    );
}

/// resolveForegroundGame
pub fn resolve(service: &Service, source: TriggerSource) -> Lookup {
    let candidates = candidates(service);
    if candidates.is_empty() {
        eprintln!(
            "Screenshot hotkey ignored: no running game ({})",
            source.as_str()
        );
        return Lookup::Unresolved {
            candidates,
            foreground: None,
        };
    }
    let foreground = foreground_window();

    if let Some(window) = &foreground {
        if candidates.len() == 1
            && matching::is_launched_foreground_process(
                &candidates[0].target,
                to_match_foreground(window),
            )
        {
            log_match(source, "launched_process", &candidates[0].target.game_key);
            let candidate = candidates.into_iter().next().unwrap();
            return Lookup::Resolved {
                target: candidate.target,
                game: Some(candidate.game),
                foreground,
            };
        }

        // findRememberedCandidate
        if let Some(pid) = window.process_id {
            let remembered = {
                let mut guard = REMEMBERED.lock().unwrap_or_else(|e| e.into_inner());
                let map = guard.get_or_insert_with(HashMap::new);
                match map.get(&pid).cloned() {
                    Some((key, window_key)) if window_key.as_deref() == window.window_key() => {
                        Some(key)
                    }
                    Some(_) => {
                        map.remove(&pid);
                        None
                    }
                    None => None,
                }
            };
            if let Some(key) = remembered {
                if let Some(index) = candidates.iter().position(|c| c.target.game_key == key) {
                    log_match(source, "remembered_process", &key);
                    let candidate = candidates.into_iter().nth(index).unwrap();
                    return Lookup::Resolved {
                        target: candidate.target,
                        game: Some(candidate.game),
                        foreground,
                    };
                }
            }
        }

        if let Some(index) = process_tree_target(&candidates, window) {
            let candidate = candidates.into_iter().nth(index).unwrap();
            if let Some(pid) = window.process_id {
                REMEMBERED
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get_or_insert_with(HashMap::new)
                    .insert(
                        pid,
                        (
                            candidate.target.game_key.clone(),
                            window.window_key().map(str::to_string),
                        ),
                    );
            }
            log_match(source, "process_tree", &candidate.target.game_key);
            return Lookup::Resolved {
                target: candidate.target,
                game: Some(candidate.game),
                foreground,
            };
        }

        if window.process_id.is_some() || !is_wayland_session() {
            eprintln!(
                "Screenshot hotkey ignored: no tracked game in foreground (pid {:?}, client {:?}, window {:?})",
                window.process_id, window.client_process_id, window.window_id
            );
            return Lookup::Unresolved {
                candidates,
                foreground,
            };
        }
    }

    let wayland = is_wayland_session();
    let deeplink = source == TriggerSource::Deeplink;
    if !wayland || deeplink || super::is_hydra_focused() {
        eprintln!(
            "Screenshot hotkey ignored: foreground window unresolved ({})",
            source.as_str()
        );
        return Lookup::Unresolved {
            candidates,
            foreground,
        };
    }
    let targets: Vec<GameTarget> = candidates.iter().map(|c| c.target.clone()).collect();
    match matching::find_sole_launched_target(&targets) {
        Some(index) => {
            let candidate = candidates.into_iter().nth(index).unwrap();
            log_match(source, "sole_launched_game", &candidate.target.game_key);
            Lookup::Resolved {
                target: candidate.target,
                game: Some(candidate.game),
                foreground: None,
            }
        }
        None => {
            eprintln!("Screenshot hotkey ignored: no single launched game");
            Lookup::Unresolved {
                candidates,
                foreground,
            }
        }
    }
}

/// getUnresolvedGameFailure: (failure kind, game title)
pub fn unresolved_failure(
    source: TriggerSource,
    candidates: &[Candidate],
    foreground: Option<&ForegroundWindow>,
) -> Option<(&'static str, Option<String>)> {
    if candidates.is_empty() {
        return None;
    }
    let focus_unknown = foreground.and_then(|f| f.process_id).is_none();
    if focus_unknown && source == TriggerSource::Deeplink {
        return None;
    }
    if candidates.len() == 1 {
        let title = text(&candidates[0].game, "title").unwrap_or_default();
        return Some(("game_not_focused", Some(title)));
    }
    focus_unknown.then_some(("game_not_recognized", None))
}
