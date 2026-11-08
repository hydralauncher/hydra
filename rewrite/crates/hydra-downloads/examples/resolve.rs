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
            println!(
                "{} sources, {} download options",
                sources.len(),
                items.len()
            );
            for source in &sources {
                println!(
                    "  source: {} {}",
                    source
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    source
                        .get("url")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                );
            }
            for item in items {
                let title = item
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let size = item
                    .get("fileSize")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
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
    let mut mode = args
        .next()
        .expect("downloader number, `files` or `sources`");
    if mode == "download" {
        // `download <shop> <objectId> <title> <downloader> <uri> <folder> <seconds> [part uris…]`:
        // start through the manager like the modal does, let it run, pause,
        // resume, then cancel (which deletes the partial file).
        let (shop, object_id, title) = (
            args.next().expect("shop"),
            args.next().expect("objectId"),
            args.next().expect("title"),
        );
        let downloader = args
            .next()
            .and_then(|n| n.parse::<i64>().ok())
            .and_then(Downloader::from_i64)
            .expect("downloader");
        let uri = args.next().expect("uri");
        let folder = args.next().expect("folder");
        let seconds: u64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(5);
        let mut parts: Vec<String> = args.collect();
        if !parts.is_empty() {
            parts.insert(0, uri.clone());
        }
        let db = Arc::new(Db::open(data.join("hydra-db")).expect("open the database"));
        let client = reqwest::blocking::Client::builder()
            .build()
            .expect("client");
        let api = Arc::new(HydraApi::new(db.clone(), client));
        let manager = Manager::new(
            db.clone(),
            Some(api),
            &data,
            Box::new(|event| {
                if let hydra_downloads::manager::Event::Progress(Some(p)) = event {
                    println!(
                        "  progress {:.2}% {:.1} MB/s folder={:?} preparing={}",
                        p.progress * 100.0,
                        p.download_speed / 1_048_576.0,
                        p.download.get("folderName"),
                        p.is_downloading_metadata
                    );
                }
            }),
        );
        manager.spawn_watch_loop();
        let id = format!("{shop}:{object_id}");
        let show = |label: &str| {
            let record: Option<serde_json::Value> = db.get_in(hydra_db::keys::DOWNLOADS, &id);
            let record = record.unwrap_or_default();
            println!(
                "{label}: status={} queued={} bytes={} fileSize={} folder={} files={}",
                record["status"],
                record["queued"],
                record["bytesDownloaded"],
                record["fileSize"],
                record["folderName"],
                record["files"]
                    .as_array()
                    .map(|f| f.len().to_string())
                    .unwrap_or("-".into())
            );
        };
        let started = std::time::Instant::now();
        let result = manager.start_game_download(hydra_downloads::manager::StartPayload {
            object_id: object_id.clone(),
            title,
            shop: shop.clone(),
            download_path: folder.clone(),
            downloader,
            uri,
            parts: (!parts.is_empty()).then_some(parts),
            automatically_extract: false,
            automatically_delete_archive_files: false,
            file_size: None,
            file_indices: None,
            selected_files_size: None,
        });
        println!(
            "start: {result:?} after {:.1}s",
            started.elapsed().as_secs_f64()
        );
        show("started");
        std::thread::sleep(std::time::Duration::from_secs(seconds));
        show("running");
        println!("pause: {}", manager.pause_by_id(&shop, &object_id));
        show("paused");
        println!(
            "resume: {}",
            manager.resume(&shop, &object_id, "interruptActive", None)
        );
        std::thread::sleep(std::time::Duration::from_secs(4));
        show("resumed");
        println!("cancel: {}", manager.cancel_by_id(&shop, &object_id));
        show("cancelled");
        let leftovers: Vec<String> = std::fs::read_dir(&folder)
            .map(|d| {
                d.filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        println!("files left in {folder}: {leftovers:?}");
        return;
    }
    if mode == "put-downloads" {
        // `put-downloads <file.json>`: download records (an array) into a
        // TEST data copy, to set up Downloads page states; `remove-downloads
        // <file.json>` deletes the same keys.
        let path = args.next().expect("JSON file");
        let records: Vec<serde_json::Value> =
            serde_json::from_str(&std::fs::read_to_string(path).expect("read"))
                .expect("JSON array");
        let db = Db::open(data.join("hydra-db")).expect("open the database");
        for record in records {
            let key = format!(
                "{}:{}",
                record["shop"].as_str().unwrap_or_default(),
                record["objectId"].as_str().unwrap_or_default()
            );
            db.put_in(hydra_db::keys::DOWNLOADS, &key, &record)
                .expect("save the download");
            println!("saved {key}");
        }
        return;
    }
    if mode == "remove-downloads" {
        let path = args.next().expect("JSON file");
        let records: Vec<serde_json::Value> =
            serde_json::from_str(&std::fs::read_to_string(path).expect("read"))
                .expect("JSON array");
        let db = Db::open(data.join("hydra-db")).expect("open the database");
        for record in records {
            let key = format!(
                "{}:{}",
                record["shop"].as_str().unwrap_or_default(),
                record["objectId"].as_str().unwrap_or_default()
            );
            let _ = db.delete_in(hydra_db::keys::DOWNLOADS, &key);
            println!("removed {key}");
        }
        return;
    }
    if mode == "set-pref" {
        // `set-pref <key> <json>`: a user preference in a TEST data copy
        // (e.g. a placeholder debrid token for screenshots; `null` removes it).
        let (key, value) = (args.next().expect("key"), args.next().expect("json value"));
        let value: serde_json::Value = serde_json::from_str(&value).expect("JSON value");
        let db = Db::open(data.join("hydra-db")).expect("open the database");
        let mut prefs: serde_json::Value = db
            .get(hydra_db::keys::USER_PREFERENCES)
            .unwrap_or_else(|| serde_json::json!({}));
        if let Some(map) = prefs.as_object_mut() {
            if value.is_null() {
                map.remove(&key);
            } else {
                map.insert(key.clone(), value);
            }
        }
        db.put(hydra_db::keys::USER_PREFERENCES, &prefs)
            .expect("save the preferences");
        println!("{key} updated");
        return;
    }
    if mode == "local-source" {
        // `local-source <id> <name> <url> <fingerprint>`: a download source
        // in a TEST data copy only (addDownloadSource's local record, without
        // the API or the profile), so its download options show in the app.
        let (id, name, url, fingerprint) = (
            args.next().expect("id"),
            args.next().expect("name"),
            args.next().expect("url"),
            args.next().expect("fingerprint"),
        );
        let db = Db::open(data.join("hydra-db")).expect("open the database");
        let record = serde_json::json!({
            "id": id, "name": name, "url": url, "fingerprint": fingerprint,
            "status": "MATCHED", "isRemote": true,
            "createdAt": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        });
        db.put_in(hydra_db::keys::DOWNLOAD_SOURCES, &id, &record)
            .expect("save the source");
        println!("saved {name} ({id})");
        return;
    }
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
