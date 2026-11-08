# Parity plan

The checklist for reaching feature parity with the Electron app. Work top to
bottom: each phase depends on the ones before it. Tick items in the PR that
finishes them.

**Source of truth:** the Electron code in this repo.

| Electron | What's there |
|---|---|
| `src/renderer/src/pages/*` | Screens (19 pages) |
| `src/renderer/src/components/*` | Shared components (modals, cards, sidebar, header, toasts, …) |
| `src/main/events/<area>/*` | Every IPC call the UI makes, one file each; the closest thing to an API spec |
| `src/main/services/*` | Background work: downloads, process watcher, achievements, cloud sync, SSE, … |
| `src/main/level/sublevels/*` | Local database layout (LevelDB, JSON values) |
| `src/locales/*/translation.json` | UI strings, 36 locales |
| `native/hydra-native` | Rust already in production: cloud save, torrent FFI, archive extraction, window/process helpers |
| `native/torrent-bridge` | libtorrent C++ bridge used by the torrent FFI |

## How to validate an item

An item is done when all of these hold:

1. **Behavior matches Electron** for the same input: same states, same
   empty/error/loading states, same keyboard shortcuts.
2. **Looks the same** in a headless screenshot (`HYDRA_HEADLESS=1`, see the
   README) compared with Electron at 1440×900. Durations and easings are
   copied from the SCSS/TSX.
3. **Tested:** pure logic has unit tests; stateful UI (focus, modals,
   editors, lists) has a headless test in `crates/hydra-desktop/tests`.
4. **No regression in memory:** `footprint <pid>` after exercising the
   screen; images decoded at display size and released off-screen.
5. **Strings are translated** once i18n exists (phase 1). Until then, new
   English strings must be the exact `en` values from `translation.json`.
6. Buttons without a backend print `TODO(area)` and are listed here.

## Phase 0: proof of concept (done)

- [x] Game details page layout, skeleton, responsive breakpoints
- [x] Hero: artwork, logo, frosted panel, slide-in buttons, cloud widget states
- [x] Hero panel states: not in library (Add to library / Open download options), in library without executable (Download), Play / Playing now / Close, favorite, pin
- [x] Gallery carousel (drag, flick, snap, preview strip) and viewer (crossfade, filmstrip, fullscreen, keyboard)
- [x] Video player UI and real playback (HLS, seek, quality, volume, auto-hide controls)
- [x] Description from Steam HTML, collapse/expand
- [x] Sidebar: controller support (full/partial), requirements, languages; achievements / stats / HowLongToBeat sections exist and stay hidden until they have data
- [x] Reviews UI: editor with B/I/U, star rating, sort, list, votes animation, empty and loading states
- [x] Modal system (backdrop blur, enter/exit, Esc, focus)
- [x] Steam `appdetails` client and Hydra API artwork
- [x] Chromium-like scrolling
- [x] Headless platform, scripted input, headless UI tests

## Phase 1: foundations

Nothing in later phases works without these.

Scope set on 2026-11-08: no Big Picture (its title-bar button is hidden), no
themes or theme editor. The UI follows `main` after #3095: one 40px title
bar, no bottom panel.

