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
- [ ] **App shell, still open:** search dropdown (`search-dropdown`, history, suggestions), sidebar profile dropdown, sidebar filter menu (`sidebar-filter-menu`), version changelog (WorkWonders widget: web-only, see below), Windows 11 snap layouts on the maximize button, window drag/resize edge cases
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
- [x] **Toasts** (`components/toast`), **context menus** (`components/context-menu`, `game-context-menu` on library cards and sidebar rows), Radix-style dropdowns (`Popup` global: one open menu, closes on a press outside, Escape, scroll)
- [ ] **Still open:** selects/checkboxes/text fields as reusable Slint components; keyboard focus rings (Chromium shows the accent-colored `outline: auto` on `:focus-visible`, e.g. a menu trigger after picking an item)
- [ ] **Shared crate with `native/hydra-native`:** move reusable modules (cloud_save, torrent FFI, extraction, window/process helpers) into a crate both builds use, instead of copying

Web-only pieces of the Electron renderer that have no native equivalent and
need a decision: the WorkWonders changelog/feedback/help-center widgets
(`app.tsx`, opened from the version badge and `data-open-article` links) and
the remote `external-resources/bundle.js` script.

## Phase 2: browsing

- [x] **Home** (`pages/home`): featured hero, Hot now / Top games of the week / Games to beat, card stats on hover, Surprise me (Steam250), the flame and stars GIFs
- [x] **Catalogue, modern games:** results, sort select (Chromium-style popup), pagination, filter rail (mode toggle, release year slider, genres/tags/download sources/developers/publishers sections with search and virtual lists), chips, add to library
- [ ] **Catalogue, remaining:** classics mode (`game-item-classics`, platform groups, recompilation toggle), chips wrapping, Proton/Deck section on Linux, classics/recompilation onboarding modals, the pagination jump input
- [x] **Game details, done so far:** layout from #3095 (gutters, rail, column, 16:9 gallery), library state in the hero (played time, last played, favorite, pinned, Download/Play/Close), Steam details and artwork from the local caches first, achievements section (remote unlocks, combined Steam/Epic sets), review prompt banner
- [ ] **Game details, remaining:** Cloud save widget (cloud save v2), stats, HowLongToBeat, similar games; review list/vote/submit/delete/translate/replies (`review-thread.tsx`, `review-replies`, `review-reply-composer.tsx`), review gate notice and prompt banner; leaderboard section (`game-details/leaderboard`); screenshots tab (`game-screenshots`); NSFW/content descriptor gate; randomizer; custom games and Epic/classics variants; text selection in description and reviews
- [x] **Library, done so far:** toolbar (category, Filters menu with collections/libraries/consoles/installed only, sort + view menu), compact/grid/large views virtualized like the renderer, covers from `game.images` copies with ThumbHash placeholders, frosted badges, achievement bars, empty states, header that hides on scroll, title-bar search; context menu actions for favorites, collections, pin, hide/conceal, open folder (`library_actions`)
- [ ] **Library, remaining:** create/rename/delete collection modals and the collection context menu, add custom game modal, scan games modal, classics onboarding modal, remove from library / remove files modals, shortcuts, animated covers (play on hover), `refreshLibraryAssets` on entering the page, an image disk cache like Chromium's HTTP cache
- [ ] **Game options modal** (`game-details/modals`): executable, launch options, Wine/Proton prefix, shortcuts, remove/uninstall, reset playtime/achievements, assets
- [ ] **Animated description images** (Steam serves animated AVIF; today only the first frame shows)

## Phase 3: downloads

- [ ] **Download sources** (`download-sources/*`, `services/download-sources-checker.ts`), repacks modal
- [x] **Downloads page, empty state**
- [ ] **Downloads page groups** and queue (`torrenting/*`: start, pause, resume, cancel, queue order, seeding): see the download flow above
- [x] **Torrent engine:** `crates/hydra-torrent` compiles `native/hydra-native/src/torrent` without napi (the same engine and libtorrent bridge as the Node addon)
- [ ] **Download flow, in order:** (1) repacks: `/games/{shop}/{id}/download-sources` with the stored download source ids, `filterDownloadableRepacks`, hoster availability (`game-details.context.tsx`); (2) `repacks-modal.tsx` (498 lines) and `download-settings-modal.tsx` (1611 lines: path, downloader choice, debrid states); (3) `start-game-download.ts` + `DownloadOrchestrator` (queue, layout state, pause/resume/cancel, reconnect) + `DownloadManager.watchDownloads` with the torrent path first (status packets, completion, seeding); (4) the Downloads page groups (`download-group.tsx` 1517 lines: hero view, speed chart, animated percentage, queued and completed rows, seeding toggles); (5) HTTP downloads (`js-http-downloader.ts`, parallel ranges), hosters (`services/hosters`), debrid services; (6) extraction (hatchzip in-place, 7z)
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
- [x] **Themes and the theme editor:** removed from the native client (decided 2026-11-08)
- [ ] **Emulators, RetroArch, classics import, memory cards** (`emulators/*`, `retroarch/*`)
- [ ] **Shop** (`pages/shop`: profile frames; mock catalog in Electron too until the shop API exists)
- [ ] **Recompilation** (`pages/recompilation`, `recompilation/*`)
- [ ] **RetroAchievements** (`pages/retroachievements-connection-window`)
- [ ] **Epic / Legendary** (`epic/*`, `services/legendary.ts`)
- [ ] **Big Picture** (`big-picture/*`): out of scope for now (decided 2026-11-08); its title-bar button is hidden
- [ ] **Decky plugin** install (`misc/install-hydra-decky-plugin`)
- [ ] **Auto-update** (`autoupdater/*`)

## Packaging

- [ ] Bundle FFmpeg and dav1d (or link statically) on every platform; today they come from Homebrew
- [ ] macOS: signing, notarization, entitlements (`build/entitlements.mac.plist`), DMG
- [ ] Windows: installer (`build/installer.nsh` today), D3D11VA decode verified
- [ ] Linux: AppImage/Flatpak, VAAPI decode verified
- [ ] CI: `cargo build`, `cargo test`, `cargo clippy` on all three platforms; nothing in `.github/workflows` builds `rewrite/` yet
- [ ] Memory comparison with Electron on the same machine and scenario
