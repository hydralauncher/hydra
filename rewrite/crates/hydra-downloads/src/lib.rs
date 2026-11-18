//! Downloads for the Rust rewrite of Hydra (src/main/services/download).
//!
//! - [`http`]: JsHttpDownloader: one file over HTTP with retries, stall
//!   detection, resume (verified overlap, If-Range) and parallel byte ranges
//!   whose progress survives restarts ([`range_state`]).
//! - [`throttle`]: the shared speed limit.
//! - [`filename`]: Content-Disposition and URL file names.
//! - [`hosters`]: direct links from file hosters' pages.
//! - [`debrid`]: Real-Debrid, AllDebrid, Premiumize and TorBox.
//! - [`errors`]: DownloadError keys and handleDownloadError.

pub mod batch;
pub mod debrid;
pub mod errors;
pub mod extraction;
pub mod filename;
pub mod hosters;
pub mod http;
pub mod layout;
pub mod manager;
pub mod range_state;
pub mod removal;
pub mod throttle;
pub mod torbox_batch;
