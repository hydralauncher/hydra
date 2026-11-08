//! The Electron main process, ported: what `src/main` does behind IPC.
//! Each module names the files it ports.

pub mod achievements;
pub mod api;
pub mod config;
pub mod debrid;
pub mod download_directories;
pub mod emulation;
pub mod executables;
pub mod library;
pub mod library_actions;
pub mod repacks;
