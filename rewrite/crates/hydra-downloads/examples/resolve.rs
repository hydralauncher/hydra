//! Manual check of a hoster or debrid service without downloading the file:
//! `cargo run -p hydra-downloads --example resolve -- <data folder> <downloader> <uri>`
//! resolves the link like the check before a download (only the one-byte
//! preflight is fetched) and prints the direct link without its query.
//! `... -- <data folder> sources <shop> <objectId> [source ids]` prints the
//! game's download options per downloader.
//! `... -- <data folder> files <downloader> <magnet>` lists a torrent's files
//! on TorBox (6) or Real-Debrid (0). The app must not be running on the
//! same data folder (LevelDB is single-process).

use std::sync::Arc;

use hydra_core::api::HydraApi;
use hydra_core::repacks::Downloader;
use hydra_db::Db;
use hydra_downloads::manager::Manager;

/// `sources <shop> <objectId>`: the download options' links per downloader.
fn list_sources(db: &Arc<Db>, api: &HydraApi, shop: &str, object_id: &str, extra: &[String]) {
    use serde_json::Value;
    let sources: Vec<Value> = db
        .values(hydra_db::keys::DOWNLOAD_SOURCES)
        .unwrap_or_default();
    let mut query: Vec<(&str, String)> = vec![("take", "100".into()), ("skip", "0".into())];
    for source in &sources {
        if let Some(id) = source.get("id").and_then(|v| {
            v.as_str()
                .map(str::to_string)
                .or_else(|| v.as_i64().map(|n| n.to_string()))
        }) {
            query.push(("downloadSourceIds[]", id));
        }
    }
    for id in extra {
        query.push(("downloadSourceIds[]", id.clone()));
    }
    let path = format!("/games/{shop}/{object_id}/download-sources");
    match api.get(&path, &query, hydra_core::api::Options::public()) {
        Ok(Value::Array(items)) => {
            println!("{} sources, {} download options", sources.len(), items.len());
            for source in &sources {
                println!(
                    "  source: {} {}",
                    source.get("name").and_then(Value::as_str).unwrap_or_default(),
                    source.get("url").and_then(Value::as_str).unwrap_or_default()
                );
            }
            for item in items {
                let title = item.get("title").and_then(Value::as_str).unwrap_or_default();
                let size = item.get("fileSize").and_then(Value::as_str).unwrap_or_default();
                println!("{title} ({size})");
                for uri in item
                    .get("uris")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                {
                    let names: Vec<String> = hydra_core::repacks::downloaders_for_uri(uri)
                        .into_iter()
                        .map(|d| format!("{}={}", d.name(), d as i64))
                        .collect();
                    println!("  {uri} [{}]", names.join(", "));
                }
                if let Some(groups) = item.get("uriGroups") {
                    println!("  groups: {groups}");
                }
            }
        }
        Ok(other) => println!("unexpected answer: {other}"),
        Err(error) => println!("error: {error}"),
    }
}

fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut args = std::env::args().skip(1);
    let data = std::path::PathBuf::from(args.next().expect("data folder"));
    let mut mode = args.next().expect("downloader number, `files` or `sources`");
    if mode == "sources" {
        let shop = args.next().expect("shop");
        let object_id = args.next().expect("objectId");
        let db = Arc::new(Db::open(data.join("hydra-db")).expect("open the database"));
        let client = reqwest::blocking::Client::builder()
            .build()
            .expect("client");
        let api = HydraApi::new(db.clone(), client);
        let extra: Vec<String> = args.collect();
        list_sources(&db, &api, &shop, &object_id, &extra);
        return;
    }
    let list_files = mode == "files";
    if list_files {
        mode = args.next().expect("downloader number");
    }
    let downloader = mode
        .parse::<i64>()
        .ok()
        .and_then(Downloader::from_i64)
        .expect("a Downloader number");
    let uri = args.next().expect("uri");
    let db = Arc::new(Db::open(data.join("hydra-db")).expect("open the data folder's database"));
    let tokens = hydra_downloads::debrid::tokens(&db);
    println!(
        "tokens: real-debrid={} torbox={} alldebrid={} premiumize={}",
        tokens.real_debrid.is_some(),
        tokens.torbox.is_some(),
        tokens.all_debrid.is_some(),
        tokens.premiumize.is_some()
    );
    let client = reqwest::blocking::Client::builder()
        .build()
        .expect("client");
    let api = Arc::new(HydraApi::new(db.clone(), client));
    let manager = Manager::new(db, Some(api), &data, Box::new(|_| {}));
    let started = std::time::Instant::now();
    if list_files {
        match manager.debrid_files(&uri, downloader) {
            Ok(files) => {
                println!(
                    "{} ({} bytes, archive only: {}), {} files",
                    files.name,
                    files.total_size,
                    files.archive_only,
                    files.files.len()
                );
                for file in files.files.iter().take(20) {
                    println!("  [{}] {} ({} bytes)", file.index, file.path, file.size);
                }
            }
            Err(error) => println!("error: {error}"),
        }
    } else {
        let folder = std::env::temp_dir().join("hydra-resolve-probe");
        match manager.probe_link(downloader, &uri, &folder.to_string_lossy()) {
            Ok((url, filename)) => println!("ok: {url} (file name: {filename:?})"),
            Err(error) => println!("error: {error}"),
        }
    }
    println!("took {:.1}s", started.elapsed().as_secs_f64());
}
