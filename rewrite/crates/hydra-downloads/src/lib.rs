//! Downloads for the Rust rewrite of Hydra (src/main/services/download).
//!
//! - [`http`]: JsHttpDownloader: one file over HTTP with retries, stall
//!   detection, resume (verified overlap, If-Range) and parallel byte ranges
//!   whose progress survives restarts ([`range_state`]).
//! - [`throttle`]: the shared speed limit.
//! - [`filename`]: Content-Disposition and URL file names.

pub mod filename;
pub mod http;
pub mod range_state;
pub mod throttle;
