//! The Electron main process, ported: what `src/main` does behind IPC.
//! Each module names the files it ports.

pub mod achievement_files;
pub mod achievement_list;
pub mod achievements;
pub mod api;
pub mod chat;
pub mod chat_unread;
pub mod config;
pub mod debrid;
pub mod download_directories;
pub mod emulation;
pub mod executables;
pub mod integrations;
pub mod leaderboards;
pub mod library;
pub mod library_actions;
pub mod profile;
pub mod profile_image;
pub mod realtime;
pub mod repacks;
pub mod scan;
pub mod screenshot_prefs;
pub mod screenshots;
pub mod social;
pub mod steam_apps;
