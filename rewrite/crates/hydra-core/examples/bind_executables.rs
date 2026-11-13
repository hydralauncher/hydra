//! Manual check: for every download in a database, look for the game's
//! executable the way searchAndBindExecutable does and print what it finds,
//! without saving anything. `cargo run -p hydra-core --example bind_executables -- <user-data>`
use std::path::Path;
use std::sync::Arc;

use hydra_core::api::HydraApi;
use hydra_core::executables::{self, Scope};
use serde_json::Value;

fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let folder = std::env::args().nth(1).expect("user data folder");
    let db = Arc::new(hydra_db::Db::open(Path::new(&folder).join("hydra-db")).expect("db"));
    let client = reqwest::blocking::Client::builder()
        .build()
        .expect("client");
    let api = HydraApi::new(db.clone(), client);
    println!(
        "catalogue loaded: {}",
        executables::ensure_loaded(&api, true)
    );
    if let Some(steamapps) = std::env::args().nth(2) {
        steam(Path::new(&steamapps));
        return;
    }
    for (key, download) in db
        .entries::<Value>(hydra_db::keys::DOWNLOADS)
        .unwrap_or_default()
    {
        let object_id = key.split_once(':').map(|(_, id)| id).unwrap_or_default();
        let folder = Path::new(download["downloadPath"].as_str().unwrap_or_default())
            .join(download["folderName"].as_str().unwrap_or_default());
        let known = executables::for_game(object_id);
        let found = known
            .as_ref()
            .and_then(|k| executables::find_in_folder(&folder, k, Scope::Installation, None));
        println!(
            "{key}: {} known, folder {} exists={}, found {:?}",
            known.map_or(0, |k| k.len()),
            folder.display(),
            folder.is_dir(),
            found
        );
    }
}

/// `-- steam <steamapps>`: run the finder over installed Steam games.
#[allow(dead_code)]
fn steam(steamapps: &Path) {
    for entry in std::fs::read_dir(steamapps).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(app_id) = name
            .strip_prefix("appmanifest_")
            .and_then(|n| n.strip_suffix(".acf"))
        else {
            continue;
        };
        let text = std::fs::read_to_string(entry.path()).unwrap_or_default();
        let Some(dir) = text.lines().find_map(|l| {
            l.trim()
                .strip_prefix("\"installdir\"")
                .map(|v| v.trim().trim_matches('"').to_string())
        }) else {
            continue;
        };
        let folder = steamapps.join("common").join(&dir);
        let known = executables::for_game(app_id);
        let found = known
            .as_ref()
            .and_then(|k| executables::find_in_folder(&folder, k, Scope::Installation, None));
        println!(
            "steam:{app_id} {dir}: {} known, found {:?}",
            known.map_or(0, |k| k.len()),
            found
        );
    }
}
