use super::{BackendResult, Context, PlatformStatus, StartOptions};
use std::sync::Arc;

pub struct Runtime;

impl Runtime {
    pub fn stop(self) {}
}

pub fn probe(_options: StartOptions) -> PlatformStatus {
    PlatformStatus {
        keyboard: BackendResult::unavailable("unsupported-platform"),
        gamepad: BackendResult::unavailable("unsupported-platform"),
        wayland_session: false,
    }
}

pub fn start(_context: Arc<Context>, options: StartOptions) -> (Runtime, PlatformStatus) {
    (Runtime, probe(options))
}
