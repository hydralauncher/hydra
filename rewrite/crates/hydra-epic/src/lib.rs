//! The Epic Games integration, ported from `src/main/services/epic` and
//! `src/main/services/legendary.ts`.
//!
//! Electron runs the pinned Legendary 0.21.1 release that it bundles in
//! `resources/legendary` (Windows: the PyInstaller `legendary.exe` plus the
//! managed runtime, an embedded Python running `managed.py` over
//! `managed-legendary.pyz`). This crate runs the same files with the same
//! arguments and keeps the same user-data layout:
//!
//! - `epic-sessions-db/`: the Epic session store (LevelDB, JSON values),
//!   keyed by sha256(JSON [environment, userId]) like `store.ts`;
//! - `epic-temporary/operation-*`: private `LEGENDARY_CONFIG_PATH` folders for
//!   `auth --code`, `list` and `status`, removed after each run;
//! - `epic-managed/<owner>/<artifact>/` and `epic-managed-previews/`: the
//!   managed install workspaces.
//!
//! Everything here is blocking: call it from worker threads.

pub mod cancel;
pub mod error;
pub mod imports;
pub mod legendary;
pub mod library;
pub mod managed;
pub mod process;
pub mod protocol;
pub mod runner;
pub mod session;
pub mod snapshot;
pub mod sources;
pub mod store;
pub mod sync;
pub mod time;

pub use cancel::Cancel;
pub use error::EpicError;
