//! Runs the parsers over snapshots downloaded for research and prints one JSON line per snapshot.
//!
//! cargo run --release --example corpus_report -- <shop> <objectId> <corpusDir>
//!
//! `<corpusDir>` holds one folder per snapshot, each with a `_manifest.json` listing
//! `rawPath`, `relativePath`, `lastModifiedAt` and the `local` path of every downloaded file.

use std::path::Path;
use std::time::Instant;

use hydra_save_insights::{summarize, FileContent, SaveFile};
use serde_json::{json, Value};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let [_, shop, object_id, corpus] = args.as_slice() else {
        eprintln!("usage: corpus_report <shop> <objectId> <corpusDir>");
        std::process::exit(2);
    };

    let mut snapshots: Vec<_> = std::fs::read_dir(corpus)
        .expect("corpus dir")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.join("_manifest.json").is_file())
        .collect();
    snapshots.sort();

    for snapshot in snapshots {
        let files = load_manifest(&snapshot);
        let started = Instant::now();
        let summary = summarize(shop, object_id, &files);
        let elapsed_ms = started.elapsed().as_millis();
        println!(
            "{}",
            json!({
                "snapshot": snapshot.file_name().unwrap().to_string_lossy(),
                "files": files.len(),
                "elapsedMs": elapsed_ms,
                "summary": summary,
            })
        );
    }
}

fn load_manifest(snapshot: &Path) -> Vec<SaveFile> {
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(snapshot.join("_manifest.json")).expect("manifest"))
            .expect("manifest json");
    manifest["files"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|file| {
            let local = file["local"].as_str()?;
            Some(SaveFile {
                raw_path: file["rawPath"].as_str()?.to_owned(),
                relative_path: file["relativePath"].as_str()?.to_owned(),
                size: file["size"].as_u64()?,
                modified_at_ms: file["lastModifiedAt"].as_str().and_then(parse_iso_ms),
                content: FileContent::Path(snapshot.join(local)),
            })
        })
        .collect()
}

/// Parses `2026-11-08T22:11:15.000Z`.
fn parse_iso_ms(text: &str) -> Option<i64> {
    let (date, time) = text.trim_end_matches('Z').split_once('T')?;
    let mut date = date.split('-').map(|part| part.parse::<i64>().ok());
    let (year, month, day) = (date.next()??, date.next()??, date.next()??);
    let (clock, millis) = time.split_once('.').unwrap_or((time, "0"));
    let mut clock = clock.split(':').map(|part| part.parse::<i64>().ok());
    let (hour, minute, second) = (clock.next()??, clock.next()??, clock.next()??);
    let millis: i64 = millis.get(..3.min(millis.len()))?.parse().ok()?;

    let shifted_year = if month <= 2 { year - 1 } else { year };
    let era = shifted_year.div_euclid(400);
    let year_of_era = shifted_year - era * 400;
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    Some(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000 + millis)
}