- [x] **App shell, main parts:** 40px title bar (`components/app-title-bar`: brand, version, back/forward, search field, Windows caption buttons / Linux window controls), sidebar (`components/sidebar`: profile, menu with the animated Downloads icon, virtualized library list with lazy icons and Steam/Epic badges, playable-only toggle, resize handle, persisted width)
- [ ] **App shell, still open:** search dropdown (`search-dropdown`, history, suggestions), sidebar profile dropdown, sidebar filter menu (`sidebar-filter-menu`), game context menu, version changelog (WorkWonders widget: web-only, see below), Windows 11 snap layouts on the maximize button, window drag/resize edge cases
- [x] **Navigation:** react-router-like history (push, back, forward), routes parsed from paths like `/game/steam/1091500?title=…`
- [ ] **Navigation, still open:** scroll restoration per entry, `onNavigate` from the main process
- [x] **i18n:** decided: Rust-side lookup (`crates/hydra-i18n`) over `src/locales/*/translation.json` with i18next 23 semantics, exposed to Slint as `T.tr / tr-with / tr-count`; date-fns `formatDistance`/`format` wording exported from date-fns' own locales
- [ ] **i18n, still open:** replace the remaining English literals in `ui/pages/game-details`, RTL layout (`ar`, `fa`)
- [x] **Local data:** `crates/hydra-db` reads/writes the Electron LevelDB layout; first run copies the Electron database and `localStorage` (never writes Electron's)
- [ ] **User preferences:** `user-preferences/*` (language, downloads path, debrid tokens, behavior toggles)
- [x] **Hydra API client:** `crates/hydra-core/src/api.rs` (same headers, refresh, 401 sign-out); blocking on worker threads for now
- [ ] **Hydra API, still open:** SSE (`services/sse`), tokio
- [ ] **Auth:** `auth/*` (auth window flow via an on-demand OS webview, session, sign out), deep links `hydralauncher://` (`src/main/index.ts`)
- [ ] **Single instance**, logging (`services/logger.ts`), crash-safe shutdown (`quit-cleanup.ts`; exit already drops media threads and HTTP clients first)
- [ ] **Toasts** (`components/toast`), **context menus** (`components/context-menu`, `game-context-menu`), **dropdowns/selects/checkboxes/text fields** as reusable Slint components
- [ ] **Shared crate with `native/hydra-native`:** move reusable modules (cloud_save, torrent FFI, extraction, window/process helpers) into a crate both builds use, instead of copying

Web-only pieces of the Electron renderer that have no native equivalent and
need a decision: the WorkWonders changelog/feedback/help-center widgets
(`app.tsx`, opened from the version badge and `data-open-article` links) and
the remote `external-resources/bundle.js` script.

## Phase 2: browsing

- [ ] **Home** (`pages/home`)
- [ ] **Catalogue** (`pages/catalogue`, `catalogue/*` events: filters, names, random game, covers)
- [x] **Game details, done so far:** layout from #3095 (gutters, rail, column, 16:9 gallery), library state in the hero (played time, last played, favorite, pinned, Download/Play/Close), Steam details and artwork from the local caches first, achievements section (remote unlocks, combined Steam/Epic sets), review prompt banner
- [ ] **Game details, remaining:** Cloud save widget (cloud save v2), stats, HowLongToBeat, similar games; review list/vote/submit/delete/translate/replies (`review-thread.tsx`, `review-replies`, `review-reply-composer.tsx`), review gate notice and prompt banner; leaderboard section (`game-details/leaderboard`); screenshots tab (`game-screenshots`); NSFW/content descriptor gate; randomizer; custom games and Epic/classics variants; text selection in description and reviews
- [ ] **Library** (`pages/library`, `library/*` events: favorites, pin, collections, visibility, artwork selection, custom games, shortcuts)
- [ ] **Game options modal** (`game-details/modals`): executable, launch options, Wine/Proton prefix, shortcuts, remove/uninstall, reset playtime/achievements, assets
- [ ] **Animated description images** (Steam serves animated AVIF; today only the first frame shows)

## Phase 3: downloads

- [ ] **Download sources** (`download-sources/*`, `services/download-sources-checker.ts`), repacks modal
- [ ] **Downloads page** (`pages/downloads`) and queue (`torrenting/*`: start, pause, resume, cancel, queue order, seeding)
- [ ] **Torrent engine** through the existing libtorrent bridge (`native/torrent-bridge`, `native/hydra-native/src/torrent`)
- [ ] **HTTP/debrid hosters** (`services/hosters`, Real-Debrid, AllDebrid, Premiumize, TorBox auth in `user-preferences/*`)
- [ ] **Extraction** (`services/archive-extraction.ts`, `in_place_extraction.rs`), disk space checks (`hardware/*`)
- [ ] **Common redistributables** (`services/common-redist-manager.ts`)

## Phase 4: playing

- [ ] **Launching games** (`library/open-game*`, `close-game`, `services/process-watcher.ts`, playtime tracking, running state in the hero)
- [ ] **Wine/Proton/umu on Linux** (`services/wine.ts`, `umu*.ts`, gamemode, mangohud, winetricks)
- [ ] **macOS game launching:** Wine must stay free (no paid CrossOver). Bridges to Steam (`lsteamclient`) are deferred
- [ ] **Achievements:** watcher, unlock notifications (achievement notification window), achievements page (`pages/achievements`), souvenirs/screenshots
- [ ] **Cloud save v2** (`cloud-save/*`, reuse `native/hydra-native/src/cloud_save`), cloud widget and modals in the game page
- [ ] **Screenshots** (`screenshots/*`, `services/screenshot*.ts`, capture input)
- [ ] **Game launcher window** (`pages/game-launcher`)

## Phase 5: social

- [ ] **Profile** (`pages/profile`, `profile/*`, image crop)
- [ ] **Friends window** (`pages/friends-window`, `friends/*`)
- [ ] **Chat window** (`pages/chat-window`, `chat/*`, attachments)
- [ ] **Notifications** (`pages/notifications`, `notifications/*`, unread badges)
- [ ] **Leaderboards** (`pages/leaderboards`)
- [ ] **Steam integration:** sync, OAuth, shortcuts (`user/*steam*`, `services/steam-integration`)

## Phase 6: the rest

- [ ] **Settings** (`pages/settings`), every tab
- [ ] **Themes** and theme editor (`pages/theme-editor`, `themes/*`). CSS themes don't map to Slint; decide what a theme can change (colors, sounds) and convert
- [ ] **Emulators, RetroArch, classics import, memory cards** (`emulators/*`, `retroarch/*`)
- [ ] **Shop** (`pages/shop`: profile frames; mock catalog in Electron too until the shop API exists)
- [ ] **Recompilation** (`pages/recompilation`, `recompilation/*`)
- [ ] **RetroAchievements** (`pages/retroachievements-connection-window`)
- [ ] **Epic / Legendary** (`epic/*`, `services/legendary.ts`)
- [ ] **Big Picture** (`big-picture/*`)
- [ ] **Decky plugin** install (`misc/install-hydra-decky-plugin`)
- [ ] **Auto-update** (`autoupdater/*`)

## Packaging

- [ ] Bundle FFmpeg and dav1d (or link statically) on every platform; today they come from Homebrew
- [ ] macOS: signing, notarization, entitlements (`build/entitlements.mac.plist`), DMG
- [ ] Windows: installer (`build/installer.nsh` today), D3D11VA decode verified
- [ ] Linux: AppImage/Flatpak, VAAPI decode verified
- [ ] CI: `cargo build`, `cargo test`, `cargo clippy` on all three platforms; nothing in `.github/workflows` builds `rewrite/` yet
- [ ] Memory comparison with Electron on the same machine and scenario
