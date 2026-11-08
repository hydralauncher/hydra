# Working on the rewrite in parallel

Several agents port Electron features to `rewrite/` at the same time, each in
its own git worktree and branch. A coordinator merges the branches into
`feature/rust-slint-rewrite`. Read this file, `rewrite/docs/parity-plan.md` and
`rewrite/docs/decisions.md` before you start.

## Hard rules

- **The account password is never written to any file, commit, log or memory.**
  It is only ever typed into a login form, and you should not need it.
- **Never write Electron's data.** That includes `%APPDATA%\hydralauncher` and
  `C:\Users\helio\hydra-ref-data` (the reference app's data). Never write
  `C:\Users\helio\hydra-native-test` either (the user's own Rust data). Use only
  the data copy assigned to you (`C:\Users\helio\hydra-native-agentN`).
- The production API is in use with the user's real account. Reads are fine.
  Do not do anything that affects other people or can't be undone:
  - Don't send chat messages or friend requests.
  - Don't accept, refuse or remove friends, and don't block users.
  - Don't clear all notifications, delete reviews you didn't post, or delete
    the account.
  - Writes that only touch the user's own state and that you undo right away
    are fine (for example, posting a review and then deleting it).
- Don't push. Don't touch other branches. Commit to your own worktree branch
  only. Never use bare `git stash` (the stash is shared between worktrees).
- Never kill processes you didn't start. That means no `taskkill /IM`, no
  `Stop-Process -Name electron`, no `hydra.exe` by name. Kill by the PID you
  launched.
- Don't edit `rewrite/docs/parity-plan.md`. Put the lines you want added in
  your final report and the coordinator will merge them.
- Don't use `--no-verify`. The pre-commit hook runs prettier over the repo,
  which takes about 30s and prints a lot.

## Parity bar

- Match Electron's UI from current `main` (#3095). Check layout, spacing,
  colors, fonts, cursors, hover states and image rendering against the
  Electron reference with pixel measurements.
- Keep every animation and transition. If one can't be reproduced, say so in
  your report and give the exact reason.
- Make the same API calls Electron makes (paths, params, methods).
- Click through every screen you build: hover, open menus, and check empty,
  loading and error states.
- Performance first. Virtualize or lazily load long lists and images, and
  never block the UI thread on network or disk.
- Out of scope: Big Picture, themes and the theme editor, unmerged branches.

## Layout of the code

- `crates/hydra-core`: main-process logic (API client, library, achievements,
  realtime socket). Unit-test it.
- `crates/hydra-desktop`: the app. `src/*.rs` are page and service modules;
  `ui/` is Slint (`app.slint` holds the window and routes, `globals.slint` the
  shared globals, `theme.slint` the tokens and icons, `ui/pages/<page>/`).
- `crates/hydra-db` (LevelDB, same keys as Electron), `hydra-i18n` (the same
  locale files with i18next semantics, `T.tr("ns.key")` in Slint),
  `hydra-media` (image loader with a disk cache, video), `hydra-launch`,
  `hydra-downloads`, `hydra-store` (HTTP, Steam).
- Icons come from `tools/export-icons.mjs`: add octicons there, then run
  `node tools/export-icons.mjs`.

Keep your work in new files where you can. For the shared files (`ui/app.slint`
routes, imports and exports; `src/main.rs` `mod` and `init` lines; `src/nav.rs`
route hooks; `ui/globals.slint`; `tools/export-icons.mjs`), make small,
additive edits so merges stay easy.

## Building and running

From your worktree's `rewrite/` folder, in PowerShell:

```powershell
. tools/env-windows.ps1
$env:CARGO_BUILD_JOBS = "8"   # other agents build at the same time
cargo build -p hydra-desktop
cargo test -p hydra-core
cargo fmt --all
```

The first build in a new worktree takes a while (FFmpeg, libtorrent, Slint).

Take headless screenshots with your data copy:

```powershell
powershell -File tools/shot-headless.ps1 -Data C:\Users\helio\hydra-native-agentN `
  -Out <your scratch folder>\shots\x -AppPath "/library" -Script "wait 7000; shot top; quit"
```

The dev script steps are documented in `crates/hydra-desktop/src/devscript.rs`.
Read the PNGs to check them. The headless renderer ignores
`transform-scale`/`transform-rotation`, so hover scaling and rotated chevrons
don't show in these shots.

The Electron reference app (logged in, port 9334) is shared by every agent.
Drive it only through `tools/electron-ref.ps1`, which holds a lock. Its window
is usually covered:
- Finish animations before a shot (see the script header).
- Use JS (`eval`) to focus inputs or open Radix menus, because clicks don't
  reach a covered window.

## Slint gotchas (learned the hard way)

- Names that collide with builtins: `row`, `col`, `fill`, `text`, `end`,
  `color`, `cover`. Rename them, or write `MouseCursor.text` /
  `LayoutAlignment.end`.
- An element with an explicit width but no `x` is centered in its parent.
  Set `x: 0`.
- Inside a `for` or `if`, `parent` is the outer parent. Use ids, or root
  properties.
- You can't set both `width` and `min-width`/`max-width` on the same element.
- Word-wrapping Text has a small preferred width. Use a hidden measuring Text
  for max-content.
- Hit-testing stays inside parent bounds, so popups and menus that extend
  outside a container go at host level (see `Popup` in `globals.slint` and
  `src/popup.rs`).
- Radix menus are modal unless `modal={false}`: an outside press only closes
  them. See the sidebar filter menu.
- Electron bundles Noto Sans at 400/500/700 only, so SCSS 600 renders as 700.
  Chromium line boxes: 14px text is 19px tall, `<small>` is 11.67px, and
  buttons and inputs are 13.33px.
- Layouts don't reserve CSS borders. Add the border width to the padding.
- `changed <prop> =>` handlers work. Use `animation-tick()` only behind a
  bool plus a `Timer`.
- Scrolling: use the `SmoothScroll`/`ScrollTween` pattern from
  `ui/pages/notifications/page.slint` (Chromium-like wheel tween, 100px per
  notch on Windows) and the `ScrollBar` with `shown-offset`.
- Flickable `viewport-*` properties are deprecated; use `content-*`.

## Rust gotchas

- Run blocking work (HTTP, disk) on worker threads, then come back with
  `slint::invoke_from_event_loop`.
- `shell::api()`, `shell::db()`, `shell::loader()`, `shell::tr()` and
  `shell::tr_with()` are the shared handles.
- In-place model updates (`set_row_data`) keep row state and animations;
  replacing the whole model re-creates rows.
- Run `cargo fmt` before you write `node` string-replace edits on `.rs` files.
  Prefer the Edit tool.

## Committing

- Use Conventional Commits, for example `feat(rewrite): profile page`.
- The body says what changed and why, in plain English.
- End every message with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014J6EZ3zvaatRWLjArUUeZb
```

- Commit in reviewable steps. Don't push.

## Final report

Write it in plain English. Include:
- Your branch name and commit list.
- What you ported, file by file.
- What you verified: screens, interactions, API calls, tests.
- What is left.
- Every animation or visual exception, with the reason.
- The lines to add to `parity-plan.md`.
- Any change you made to shared files that the coordinator should know about
  when merging.
