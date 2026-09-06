# Proposal: optional per-game shader cache

Status: proposal only — no code changes in this PR.

## Motivation

Unreal Engine titles (e.g. Ready or Not, Steam AppId 1144200) spend
5–20 minutes on a black screen at first launch under Proton while the
VKD3D/DXVK pipeline library compiles hundreds of PSOs. On slower disks
(HDD) and older GPUs (tested: NVIDIA GTX 1650, driver 610.57,
UMU-Proton-10.0-4) the game looks hung: the window stops pumping
messages, the desktop offers "Wait / Force Quit", but the process is
healthy (99% CPU, growing `steam-1144200.log`, swapchain already
created). Users force-quit a working game.

## Proposal

Add an **opt-in, per-game** shader cache feature:

1. A per-game toggle such as "Pre-compile / reuse shader cache".
2. When enabled, Hydra preserves and reuses the existing caches
   (DXVK state cache, VKD3D pipeline library, NVIDIA GL disk cache)
   inside the game's Wine prefix across launches, and optionally
   fetches a community-provided cache at install time to skip the
   first-boot compilation.
3. Default stays **off** / current behavior unchanged.

## Scope options (to be decided by maintainers)

- **Minimal:** only guarantee cache persistence + document the
  first-launch wait; add env knobs per game
  (`DXVK_STATE_CACHE_PATH`, `VKD3D_SHADER_CACHE_PATH`,
  `__GL_SHADER_DISK_CACHE_PATH`) without downloads.
- **Full:** allow attaching a downloadable cache artifact per game
  version, verified by checksum.

## Concerns to resolve before implementing

- Cache invalidation on game/driver/Proton updates (stale cache must
  never break launches; fall back to fresh compile).
- Disk usage on large libraries; caches must be per-game and
  removable via existing prefix cleanup.
- Trust: third-party caches are binary blobs — require checksums and
  opt-in consent; never auto-download.
- No change to launch-command semantics (see #2766 for the
  `VAR=VAL` vs `%command%` fix this builds on).

## Acceptance for this proposal PR

Agreement on minimal vs full scope and on where the toggle should
live (game settings). Implementation PRs to follow separately.
