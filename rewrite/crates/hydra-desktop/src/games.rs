//! Playing games: the process watcher (hydra-launch) and the Play / Close
//! actions (window.electron.openGame / closeGame).

use std::cell::RefCell;
use std::collections::HashSet;
use std::sync::{Arc, OnceLock};

use hydra_core::api::HydraApi;
use hydra_db::{Db, keys};
use hydra_launch::watcher::{Running, Watcher};
use serde_json::Value;

static WATCHER: OnceLock<Arc<Watcher>> = OnceLock::new();

thread_local! {
    /// on-games-running ids
    static RUNNING: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
    /// gameRunning: the last game in the on-games-running list
    static SHOWN: RefCell<Option<String>> = const { RefCell::new(None) };
    /// gameRunning.sessionDurationInMillis of the shown game
    static SESSION: RefCell<u64> = const { RefCell::new(0) };
}

/// gameRunning: the shown game's "shop:objectId" and its session length.
pub fn shown_game() -> Option<(String, u64)> {
    SHOWN
        .with(|s| s.borrow().clone())
        .map(|id| (id, SESSION.with(|s| *s.borrow())))
}

pub fn init(db: Arc<Db>, api: Arc<HydraApi>) {
    let watcher = Watcher::new(
        db,
        Some(api),
        Box::new(|running: Vec<Running>| {
            let _ = slint::invoke_from_event_loop(move || on_running(running));
        }),
    );
    watcher.spawn();
    let _ = WATCHER.set(watcher);
}

fn on_running(running: Vec<Running>) {
    SESSION.with(|s| *s.borrow_mut() = running.last().map(|r| r.session_millis).unwrap_or(0));
    update_game_running(&running);
    crate::profile_page::on_games_running();
    let ids: HashSet<String> = running.into_iter().map(|r| r.id).collect();
    let changed = RUNNING.with(|r| {
        let mut r = r.borrow_mut();
        if *r == ids {
            false
        } else {
            *r = ids;
            true
        }
    });
    if changed {
        crate::game_page::on_games_running();
        crate::downloads_page::refresh();
        crate::shell::load_library();
    }
}

/// app.tsx onGamesRunning: the sidebar shows the last running library game,
/// unless a concealed duplicate that is also running shares its executable.
fn update_game_running(running: &[Running]) {
    let Some(db) = crate::shell::db() else { return };
    let ids: HashSet<&str> = running.iter().map(|r| r.id.as_str()).collect();
    let game = running
        .last()
        .and_then(|last| db.get_in::<Value>(keys::GAMES, &last.id))
        .filter(|game| {
            let executable = game
                .get("executablePath")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_lowercase();
            !running.iter().any(|r| {
                ids.contains(r.id.as_str())
                    && db.get_in::<Value>(keys::GAMES, &r.id).is_some_and(|g| {
                        g.get("isConcealed").and_then(Value::as_bool) == Some(true)
                            && g.get("executablePath")
                                .and_then(Value::as_str)
                                .is_some_and(|p| !p.is_empty() && p.to_lowercase() == executable)
                    })
            })
        });
    let id = running
        .last()
        .map(|r| r.id.clone())
        .filter(|_| game.is_some());
    if SHOWN.with(|s| *s.borrow() == id) {
        return;
    }
    SHOWN.with(|s| *s.borrow_mut() = id);
    let text = |key: &str| {
        game.as_ref()
            .and_then(|g| g.get(key))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    crate::shell::set_game_running(&text("title"), &text("iconUrl"));
}

/// isGameRunning
pub fn is_running(id: &str) -> bool {
    RUNNING.with(|r| r.borrow().contains(id))
}

/// openGame: launch the game's executable with its launch options.
pub fn play(shop: &str, object_id: &str) {
    let Some(db) = crate::shell::db() else { return };
    let key = format!("{shop}:{object_id}");
    let game: Option<Value> = db.get_in(keys::GAMES, &key);
    let executable = game
        .as_ref()
        .and_then(|g| g.get("executablePath"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let options = game
        .as_ref()
        .and_then(|g| g.get("launchOptions"))
        .and_then(Value::as_str)
        .map(str::to_string);
    if shop == "launchbox" {
        // TODO(launch): openClassicsGame (emulators, disc selection).
        eprintln!("TODO(launch): classics games launch through their emulator");
        return;
    }
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    std::thread::spawn(move || {
        let result =
            hydra_launch::launch_game(&db, &shop, &object_id, &executable, options.as_deref());
        let _ = slint::invoke_from_event_loop(move || match result {
            Ok(hydra_launch::Launch::ExecutableNotFound) => {
                // on-game-executable-not-found
                crate::toast::error_with(
                    &crate::shell::tr("game_details.executable_not_found_title"),
                    &crate::shell::tr("game_details.executable_not_found_description"),
                    2500,
                );
            }
            Ok(hydra_launch::Launch::Started(_)) => {}
            Err(error) => eprintln!("Failed to start game: {error}"),
        });
    });
}

/// closeGame
pub fn close(shop: &str, object_id: &str) {
    let Some(db) = crate::shell::db() else { return };
    let (shop, object_id) = (shop.to_string(), object_id.to_string());
    std::thread::spawn(move || hydra_launch::close_game(&db, &shop, &object_id));
}
