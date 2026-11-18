//! Launch a library game, watch it like the process watcher does, then close
//! it: the Play / playtime / Close path without the UI.
//!
//!   HYDRA_USER_DATA=<data COPY> cargo run -p hydra-launch --example launch_probe -- \
//!     <data COPY>/hydra-db steam:1091500 /games/x/game.exe ["launch options"] [seconds]
//!
//! Only ever point it at a data copy: it writes the game's executablePath and
//! playtime like Play does.

use std::sync::Arc;
use std::time::Duration;

use hydra_launch::watcher::Watcher;
use hydra_launch::{Launch, close_game, launch_game};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [db_path, key, executable, rest @ ..] = args.as_slice() else {
        eprintln!(
            "usage: launch_probe <hydra-db> <shop:objectId> <executable> [options] [seconds]"
        );
        std::process::exit(2);
    };
    let options = rest.first().filter(|o| !o.is_empty()).cloned();
    let seconds: u64 = rest.get(1).and_then(|s| s.parse().ok()).unwrap_or(20);
    let (shop, object_id) = key.split_once(':').expect("shop:objectId");
    let db = Arc::new(hydra_db::Db::open(db_path).expect("open db"));
    // hydra_store::init_tls in the app: the umu updater talks to GitHub.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let started = std::time::Instant::now();
    let result = launch_game(&db, shop, object_id, executable, options.as_deref());
    println!(
        "[{:5.1}s] launch_game -> {result:?}",
        started.elapsed().as_secs_f32()
    );
    if !matches!(result, Ok(Launch::Started(_))) {
        return;
    }
    let watcher = Watcher::new(
        db.clone(),
        None,
        Box::new(move |running| {
            let ids: Vec<String> = running
                .iter()
                .map(|r| format!("{} ({}s)", r.id, r.session_millis / 1000))
                .collect();
            println!(
                "[{:5.1}s] running: {ids:?}",
                started.elapsed().as_secs_f32()
            );
        }),
    );
    let deadline = started + Duration::from_secs(seconds);
    while std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(hydra_launch::watcher::INTERVAL_MS));
        watcher.watch();
    }
    println!("[{:5.1}s] close_game", started.elapsed().as_secs_f32());
    close_game(&db, shop, object_id);
    for _ in 0..3 {
        std::thread::sleep(Duration::from_millis(hydra_launch::watcher::INTERVAL_MS));
        watcher.watch();
    }
    let game: Option<serde_json::Value> = db.get_in(hydra_db::keys::GAMES, key);
    if let Some(game) = game {
        println!(
            "game: executablePath={} playTimeInMilliseconds={} lastTimePlayed={}",
            game["executablePath"], game["playTimeInMilliseconds"], game["lastTimePlayed"]
        );
    }
}
