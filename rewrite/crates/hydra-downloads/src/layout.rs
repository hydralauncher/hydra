//! types/download-contract.ts and services/download-layout-state.ts: download
//! records (kept as JSON objects so every field Electron writes survives) and
//! the saved order of the queue and paused lists.

use std::collections::HashSet;

use hydra_db::{Db, keys};
use serde_json::{Map, Value, json};

pub type Download = Map<String, Value>;

const LAYOUT_KEY: &str = "layout";

fn text<'a>(download: &'a Download, key: &str) -> &'a str {
    download
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn flag(download: &Download, key: &str) -> bool {
    download.get(key).and_then(Value::as_bool).unwrap_or(false)
}

pub fn status(download: &Download) -> &str {
    text(download, "status")
}

/// getDownloadId / levelKeys.game: "shop:objectId"
pub fn id(download: &Download) -> String {
    format!("{}:{}", text(download, "shop"), text(download, "objectId"))
}

pub fn is_active_like(d: &Download) -> bool {
    matches!(status(d), "active" | "extracting") || flag(d, "extracting")
}

pub fn is_queued(d: &Download) -> bool {
    status(d) == "paused" && flag(d, "queued") && !is_active_like(d)
}

pub fn is_paused(d: &Download) -> bool {
    (status(d) == "paused" && !flag(d, "queued")) || status(d) == "error"
}

pub fn is_completed_like(d: &Download) -> bool {
    matches!(status(d), "complete" | "seeding")
}

pub fn is_terminal(d: &Download) -> bool {
    matches!(status(d), "removed" | "complete" | "seeding" | "error")
}

/// asQueuedDownload
pub fn as_queued(mut d: Download) -> Download {
    d.insert("status".into(), json!("paused"));
    d.insert("queued".into(), json!(true));
    d.insert("pinnedToHero".into(), json!(false));
    d.insert("extracting".into(), json!(false));
    d.insert("extractionProgress".into(), json!(0));
    d
}

/// asPausedDownload
pub fn as_paused(mut d: Download, status: &str) -> Download {
    d.insert("status".into(), json!(status));
    d.insert("queued".into(), json!(false));
    d.insert("pinnedToHero".into(), json!(false));
    d.insert("extracting".into(), json!(false));
    d.insert("extractionProgress".into(), json!(0));
    d
}

