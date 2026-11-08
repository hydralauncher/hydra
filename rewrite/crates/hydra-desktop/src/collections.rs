//! useGameCollections(): the user's collections (`/profile/games/collections`),
//! shared by the library page and the game context menu.

use std::cell::RefCell;

use hydra_core::api::Options;
use serde_json::Value;

use crate::shell;

#[derive(Clone, Default)]
pub struct State {
    /// (id, name)
    pub items: Vec<(String, String)>,
    pub loaded: bool,
    pub failed: bool,
    pub loading: bool,
}

type Listener = Box<dyn Fn()>;

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
    static LISTENERS: RefCell<Vec<Listener>> = const { RefCell::new(Vec::new()) };
}

pub fn get() -> State {
    STATE.with(|s| s.borrow().clone())
}

/// Called after every load (success or failure).
pub fn subscribe(listener: impl Fn() + 'static) {
    LISTENERS.with(|l| l.borrow_mut().push(Box::new(listener)));
}

fn notify() {
    LISTENERS.with(|l| {
        for listener in l.borrow().iter() {
            listener();
        }
    });
}

/// `loadCollections()`: one request at a time.
pub fn load() {
    if !shell::signed_in() || STATE.with(|s| s.borrow().loading) {
        return;
    }
    let Some(api) = shell::api() else { return };
    STATE.with(|s| s.borrow_mut().loading = true);
    notify();
    std::thread::spawn(move || {
        let result = api.get(
            "/profile/games/collections",
            &[],
            Options {
                needs_auth: true,
                ..Default::default()
            },
        );
        let _ = slint::invoke_from_event_loop(move || {
            STATE.with(|s| {
                let mut s = s.borrow_mut();
                s.loading = false;
                match result {
                    Ok(Value::Array(items)) => {
                        s.items = items
                            .iter()
                            .filter_map(|c| {
                                Some((
                                    c.get("id")?.as_str()?.to_string(),
                                    c.get("name")?.as_str()?.to_string(),
                                ))
                            })
                            .collect();
                        s.loaded = true;
                        s.failed = false;
                    }
                    Ok(other) => {
                        eprintln!(
                            "Expected an array from /profile/games/collections, received {other}"
                        );
                        s.items.clear();
                        s.loaded = true;
                    }
                    Err(error) => {
                        eprintln!("collections: {error}");
                        s.failed = true;
                    }
                }
            });
            notify();
        });
    });
}
