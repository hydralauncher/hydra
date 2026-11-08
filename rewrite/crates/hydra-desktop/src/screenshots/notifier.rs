//! screenshots/screenshot-upload-notifier.ts: uploads the user started and
//! isn't watching (the window is hidden, minimized or unfocused) get one
//! "Uploading N screenshots" OS notification, then a summary (failed or
//! uploaded) when they all settle.
//!
//! Electron closes the "uploading" notification when the batch ends; the
//! toast library here can't remove a shown toast, so it stays in the
//! notification center until dismissed.
//!
//! Also useScreenshotUploadFailureToast (app.tsx): an in-app error toast for
//! each upload that failed or was blocked by moderation.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use hydra_core::screenshots::LocalScreenshot;
use hydra_core::screenshots::local::state;
use hydra_core::screenshots::preferences::{moderation_reason_key, upload_error_key};
use hydra_i18n::Arg;

use super::Service;

struct Batch {
    owner: String,
    client_ids: HashSet<String>,
}

static BATCH: Mutex<Option<Batch>> = Mutex::new(None);
static USER_UPLOADS: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// markUserUpload
pub fn mark_user_upload(client_id: &str) {
    USER_UPLOADS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_or_insert_with(HashSet::new)
        .insert(client_id.to_string());
}

fn notify_count(title_key: &'static str, body_key: &'static str, count: usize) {
    let _ = slint::invoke_from_event_loop(move || {
        let Some(i18n) = crate::shell::i18n() else {
            return;
        };
        let title = i18n.t(&format!("screenshots_capture.{title_key}"));
        let body = i18n.t_count(
            &format!("screenshots_capture.{body_key}"),
            count as f64,
            &[("count", Arg::Number(count as f64))],
        );
        crate::notify::show_silent(title, body);
    });
}

fn is_active(state: Option<&str>) -> bool {
    matches!(state, Some(state::QUEUED | state::UPLOADING))
}

/// ScreenshotUploadNotifier.refresh (worker threads)
pub fn refresh(service: &Service) {
    let owner = service.owner_id();
    // asks the UI thread: before taking the lock
    let watched = super::is_main_window_watched();
    let mut batch = BATCH.lock().unwrap_or_else(|e| e.into_inner());
    if batch
        .as_ref()
        .is_some_and(|b| Some(&b.owner) != owner.as_ref())
    {
        // closeBatch
        *batch = None;
    }
    let Some(owner) = owner else { return };

    let screenshots = service.store.list();
    let states: HashMap<&str, &str> = screenshots
        .iter()
        .map(|s| (s.client_id.as_str(), s.state.as_str()))
        .collect();
    let mut user_uploads = USER_UPLOADS.lock().unwrap_or_else(|e| e.into_inner());
    let user_uploads = user_uploads.get_or_insert_with(HashSet::new);
    let unattended: Vec<String> = screenshots
        .iter()
        .filter(|s| {
            user_uploads.contains(&s.client_id)
                && s.owner_id.as_deref() == Some(owner.as_str())
                && s.is_active_upload()
                && !watched
        })
        .map(|s| s.client_id.clone())
        .collect();

    // pruneUserUploads
    user_uploads.retain(|id| {
        is_active(states.get(id.as_str()).copied())
            || batch.as_ref().is_some_and(|b| b.client_ids.contains(id))
    });

    let Some(current) = batch.as_mut() else {
        if !unattended.is_empty() {
            notify_count("uploading_title", "uploading_body", unattended.len());
            *batch = Some(Batch {
                owner,
                client_ids: unattended.into_iter().collect(),
            });
        }
        return;
    };
    current.client_ids.extend(unattended);

    // finishBatchIfSettled
    let settled: Vec<&str> = current
        .client_ids
        .iter()
        .map(|id| states.get(id.as_str()).copied().unwrap_or(state::DELETED))
        .collect();
    if settled.iter().any(|s| is_active(Some(s))) {
        return;
    }
    let uploaded = settled.iter().filter(|s| **s == state::UPLOADED).count();
    let failed = settled.iter().filter(|s| **s == state::FAILED).count();
    for id in &current.client_ids {
        user_uploads.remove(id);
    }
    *batch = None;
    if failed > 0 {
        notify_count("upload_failed_title", "upload_failed_body", failed);
    } else if uploaded > 0 {
        notify_count("uploaded_title", "uploaded_body", uploaded);
    }
}

// ---- useScreenshotUploadFailureToast (UI thread) ------------------------------

thread_local! {
    /// createScreenshotUploadOutcomeTracker's activeIds
    static ACTIVE_IDS: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
}

/// The tracker: screenshots that were uploading and ended failed or blocked.
fn track(screenshots: &[LocalScreenshot]) -> Vec<LocalScreenshot> {
    ACTIVE_IDS.with(|active| {
        let mut active = active.borrow_mut();
        let mut problems = Vec::new();
        for screenshot in screenshots {
            if screenshot.is_active_upload() {
                active.insert(screenshot.client_id.clone());
                continue;
            }
            let awaiting_moderation = screenshot.state == state::UPLOADED
                && matches!(
                    screenshot.moderation_status.as_deref(),
                    None | Some("PENDING")
                );
            if awaiting_moderation {
                continue;
            }
            let problem = screenshot.state == state::FAILED
                || (screenshot.state == state::UPLOADED
                    && screenshot.moderation_status.as_deref() == Some("BLOCKED"));
            if active.remove(&screenshot.client_id) && problem {
                problems.push(screenshot.clone());
            }
        }
        problems
    })
}

/// on-local-screenshots-change for the failure toast.
pub fn on_screenshots_changed(screenshots: &[LocalScreenshot]) {
    if !crate::features::enabled("SCREENSHOTS") {
        return;
    }
    let problems = track(screenshots);
    let visible = super::UI
        .with(|ui| ui.borrow().upgrade())
        .is_some_and(|ui| {
            use slint::ComponentHandle;
            ui.window().is_visible()
        });
    if !visible {
        return;
    }
    for screenshot in problems {
        let (title, message) = if screenshot.state == state::FAILED {
            (
                crate::shell::tr("screenshots_capture.upload_failed"),
                crate::shell::tr(&format!(
                    "screenshots_capture.{}",
                    upload_error_key(screenshot.last_error.as_deref())
                )),
            )
        } else {
            (
                crate::shell::tr("screenshots_capture.upload_blocked"),
                crate::shell::tr(&format!(
                    "screenshots_moderation.{}",
                    moderation_reason_key(screenshot.moderation_reason.as_deref())
                )),
            )
        };
        crate::toast::show(crate::toast::Kind::Error, &title, Some(&message));
    }
}