/// withInsertedId
pub fn with_inserted_id(ids: &[String], id: &str, target: Option<usize>) -> Vec<String> {
    let mut next: Vec<String> = ids.iter().filter(|e| *e != id).cloned().collect();
    let index = target.unwrap_or(next.len()).min(next.len());
    next.insert(index, id.to_string());
    next
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Layout {
    pub queue_order: Vec<String>,
    pub paused_order: Vec<String>,
}

impl Layout {
    fn to_json(&self) -> Value {
        json!({ "version": 1, "queueOrder": self.queue_order, "pausedOrder": self.paused_order })
    }
}

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// getDownloadLayoutStateRecord
pub fn record(db: &Db) -> Layout {
    let value: Option<Value> = db.get_in(keys::DOWNLOAD_LAYOUT_STATE, LAYOUT_KEY);
    match value {
        Some(v) => Layout {
            queue_order: strings(v.get("queueOrder")),
            paused_order: strings(v.get("pausedOrder")),
        },
        None => Layout::default(),
    }
}

pub fn save(db: &Db, layout: &Layout) {
    if let Err(error) = db.put_in(keys::DOWNLOAD_LAYOUT_STATE, LAYOUT_KEY, &layout.to_json()) {
        eprintln!("[Downloads] Could not save the download layout: {error}");
    }
}

fn timestamp(d: &Download) -> f64 {
    d.get("timestamp").and_then(Value::as_f64).unwrap_or(0.0)
}

/// mergeIdsWithFallback: the preferred order first, the rest by timestamp.
fn merge_ids(downloads: &[&Download], preferred: &[String]) -> Vec<String> {
    let mut candidates: HashSet<String> = downloads.iter().map(|d| id(d)).collect();
    let mut ordered = Vec::new();
    let mut seen = HashSet::new();
    for entry in preferred {
        if seen.insert(entry.clone()) && candidates.remove(entry) {
            ordered.push(entry.clone());
        }
    }
    let mut by_time: Vec<&&Download> = downloads.iter().collect();
    by_time.sort_by(|a, b| {
        timestamp(a)
            .partial_cmp(&timestamp(b))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    for d in by_time {
        let entry = id(d);
        if candidates.remove(&entry) {
            ordered.push(entry);
        }
    }
    ordered
}

fn queue_members(downloads: &[Download]) -> Vec<&Download> {
    downloads
        .iter()
        .filter(|d| is_queued(d) && !is_active_like(d) && !is_completed_like(d))
        .collect()
}

fn paused_members(downloads: &[Download]) -> Vec<&Download> {
    downloads
        .iter()
        .filter(|d| is_paused(d) && !is_active_like(d) && !is_completed_like(d))
        .collect()
}

/// normalizeDownloadLayoutState
pub fn normalize(downloads: &[Download], layout: &Layout) -> Layout {
    Layout {
        queue_order: merge_ids(&queue_members(downloads), &layout.queue_order),
        paused_order: merge_ids(&paused_members(downloads), &layout.paused_order),
    }
}

pub fn normalized(db: &Db, downloads: &[Download]) -> Layout {
    normalize(downloads, &record(db))
}

/// syncDownloadLayoutState
pub fn sync(db: &Db, downloads: &[Download]) -> Layout {
    let layout = normalized(db, downloads);
    save(db, &layout);
    layout
}

/// getQueuedDownloadsOrderedByLayout
pub fn queued_in_order(downloads: &[Download], layout: &Layout) -> Vec<Download> {
    let members = queue_members(downloads);
    merge_ids(&members, &layout.queue_order)
        .iter()
        .filter_map(|entry| {
            members
                .iter()
                .find(|d| id(d) == *entry)
                .map(|d| (*d).clone())
        })
        .collect()
}

/// getPausedDownloadsOrderedByLayout
pub fn paused_in_order(downloads: &[Download], layout: &Layout) -> Vec<Download> {
    let members = paused_members(downloads);
    merge_ids(&members, &layout.paused_order)
        .iter()
        .filter_map(|entry| {
            members
                .iter()
                .find(|d| id(d) == *entry)
                .map(|d| (*d).clone())
        })
        .collect()
}

/// getNextQueuedDownloadFromLayout
pub fn next_queued(downloads: &[Download], layout: &Layout) -> Option<Download> {
    queued_in_order(downloads, layout).into_iter().next()
}

/// removeDownloadFromLayoutState
pub fn remove(db: &Db, download_id: &str, downloads: &[Download]) -> Layout {
    let layout = normalized(db, downloads);
    let next = Layout {
        queue_order: layout
            .queue_order
            .into_iter()
            .filter(|e| e != download_id)
            .collect(),
        paused_order: layout
            .paused_order
            .into_iter()
            .filter(|e| e != download_id)
            .collect(),
    };
    save(db, &next);
    next
}

/// setDownloadLayoutQueues
pub fn set_queues(
    db: &Db,
    downloads: &[Download],
    queue_order: Vec<String>,
    paused_order: Vec<String>,
) -> Layout {
    let visible: HashSet<String> = downloads.iter().map(id).collect();
    let next = normalize(
        downloads,
        &Layout {
            queue_order: queue_order
                .into_iter()
                .filter(|e| visible.contains(e))
                .collect(),
            paused_order: paused_order
                .into_iter()
                .filter(|e| visible.contains(e))
                .collect(),
        },
    );
    save(db, &next);
    next
}

/// downloadsSublevel.values().all()
pub fn all(db: &Db) -> Vec<Download> {
    db.values::<Value>(keys::DOWNLOADS)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| match v {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .collect()
}

pub fn get(db: &Db, download_id: &str) -> Option<Download> {
    match db.get_in::<Value>(keys::DOWNLOADS, download_id) {
        Some(Value::Object(map)) => Some(map),
        _ => None,
    }
}

pub fn put(db: &Db, download: &Download) {
    if let Err(error) = db.put_in(
        keys::DOWNLOADS,
        &id(download),
        &Value::Object(download.clone()),
    ) {
        eprintln!("[Downloads] Could not save {}: {error}", id(download));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn download(object_id: &str, status: &str, queued: bool, timestamp: f64) -> Download {
        json!({ "shop": "steam", "objectId": object_id, "status": status, "queued": queued, "timestamp": timestamp })
            .as_object()
            .unwrap()
            .clone()
    }

    #[test]
    fn layout_orders() {
        let downloads = vec![
            download("1", "paused", true, 3.0),
            download("2", "paused", true, 1.0),
            download("3", "paused", false, 2.0),
            download("4", "active", false, 0.0),
            download("5", "complete", false, 0.0),
        ];
        let layout = normalize(
            &downloads,
            &Layout {
                queue_order: vec!["steam:1".into()],
                paused_order: vec![],
            },
        );
        assert_eq!(layout.queue_order, vec!["steam:1", "steam:2"]);
        assert_eq!(layout.paused_order, vec!["steam:3"]);
        assert_eq!(
            next_queued(&downloads, &layout).map(|d| id(&d)),
            Some("steam:1".into())
        );
        assert_eq!(
            with_inserted_id(&["a".into(), "b".into()], "c", Some(0)),
            vec!["c", "a", "b"]
        );
    }
}
