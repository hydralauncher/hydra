//! Library sync dry run against a data folder, without writing it.
//! `cargo run -p hydra-core --example library_sync -- <rewrite data folder>`
//!
//! Copies `<data>/hydra-db` to a temp folder, prints the `/profile/games/batch`
//! bodies uploadGamesBatch would send (never sent), reads the account
//! library (GETs only) and merges it into the copy, then lists what changed.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use hydra_core::api::HydraApi;
use hydra_core::library_sync::{self, MergeContext};
use hydra_db::{Db, keys};
use serde_json::{Map, Value};

fn copy_dir(from: &std::path::Path, to: &std::path::Path) {
    std::fs::create_dir_all(to).expect("temp dir");
    for entry in std::fs::read_dir(from).expect("read data") {
        let entry = entry.expect("entry");
        let target = to.join(entry.file_name());
        if entry.file_type().expect("type").is_dir() {
            copy_dir(&entry.path(), &target);
        } else if entry.file_name() != "LOCK" {
            std::fs::copy(entry.path(), target).expect("copy");
        }
    }
}

fn main() {
    let data = std::path::PathBuf::from(std::env::args().nth(1).expect("data folder"));
    let source = data.join(hydra_db::paths::database_name(
        &hydra_core::config::api_url(),
    ));
    let copy = std::env::temp_dir().join(format!("hydra-library-sync-{}", std::process::id()));
    copy_dir(&source, &copy);
    let db = Arc::new(Db::open(&copy).expect("open copy"));
    // --empty-copy <data folder>: write a copy of the data folder with an
    // empty library (a new install that is signed in), for app runs.
    let args: Vec<String> = std::env::args().collect();
    if let Some(target) = args
        .iter()
        .position(|a| a == "--empty-copy")
        .and_then(|i| args.get(i + 1))
    {
        let mut batch = hydra_db::Batch::default();
        for sublevel in [keys::GAMES, keys::GAME_SHOP_ASSETS] {
            for (key, _) in db.entries::<Value>(sublevel).expect("entries") {
                batch.delete_in(sublevel, &key);
            }
        }
        db.write(batch).expect("clear");
        drop(db);
        let target = std::path::PathBuf::from(target);
        let _ = std::fs::remove_dir_all(target.join(source.file_name().expect("db name")));
        copy_dir(&copy, &target.join(source.file_name().expect("db name")));
        let _ = std::fs::remove_dir_all(&copy);
        println!("wrote {} with an empty library", target.display());
        return;
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let api = HydraApi::new(db.clone(), reqwest::blocking::Client::new());
    println!("api: {}", hydra_core::config::api_url());
    println!("logged in: {}", api.is_logged_in());
    let mut summary: Vec<_> = library_sync::summarize(&db).into_iter().collect();
    summary.sort();
    println!("local: {summary:?}");
    match api.get(
        "/profile/integrations/steam",
        &[],
        hydra_core::api::Options::default(),
    ) {
        Ok(status) => println!(
            "steam: connected={} snapshotPreserved={} lastSyncedAt={} latestSyncRun={}",
            status["connected"],
            status["snapshotPreserved"],
            status["lastSyncedAt"],
            status["latestSyncRun"]["status"]
        ),
        Err(error) => println!("steam status: {error}"),
    }

    // uploadGamesBatch, printed only
    let games: Vec<(String, Map<String, Value>)> = db.entries(keys::GAMES).expect("games");
    let candidates = library_sync::upload_candidates(&games);
    for chunk in candidates.chunks(30) {
        let body: Vec<Value> = chunk
            .iter()
            .map(|(_, g)| library_sync::upload_item(g))
            .collect();
        println!("would POST /profile/games/batch {}", Value::Array(body));
    }

    let before: HashMap<String, Map<String, Value>> = games.into_iter().collect();
    let assets_before: HashMap<String, Map<String, Value>> = db
        .entries(keys::GAME_SHOP_ASSETS)
        .expect("assets")
        .into_iter()
        .collect();
    let started = std::time::Instant::now();
    let remote = match library_sync::fetch_remote_profile_games(&api) {
        Ok(remote) => remote,
        Err(error) => {
            println!("fetch failed: {error}");
            return;
        }
    };
    println!("remote games: {} in {:?}", remote.len(), started.elapsed());
    // --fresh: an empty library (a new install signing in), so every row is
    // created from the account and compared with the stored one.
    if std::env::args().any(|a| a == "--fresh") {
        let mut batch = hydra_db::Batch::default();
        for key in before.keys() {
            batch.delete_in(keys::GAMES, key);
        }
        for key in assets_before.keys() {
            batch.delete_in(keys::GAME_SHOP_ASSETS, key);
        }
        db.write(batch).expect("clear");
        println!("cleared the copy's games and shop assets");
    }
    let subscribed = std::env::var_os("SUBSCRIBED").is_some();
    let current = || true;
    let ctx = MergeContext {
        can_reconcile_custom_artwork: subscribed,
        auth: library_sync::auth_context(&db),
        current: &current,
        progress: None,
        epic_connection_id: None,
    };
    let started = std::time::Instant::now();
    let report = library_sync::merge_fetched_games(&db, &api, &remote, &ctx, 0);
    println!("merge: {report:?} in {:?}", started.elapsed());
    let after: Vec<(String, Map<String, Value>)> = db.entries(keys::GAMES).expect("games");
    let mut changed_fields: BTreeMap<String, usize> = BTreeMap::new();
    let mut examples: BTreeMap<String, String> = BTreeMap::new();
    for (key, game) in &after {
        let Some(old) = before.get(key) else {
            continue;
        };
        for (field, value) in game {
            if old.get(field) != Some(value) {
                *changed_fields.entry(field.clone()).or_default() += 1;
                examples
                    .entry(field.clone())
                    .or_insert_with(|| format!("{key}: {:?} -> {value}", old.get(field)));
            }
        }
        for field in old.keys() {
            if !game.contains_key(field) {
                *changed_fields.entry(format!("-{field}")).or_default() += 1;
            }
        }
    }
    println!("changed fields on existing games:");
    for (field, count) in &changed_fields {
        println!(
            "  {field}: {count}  e.g. {}",
            examples.get(field).map(String::as_str).unwrap_or("")
        );
    }
    let created: Vec<&String> = after
        .iter()
        .map(|(k, _)| k)
        .filter(|k| !before.contains_key(*k))
        .collect();
    println!(
        "created locally: {} {:?}",
        created.len(),
        &created[..created.len().min(10)]
    );
    let mut asset_fields: BTreeMap<String, usize> = BTreeMap::new();
    let mut asset_examples: BTreeMap<String, String> = BTreeMap::new();
    let mut new_assets = 0;
    for (key, assets) in db
        .entries::<Map<String, Value>>(keys::GAME_SHOP_ASSETS)
        .expect("assets")
    {
        let Some(old) = assets_before.get(&key) else {
            new_assets += 1;
            continue;
        };
        for (field, value) in &assets {
            if old.get(field) != Some(value) {
                *asset_fields.entry(field.clone()).or_default() += 1;
                asset_examples.entry(field.clone()).or_insert_with(|| {
                    let text = format!("{key}: {:?} -> {value}", old.get(field));
                    text.chars().take(240).collect()
                });
            }
        }
        for field in old.keys() {
            if !assets.contains_key(field) {
                *asset_fields.entry(format!("-{field}")).or_default() += 1;
            }
        }
    }
    println!("shop assets: {new_assets} new; changed fields:");
    for (field, count) in &asset_fields {
        println!(
            "  {field}: {count}  e.g. {}",
            asset_examples.get(field).map(String::as_str).unwrap_or("")
        );
    }
    drop(db);
    let _ = std::fs::remove_dir_all(&copy);
}
