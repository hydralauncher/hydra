<div align="center">

[<img src="https://raw.githubusercontent.com/hydralauncher/hydra/refs/heads/main/resources/icon.png" width="144"/>](https://github.com/abrahampo1/hydra)

  <h1 align="center">Hydra Launcher (Fork)</h1>

  <p align="center">
    <strong>A fork of <a href="https://github.com/hydralauncher/hydra">Hydra Launcher</a> with enhanced social features, dual backup system, storage management, drag-and-drop sidebar, and UI improvements.</strong>
  </p>

</div>

## About this fork

This repository is a fork of [hydralauncher/hydra](https://github.com/hydralauncher/hydra). Hydra is an open-source gaming platform built with Electron, React, TypeScript, and Python. This fork extends the base functionality with the features listed below.

## What's different from the original

### Social features

- **Activity feed on Home** — Real-time feed showing friend activity: currently playing, recently played, and recent reviews, with automatic refresh and pagination.
- **Online friends in header** — Displays up to 3 online friend avatars in the header with activity indicators and a "+N" badge for the rest. Refreshes every 60 seconds.
- **Friend hover cards** — Floating tooltip when hovering over a friend showing their profile, current game, and session duration.
- **Friend actions on profile** — Unfriend and block buttons directly from a user's profile page.

### Enhanced profile

- **Statistics tab** — Full dashboard displaying: library size, total playtime (with percentile ranking), average playtime per game, achievement completion rate, unlocked achievements, achievement points, and karma.
- **Most played games** — Top 5 games with proportional playtime bars.
- **Library controls** — Fuzzy search across the library, sorting by playtime/achievements/last played, and grid/list view toggle.
- **List view for games** — A new list-based view showing playtime, achievement progress, and pin/unpin per game.

### Dual backup system

- **Google Drive** — Save synchronization via Google Drive with OAuth2 authentication, automatic token refresh, tar compression, and metadata (hostname, platform, Wine prefix paths).
- **Local backup** — Alternative local disk backup with a configurable path and `.meta.json` metadata files.
- **Cross-platform restore** — Supports Wine/Windows path mapping for restoring backups across different operating systems.
- **Backup settings** — New "Backups" tab in Settings to choose between Hydra Cloud and local backup, with a directory picker.

### Storage management

- **Storage tab in Settings** — Disk usage visualization with a progress bar, per-game breakdown with colored segments, and a legend of the top 5 space-consuming games.
- **Selective deletion** — Option to delete only the game installer or the complete game files, with a confirmation modal showing how much space will be freed.
- **Smart protection** — Prevents deleting the installer if the game executable resides inside the installer directory.

### Sidebar improvements

- **Drag-and-drop reordering** — Reorder games in the sidebar via drag-and-drop with persistent custom ordering.
- **Now-playing section** — Dedicated section showing the currently playing game with cover art and session duration.
- **Steam import** — Import games from your Steam library directly into the sidebar.

### UI improvements

- **Redesigned game options modal** — New layout with descriptive Octicons, keyboard accessibility, and pre-calculated disabled states.
- **Bottom panel updates** — Centered seeding hover card and broadcast of empty seed status.
- **Refined styles** — SCSS refinements across catalogue, game details, profile, notifications, settings, sidebar, cloud sync modal, gallery, and more.

### Download enhancements

- **Executable selector** — Choose which executable to run after downloading.
- **Password modal** — Support for password-protected downloads.
- **Beta features tab** — New settings page for experimental features.

### Removed restrictions

- **Subscription gates removed** — Achievements and profile statistics are now freely accessible to all users without a subscription.

### Backend and types

- **New services**: `GoogleDriveService` and `LocalBackupService` as singletons in `src/main/services/`.
- **New IPC events**: 7 for Google Drive + 5 for local backup + `deleteGameInstaller`.
- **New types**: `GoogleDriveTokens`, `GoogleDriveUserInfo`, `GoogleDriveBackupArtifact`, `BackupProvider`, `DiskUsage`.
- **Extended types**: `UserPreferences` with `localBackupPath` and `backupProvider`; `UserDetails` and `UserProfile` with `karma`; `UserGame` with `isPinned` and `pinnedDate`.

## New file structure

```
src/main/events/google-drive/       # Google Drive IPC events
src/main/events/local-backup/       # Local backup IPC events
src/main/events/library/delete-game-installer.ts
src/main/helpers/restore-backup.ts  # Unified backup restore
src/main/services/google-drive.ts   # Google Drive service
src/main/services/local-backup.ts   # Local backup service

src/renderer/src/components/header/friend-hover-card.tsx
src/renderer/src/components/header/online-friends-avatars.tsx
src/renderer/src/pages/home/activity-feed.tsx
src/renderer/src/pages/profile/profile-content/friend-actions.tsx
src/renderer/src/pages/profile/profile-content/library-controls.tsx
src/renderer/src/pages/profile/profile-content/most-played-games-box.tsx
src/renderer/src/pages/profile/profile-content/stats-tab.tsx
src/renderer/src/pages/profile/profile-content/user-library-game-list-item.tsx
src/renderer/src/pages/settings/settings-backups.tsx
src/renderer/src/pages/settings/settings-beta.tsx
src/renderer/src/pages/settings/settings-storage.tsx
```

## Building from source

Refer to the original project documentation: [docs.hydralauncher.gg](https://docs.hydralauncher.gg/getting-started)

Additional requirements:

- Use **yarn**, not npm
- Node.js compatible with Electron

```bash
git clone https://github.com/abrahampo1/hydra.git
cd hydra
yarn install
yarn dev
```

## License

Hydra is licensed under the [MIT License](LICENSE).

## Credits

Original project: [hydralauncher/hydra](https://github.com/hydralauncher/hydra)
