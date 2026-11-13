//! screenshots/local-screenshot-removal.ts: deleting screenshots, dropping
//! records whose files were deleted outside Hydra (only when their folder,
//! same root marker, is still there), and forgetting published ones.
//! Also useMissingScreenshotsToast (app.tsx): the toast when some vanished.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;

use hydra_core::screenshots::{LocalScreenshot, local::state, paths, root_marker};
use hydra_i18n::Arg;

use super::{Service, capture::remove_preview, upload};

/// pendingMissingRemovals
static PENDING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// isOnRecordedFilesystem
fn is_on_recorded_filesystem(screenshot: &LocalScreenshot) -> bool {
    let path = Path::new(&screenshot.path);
    match &screenshot.root_marker_id {
        None => path.parent().is_some_and(Path::exists),
        Some(marker) => {
            root_marker::read_root_marker_id(&paths::screenshots_root(path)).as_deref()
                == Some(marker.as_str())
        }
    }
}

/// isFileDeleted: missing, and the folder it was saved in is still mounted.
fn is_file_deleted(screenshot: &LocalScreenshot) -> bool {
    match std::fs::metadata(&screenshot.path) {
        Ok(_) => false,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            is_on_recorded_filesystem(screenshot)
        }
        Err(_) => false,
    }
}

/// getTombstoneScreenshotId
fn tombstone_id(screenshot: &LocalScreenshot) -> Option<String> {
    if screenshot.is_published() {
        return screenshot.screenshot_id.clone();
    }
    screenshot.pending_complete_screenshot_id.clone()
}

/// removeLocalScreenshot: the file, the preview and the record (a tombstone
/// keeps the server id of what was uploaded).
fn remove(
    service: &Service,
    client_id: &str,
    should_delete: impl Fn(&LocalScreenshot) -> bool,
    telemetry_outcome: &str,
) -> bool {
    let Some(screenshot) = service.store.get(client_id) else {
        return false;
    };
    if screenshot.state == state::DELETED || !should_delete(&screenshot) {
        return false;
    }
    upload::cancel(client_id);
    let _ = std::fs::remove_file(&screenshot.path);
    remove_preview(screenshot.preview_path.as_deref());
    match tombstone_id(&screenshot) {
        Some(id) => {
            service.store.update(client_id, |current| {
                current.state = state::DELETED.into();
                current.screenshot_id = Some(id);
                current.pending_complete_screenshot_id = None;
                current.upload_progress = None;
                current.preview_path = None;
                true
            });
        }
        None => service.store.delete(client_id),
    }
    upload::cancel(client_id);
    service.record("review", telemetry_outcome, None);
    true
}

/// deleteLocalScreenshot
pub fn delete_local_screenshot(service: &Service, client_id: &str) {
    let owner = service.owner_id();
    remove(
        service,
        client_id,
        |s| s.is_visible_to(owner.as_deref()),
        "delete",
    );
}

/// removeMissingLocalScreenshot (one removal per screenshot at a time)
fn remove_missing(service: &Service, client_id: &str) -> bool {
    {
        let mut pending = PENDING.lock().unwrap_or_else(|e| e.into_inner());
        if !pending
            .get_or_insert_with(HashSet::new)
            .insert(client_id.to_string())
        {
            return false;
        }
    }
    let removed = remove(
        service,
        client_id,
        LocalScreenshot::is_unpublished_file,
        "missing_file",
    );
    if let Some(pending) = PENDING.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        pending.remove(client_id);
    }
    removed
}

/// on-local-screenshots-missing → useMissingScreenshotsToast (only while the
/// window is on screen).
fn announce_missing(count: usize) {
    if count == 0 {
        return;
    }
    let _ = slint::invoke_from_event_loop(move || {
        let visible = super::UI
            .with(|ui| ui.borrow().upgrade())
            .is_some_and(|ui| {
                use slint::ComponentHandle;
                ui.window().is_visible()
            });
        if !visible {
            return;
        }
        let Some(i18n) = crate::shell::i18n() else {
            return;
        };
        let title = i18n.t("screenshots_capture.missing_files_title");
        let body = i18n.t_count(
            "screenshots_capture.missing_files_body",
            count as f64,
            &[("count", Arg::Number(count as f64))],
        );
        crate::toast::show(crate::toast::Kind::Error, &title, Some(&body));
    });
}

