//! Manual check: launch an executable as a custom game in a scratch database,
//! watch it with the process watcher, close it, and print the playtime.
//! `cargo run -p hydra-launch --example play -- <db-folder> <executable>`
use std::sync::Arc;
use std::time::Duration;

use hydra_launch::watcher::Watcher;
use serde_json::{Value, json};

fn main() {
    let mut args = std::env::args().skip(1);
    let folder = args.next().expect("db folder");
    let executable = args.next().expect("executable");
    let db = Arc::new(hydra_db::Db::open(&folder).expect("db"));
    let key = "custom:play-test";
    db.put_in(
        hydra_db::keys::GAMES,
        key,
        &json!({ "title": "Play test", "shop": "custom", "objectId": "play-test", "isDeleted": false,
                 "executablePath": executable, "playTimeInMilliseconds": 0, "remoteId": null }),
    )
    .unwrap();
    let watcher = Watcher::new(
        db.clone(),
        None,
        Box::new(|running| {
            println!(
                "running: {:?}",
                running.iter().map(|r| &r.id).collect::<Vec<_>>()
            )
        }),
    );
    println!(
        "launch: {:?}",
        hydra_launch::launch_game(&db, "custom", "play-test", &executable, None)
    );
    for _ in 0..4 {
        std::thread::sleep(Duration::from_millis(2000));
        watcher.watch();
    }
    println!("closing");
    hydra_launch::close_game(&db, "custom", "play-test");
    std::thread::sleep(Duration::from_millis(1500));
    watcher.watch();
    let game: Value = db.get_in(hydra_db::keys::GAMES, key).unwrap();
    println!(
        "playTime {} ms, lastTimePlayed {}",
        game["playTimeInMilliseconds"], game["lastTimePlayed"]
    );
}
