//! screenshots/screenshot-feature.ts: the SCREENSHOTS server flag, cached for
//! 10 minutes and kept in LevelDB (`screenshotsFeatureEnabled`) for offline
//! starts. Not the renderer's `features` cache: the main process has its own.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use hydra_core::api::Options;
use hydra_db::keys;
use serde_json::Value;

use super::Service;

const FEATURE: &str = "SCREENSHOTS";
const CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

struct Cached {
    enabled: bool,
    /// None: a fallback value that is always stale (fetchedAt = -Infinity)
    fetched_at: Option<Instant>,
}

static CACHE: Mutex<Option<Cached>> = Mutex::new(None);
/// inFlight: one request at a time; others wait for its answer.
static REFRESHING: Mutex<()> = Mutex::new(());

fn set_cached(enabled: bool, fetched_at: Option<Instant>) {
    let changed = {
        let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        let changed = cache.as_ref().is_some_and(|c| c.enabled != enabled);
        *cache = Some(Cached {
            enabled,
            fetched_at,
        });
        changed
    };
    if changed {
        // onScreenshotsFeatureChange
        super::input::apply_feature_flag(enabled);
    }
}

fn persisted(service: &Service) -> bool {
    service
        .db
        .get::<bool>(keys::SCREENSHOTS_FEATURE_ENABLED)
        .unwrap_or(false)
}

/// fetchFeatureFlag: GET /features (no auth, 5s).
fn fetch(service: &Service) -> bool {
    let options = Options {
        needs_auth: false,
        timeout: Some(REQUEST_TIMEOUT),
    };
    match service.api.get("/features", &[], options) {
        Ok(features) => {
            let enabled = features
                .as_array()
                .is_some_and(|items| items.iter().any(|v| v.as_str() == Some(FEATURE)));
            set_cached(enabled, Some(Instant::now()));
            let _ = service
                .db
                .put(keys::SCREENSHOTS_FEATURE_ENABLED, &Value::Bool(enabled));
            enabled
        }
        Err(error) => {
            eprintln!("Could not refresh the screenshots feature flag: {error}");
            let fallback = CACHE
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
                .map(|c| c.enabled)
                .unwrap_or_else(|| persisted(service));
            set_cached(fallback, None);
            fallback
        }
    }
}

/// refreshFeatureFlag (blocking; concurrent callers share one request).
pub fn refresh(service: &Service) -> bool {
    let started = Instant::now();
    let _guard = REFRESHING.lock().unwrap_or_else(|e| e.into_inner());
    // someone else refreshed while this call waited
    if let Some(cached) = CACHE.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        if cached.fetched_at.is_some_and(|at| at >= started) {
            return cached.enabled;
        }
    }
    fetch(service)
}

/// isScreenshotsFeatureEnabled: the cached value (refreshed in the
/// background once stale), or a blocking first fetch.
pub fn is_enabled(service: &Service) -> bool {
    let cached = CACHE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|c| (c.enabled, c.fetched_at));
    match cached {
        None => refresh(service),
        Some((enabled, fetched_at)) => {
            if fetched_at.is_none_or(|at| at.elapsed() >= CACHE_TTL) {
                if let Some(service) = super::service() {
                    std::thread::spawn(move || {
                        refresh(&service);
                    });
                }
            }
            enabled
        }
    }
}
