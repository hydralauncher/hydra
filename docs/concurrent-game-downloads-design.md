# Concurrent game downloads

Hydra can run several game transfers at once. Downloads preferences in desktop
and Big Picture expose a global limit from **1 to 8**, defaulting to **2**.
Invalid persisted values fall back to 2.

## Scheduling and lifecycle

`DownloadOrchestrator` serializes activation through `withDownloadActivation`.
It fills available slots in persisted queue order, skipping candidates blocked
by a source constraint. Epic uses one Legendary install process, so only one
Epic transfer can run at once; it can run alongside HTTP and torrent transfers.
A failed queued start is parked as an error and the scheduler considers the
remaining queue.

`DownloadManager` owns a session per game ID. Each session has its own runtime,
preparation controller, generation, and HTTP batch state. Pause, cancel,
progress, and runtime failures operate on that session. The native torrent
bridge accepts a game ID for status polling and per-torrent speed limits.

Completion releases the transfer slot and pumps the queue. A completed torrent
can keep its native handle for seeding without retaining an active transfer
session. Extraction also continues independently of network slots.

Lowering the configured limit requeues excess transfers, retaining high
bandwidth priority and then older transfers. Raising it immediately fills the
new slots. Startup converts interrupted active transfers into queued work and
runs the same scheduler; manually paused downloads remain paused.

Queued starts retain disk-space checks and the existing verification exception
for already downloaded files. A disk-space hold is retried by the download
watcher.

## Bandwidth allocation

The global speed cap is shared by controllable HTTP and torrent sessions.
Normal priority has weight 1 and high priority has weight 2. Periodic sampling
redistributes unused allocations to transfers that can use them. HTTP batches
share their game's allocation across their own connections.

Legendary exposes no runtime speed-limit control. Epic downloads therefore
count toward concurrency but do not participate in bandwidth allocation.

## Desktop and Big Picture

Both windows keep live progress by game ID so interleaved packets and one
game's completion do not clear another game's progress. Desktop renders each
active transfer with its own controls and expandable details. Big Picture
shows a selected hero plus the other active transfers and persists the
preferred hero independently of queue order.

Big Picture sends ordinary starts to the orchestrator, which decides whether
to start or queue them. Both settings surfaces update the same concurrency
preference. Preference writes are serialized in the main process so concurrent
updates from the two windows do not overwrite unrelated settings.

## Validation

The production manager/orchestrator fixture replaces external I/O and covers
mixed-source scheduling, default and invalid limits, dynamic limit changes,
Epic serialization, independent controls, queue ordering, concurrent user
actions, startup, torrent completion with and without seeding, and recovery
from a queued startup failure. UI tests cover interleaved packets, hero
selection, and speed-unit conversion while editing preferences.

Native torrent tests exercise two independent handles, status polling, pause,
restart, cancellation, duplicate ownership, and cleanup.

Before release, manually exercise real HTTP, torrent, and Epic transfers in
both windows. Confirm progress and controls remain attached to the correct
game, restart restores the configured number of transfers, extraction and
seeding release slots, and a measured global cap excludes Epic as described
above. Native changes require rebuilding the addon and torrent bridge.
