//! useFeature(): server feature flags from `/features`, cached in the
//! renderer's localStorage ("features") so they apply before the request
//! returns.

use std::cell::RefCell;

use hydra_core::api::Options;
use serde_json::Value;

use crate::shell;

thread_local! {
    static FEATURES: RefCell<Option<Vec<String>>> = const { RefCell::new(None) };
    static LOADING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    /// GET /features answered this session (isFeaturesLoaded).
    static LOADED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static LISTENERS: RefCell<Vec<Box<dyn Fn()>>> = RefCell::new(Vec::new());
}

/// Whether the flags came from the API this session (`isFeaturesLoaded`).
pub fn loaded() -> bool {
    LOADED.with(|l| l.get())
}

/// Runs `f` each time the flags arrive from the API.
pub fn on_loaded(f: impl Fn() + 'static) {
    LISTENERS.with(|l| l.borrow_mut().push(Box::new(f)));
}

fn cached() -> Vec<String> {
    shell::storage_get("features")
        .and_then(|v| serde_json::from_str::<Vec<String>>(&v).ok())
        .unwrap_or_default()
}

/// Whether a flag is on (readCachedFeatures until the request returns).
pub fn enabled(name: &str) -> bool {
    FEATURES.with(|f| {
        let mut f = f.borrow_mut();
        f.get_or_insert_with(cached).iter().any(|n| n == name)
    })
}

/// GET /features, then store it like the renderer does.
pub fn load() {
    if LOADING.with(|l| l.replace(true)) {
        return;
    }
    let Some(api) = shell::api() else { return };
    std::thread::spawn(move || {
        let result = api.get("/features", &[], Options::default());
        let _ = slint::invoke_from_event_loop(move || {
            LOADING.with(|l| l.set(false));
            if let Ok(Value::Array(items)) = result {
                let names: Vec<String> = items
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect();
                shell::storage_set(
                    "features",
                    &serde_json::to_string(&names).unwrap_or_default(),
                );
                FEATURES.with(|f| *f.borrow_mut() = Some(names));
                LOADED.with(|l| l.set(true));
                LISTENERS.with(|l| l.borrow().iter().for_each(|f| f()));
            }
        });
    });
}
