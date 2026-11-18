//! screenshots/local-screenshot-store.ts: the `screenshots` sublevel with an
//! in-memory copy. Writes are serialized; `on_change` runs after each one
//! (the app debounces it into on-local-screenshots-change).

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use hydra_db::{Db, keys};
use serde_json::Value;

use super::local::{LocalScreenshot, state};

#[derive(Default)]
struct Records {
    loaded: Option<HashMap<String, LocalScreenshot>>,
    /// deletedClientIds: updates after a delete are dropped
    deleted: HashSet<String>,
}

type Listener = Box<dyn Fn() + Send + Sync>;

pub struct LocalScreenshotStore {
    db: Arc<Db>,
    records: Mutex<Records>,
    listener: Mutex<Option<Listener>>,
}

impl LocalScreenshotStore {
    pub fn new(db: Arc<Db>) -> Self {
        LocalScreenshotStore {
            db,
            records: Mutex::new(Records::default()),
            listener: Mutex::new(None),
        }
    }

    /// LocalScreenshotStore.onChange (one listener: the app's broadcaster).
    pub fn set_on_change(&self, listener: impl Fn() + Send + Sync + 'static) {
        *self.listener.lock().unwrap_or_else(|e| e.into_inner()) = Some(Box::new(listener));
    }

    fn notify(&self) {
        if let Some(listener) = self
            .listener
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            listener();
        }
    }

    fn with_records<T>(
        &self,
        run: impl FnOnce(&mut HashMap<String, LocalScreenshot>, &mut HashSet<String>) -> T,
    ) -> T {
        let mut records = self.records.lock().unwrap_or_else(|e| e.into_inner());
        let Records { loaded, deleted } = &mut *records;
        let map = loaded.get_or_insert_with(|| {
            self.db
                .entries::<Value>(keys::SCREENSHOTS)
                .unwrap_or_default()
                .into_iter()
                .filter_map(|(key, value)| {
                    serde_json::from_value::<LocalScreenshot>(value)
                        .ok()
                        .map(|screenshot| (key, screenshot))
                })
                .collect()
        });
        run(map, deleted)
    }

    /// list(): everything but tombstones, newest first.
    pub fn list(&self) -> Vec<LocalScreenshot> {
        let mut screenshots: Vec<LocalScreenshot> = self.with_records(|map, _| {
            map.values()
                .filter(|s| s.state != state::DELETED)
                .cloned()
                .collect()
        });
        screenshots.sort_by(|a, b| b.captured_at.cmp(&a.captured_at));
        screenshots
    }

    pub fn list_including_deleted(&self) -> Vec<LocalScreenshot> {
        self.with_records(|map, _| map.values().cloned().collect())
    }

    pub fn list_for_game(&self, shop: &str, object_id: &str) -> Vec<LocalScreenshot> {
        self.list()
            .into_iter()
            .filter(|s| s.matches_game(shop, object_id))
            .collect()
    }

    pub fn get(&self, client_id: &str) -> Option<LocalScreenshot> {
        self.with_records(|map, _| map.get(client_id).cloned())
    }

    pub fn put(&self, screenshot: LocalScreenshot) -> Result<LocalScreenshot, String> {
        self.with_records(|map, deleted| {
            deleted.remove(&screenshot.client_id);
            self.db
                .put_in(keys::SCREENSHOTS, &screenshot.client_id, &screenshot)
                .map_err(|e| e.to_string())?;
            map.insert(screenshot.client_id.clone(), screenshot.clone());
            Ok::<_, String>(())
        })?;
        self.notify();
        Ok(screenshot)
    }

    /// update(clientId, changes): `change` edits the record and says whether
    /// it changed anything. None when the record is gone.
    pub fn update(
        &self,
        client_id: &str,
        change: impl FnOnce(&mut LocalScreenshot) -> bool,
    ) -> Option<LocalScreenshot> {
        let (updated, changed) = self.with_records(|map, deleted| {
            if deleted.contains(client_id) {
                return (None, false);
            }
            let Some(current) = map.get(client_id).cloned() else {
                return (None, false);
            };
            let mut next = current.clone();
            if !change(&mut next) || next == current {
                return (Some(current), false);
            }
            next.client_id = client_id.to_string();
            if let Err(error) = self.db.put_in(keys::SCREENSHOTS, client_id, &next) {
                eprintln!("screenshots: failed to save {client_id}: {error}");
                return (Some(current), false);
            }
            map.insert(client_id.to_string(), next.clone());
            (Some(next), true)
        });
        if changed {
            self.notify();
        }
        updated
    }

    pub fn delete(&self, client_id: &str) {
        self.with_records(|map, deleted| {
            deleted.insert(client_id.to_string());
            let _ = self.db.delete_in(keys::SCREENSHOTS, client_id);
            map.remove(client_id);
        });
        self.notify();
    }

    /// findByScreenshotId (also matches an upload waiting for /complete)
    pub fn find_by_screenshot_id(&self, screenshot_id: &str) -> Option<LocalScreenshot> {
        self.with_records(|map, _| {
            map.values()
                .find(|s| {
                    s.screenshot_id.as_deref() == Some(screenshot_id)
                        || s.pending_complete_screenshot_id.as_deref() == Some(screenshot_id)
                })
                .cloned()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn shot(id: &str, at: i64) -> LocalScreenshot {
        LocalScreenshot {
            client_id: id.into(),
            shop: "steam".into(),
            object_id: Some("1".into()),
            state: "local".into(),
            captured_at: at,
            visibility: "PUBLIC".into(),
            ..Default::default()
        }
    }

    #[test]
    fn stores_updates_and_deletes() {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(Db::open(dir.path()).unwrap());
        let store = LocalScreenshotStore::new(db.clone());
        let changes = Arc::new(AtomicUsize::new(0));
        let counter = changes.clone();
        store.set_on_change(move || {
            counter.fetch_add(1, Ordering::SeqCst);
        });

        store.put(shot("a", 1)).unwrap();
        store.put(shot("b", 2)).unwrap();
        assert_eq!(
            store
                .list()
                .iter()
                .map(|s| s.client_id.as_str())
                .collect::<Vec<_>>(),
            vec!["b", "a"]
        );
        let updated = store.update("a", |s| {
            s.state = "queued".into();
            true
        });
        assert_eq!(updated.unwrap().state, "queued");
        // a no-op update doesn't write or notify
        store.update("a", |_| false);
        assert_eq!(changes.load(Ordering::SeqCst), 3);

        // a fresh store reads what was written
        let reopened = LocalScreenshotStore::new(db);
        assert_eq!(reopened.get("a").unwrap().state, "queued");

        store.delete("a");
        assert!(store.get("a").is_none());
        assert!(store.update("a", |_| true).is_none());
        let mut tomb = shot("c", 3);
        tomb.state = "deleted".into();
        tomb.screenshot_id = Some("srv".into());
        store.put(tomb).unwrap();
        assert_eq!(store.list().len(), 1);
        assert_eq!(store.list_including_deleted().len(), 2);
        assert_eq!(store.find_by_screenshot_id("srv").unwrap().client_id, "c");
    }
}