/// pruneMissingLocalScreenshots
pub fn prune_missing(service: &Service, screenshots: Vec<LocalScreenshot>) -> Vec<LocalScreenshot> {
    let (present, missing): (Vec<LocalScreenshot>, Vec<LocalScreenshot>) = screenshots
        .into_iter()
        .partition(|s| !s.is_unpublished_file() || !is_file_deleted(s));
    if missing.is_empty() {
        return present;
    }
    let removed = missing
        .iter()
        .filter(|s| remove_missing(service, &s.client_id))
        .count();
    announce_missing(removed);
    present
}

/// removeLocalScreenshotIfMissing
pub fn remove_if_missing(service: &Service, client_id: &str) -> bool {
    let Some(screenshot) = service.store.get(client_id) else {
        return false;
    };
    if !screenshot.is_unpublished_file() || !is_file_deleted(&screenshot) {
        return false;
    }
    let removed = remove_missing(service, client_id);
    if removed {
        announce_missing(1);
    }
    removed
}

/// listLocalScreenshotFilesForGame
pub fn files_for_game(service: &Service, shop: &str, object_id: &str) -> Vec<LocalScreenshot> {
    let owner = service.owner_id();
    service
        .store
        .list()
        .into_iter()
        .filter(|s| s.is_visible_to(owner.as_deref()))
        .filter(|s| s.is_file_for_game(shop, object_id))
        .filter(|s| s.state != state::UPLOADED || Path::new(&s.path).exists())
        .collect()
}

/// deleteLocalScreenshotsForGame
pub fn delete_for_game(service: &Service, shop: &str, object_id: &str) -> usize {
    let owner = service.owner_id();
    files_for_game(service, shop, object_id)
        .iter()
        .filter(|s| {
            remove(
                service,
                &s.client_id,
                |current| {
                    current.is_visible_to(owner.as_deref())
                        && current.is_file_for_game(shop, object_id)
                },
                "delete",
            )
        })
        .count()
}

/// forgetPublishedScreenshot: a kept file goes back to "local" with a new
/// upload id; otherwise the record goes.
fn forget_one(service: &Service, screenshot: &LocalScreenshot) -> bool {
    let keeps_file = screenshot.state == state::UPLOADED && Path::new(&screenshot.path).exists();
    if !keeps_file {
        remove_preview(screenshot.preview_path.as_deref());
        service.store.delete(&screenshot.client_id);
        return true;
    }
    let expected = screenshot.screenshot_id.clone();
    service
        .store
        .update(&screenshot.client_id, |current| {
            if current.state != state::UPLOADED || current.screenshot_id != expected {
                return false;
            }
            // UNPUBLISHED_FIELDS
            current.state = state::LOCAL.into();
            current.screenshot_id = None;
            current.moderation_status = None;
            current.moderation_reason = None;
            current.upload_progress = None;
            current.upload_quality = None;
            current.upload_attempts = Some(0);
            current.upload_game_waits = Some(0);
            current.upload_moderation_waits = Some(0);
            current.upload_capacity_waits = Some(0);
            current.upload_rate_limit_waits = Some(0);
            current.next_upload_attempt_at = None;
            current.uploaded_at = None;
            current.last_error = None;
            current.upload_client_id = Some(uuid::Uuid::new_v4().to_string());
            true
        })
        .is_some_and(|updated| updated.state == state::LOCAL)
}

/// forgetPublishedScreenshots
pub fn forget_published(service: &Service, screenshot_ids: &[String]) -> usize {
    let ids: HashSet<&str> = screenshot_ids.iter().map(String::as_str).collect();
    if ids.is_empty() {
        return 0;
    }
    let owner = service.owner_id();
    service
        .store
        .list_including_deleted()
        .into_iter()
        .filter(|s| {
            s.screenshot_id
                .as_deref()
                .is_some_and(|id| ids.contains(id))
                && s.is_visible_to(owner.as_deref())
                && (s.state == state::UPLOADED || s.state == state::DELETED)
        })
        .filter(|s| forget_one(service, s))
        .count()
}
