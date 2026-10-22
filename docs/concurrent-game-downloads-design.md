# Concurrent game downloads

## Goal

Allow several different games to transfer at the same time while preserving the
existing per-game pause, resume, cancel, retry, extraction, Epic, debrid, and
torrent behavior.

The feature should be bounded by a user-configurable concurrency limit. “As many
as possible” must not mean unbounded: each game can already open multiple HTTP
range connections, so an unbounded game count can exhaust bandwidth, file
descriptors, memory, disk I/O, or the torrent bridge.

## Current constraint

The download manager is a single-slot manager. It stores one active game ID,
one JS downloader, one JS batch, one preparation controller, and one generation
counter. The orchestrator also refuses to activate a queued item while any
transfer is active.

The following global values must not remain shared by concurrent games:

- `downloadingGameId`
- `jsDownloader`
- `usingJsDownloader`
- `usingEpicDownloader`
- `isPreparingDownload`
- `jsBatch`
- `startGeneration`
- `preparationController`
- active-download status and error cleanup

## Target architecture

### 1. Per-game download sessions

Introduce a session object owned by `DownloadManager`:

```ts
type DownloadRuntime =
  | { kind: "js"; downloader: JsHttpDownloader | TorBoxBatchDownloader }
  | { kind: "torrent" }
  | { kind: "epic" }
  | { kind: "preparing" };

interface DownloadSession {
  downloadId: string;
  runtime: DownloadRuntime;
  batch: JsBatchState | null;
  controller: AbortController;
  generation: number;
  isPreparing: boolean;
  lastStatusAt: number;
}
```

Store sessions in:

```ts
private static readonly sessions = new Map<string, DownloadSession>();
```

Every lifecycle operation must receive a concrete `downloadId` and operate only
on that session:

- `startDownload(download)` creates/replaces the session for that ID.
- `pauseDownload(downloadId)` pauses only that session.
- `cancelDownload(downloadId)` aborts and removes only that session.
- `getDownloadStatus(downloadId)` reads only that session.
- runtime errors clean up only that session.
- completion removes only that session and asks the orchestrator to fill any
  newly available slot.

Do not retain default arguments such as `downloadKey = this.downloadingGameId`.
They hide the single-slot assumption and make a missing ID dangerous once
several games are active.

### 2. Download scheduler

Add a small scheduler to `DownloadOrchestrator`:

```ts
interface DownloadConcurrencySettings {
  maxConcurrentDownloads: number;
  maxConcurrentHttpDownloads: number;
  maxConcurrentTorrentDownloads: number;
  maxConcurrentEpicDownloads: number;
}
```

Start with one setting, `maxConcurrentDownloads`, defaulting to `1` for the
first migration release. After the per-game refactor is stable, raise the
default to `2` or `3` and expose the setting in Downloads preferences.

The scheduler should use a single serialized `pump()` operation:

```ts
private static pumpPromise: Promise<void> = Promise.resolve();

private static pump(): Promise<void> {
  const next = this.pumpPromise.then(async () => {
    while (this.canStartAnotherDownload()) {
      const nextDownload = await this.getNextQueuedDownload();
      if (!nextDownload) break;
      await this.activateQueuedDownload(nextDownload);
    }
  });
  this.pumpPromise = next.catch(() => undefined);
  return next;
}
```

`canStartAnotherDownload()` should count live sessions, not database records:

```ts
return (
  DownloadManager.getActiveDownloadCount() < settings.maxConcurrentDownloads
);
```

The scheduler must reserve a slot before doing asynchronous preparation. This
prevents two simultaneous queue pumps from both selecting the same game or
both exceeding the limit.

Queue placement remains durable in `downloadsSublevel` and the existing layout
state. A queued game has `status: "paused"` and `queued: true`; an active game
has `status: "active"` and `queued: false`.

### 3. Start and cleanup ownership

Refactor `DownloadManager.startDownload()` into these steps:

1. Create a session and assign its generation/controller.
2. Persist the game as active.
3. Prepare the provider-specific URL, manifest, Epic runtime, or torrent.
4. Attach the resulting runtime to that session.
5. Start the provider.
6. On completion, error, pause, or cancel, finalize that session only.

Generation checks must compare against `sessions.get(downloadId)`, not one
global generation:

```ts
const isCurrent = () => {
  const session = this.sessions.get(downloadId);
  return (
    session?.generation === generation && !session.controller.signal.aborted
  );
};
```

This is essential: cancelling Game A must not invalidate an in-flight start for
Game B.

## Provider behavior

### HTTP and debrid

Create one `JsHttpDownloader` per game. Keep the current byte-range behavior
inside that downloader.

The existing range connections are _within_ a game and should be counted in a
separate connection budget. For example:

```ts
maxConcurrentDownloads: 3;
parallelRangeConnectionsPerGame: 4;
```

could create up to approximately twelve HTTP range requests, plus provider
metadata requests. The scheduler should reject or reduce a new start when the
estimated connection budget is exceeded.

`TorBoxBatchDownloader` should remain owned by its game session. Its own small-
file workers and large-file range workers must not be placed in the global
session map.

### Torrent

Confirm the torrent bridge contract before enabling concurrent torrent games.
The current manager obtains one generic `status` response and maps it to the
single active game. The bridge needs one of these designs:

1. `status_all` returns status records keyed by `game_id`; or
2. `status(game_id)` returns one game’s status and the main loop polls every
   active torrent session.

Actions must already be scoped by `game_id` for start, pause, cancel, and
seeding. If the bridge only supports one active transfer, keep torrent
concurrency at one while allowing HTTP/Epic sessions to run beside it.

### Epic

Create one Epic runtime/session per game. Progress callbacks must capture the
game ID and verify the session is still current before persisting state or
handling errors. The Epic service itself must be checked for global workspace,
lock, or credential limitations before allowing more than one Epic install.

## Progress and renderer contract

The main process should emit one event per update, always containing the game ID:

```ts
interface DownloadProgress {
  gameId: string;
  download: Download;
  progress: number;
  bytesDownloaded: number;
  fileSize: number;
  downloadSpeed: number;
  timeRemaining: number;
  isDownloadingMetadata: boolean;
  isCheckingFiles: boolean;
}
```

The renderer download slice should change from one `lastPacket` to:

```ts
downloadsById: Record<string, DownloadProgress>;
```

Keep a derived `focusedDownloadId` for the existing hero/progress UI. The
downloads page should render all active records from the map. Game details can
select its own record by `shop:objectId`.

`on-download-progress` with `null` should be removed or changed to a scoped
event such as `{ gameId, status: "cleared" }`; a global null would erase the
wrong game’s progress.

## Main-loop changes

`DownloadManager.watchDownloads()` must poll all active sessions and persist
each result independently. It should not call one global `getDownloadStatus()`.

The power-save blocker should use:

```ts
DownloadManager.getActiveDownloadCount() > 0;
```

The global application progress bar should either be disabled for concurrent
downloads or represent aggregate progress. Individual progress belongs in the
renderer event stream.

## Disk space and bandwidth

Before starting a session, calculate a reservation from the download’s known
size and existing partial bytes. Track reservations by download path. Do not
use the current single `lastDiskSpaceCheck` record as the only protection.

For bandwidth, preserve the existing per-downloader throttle but add a shared
budget. A simple first version can divide the configured maximum evenly among
active sessions:

```ts
perSessionLimit = totalLimit / activeSessionCount;
```

Reapply limits whenever the active session count changes.

## Completion behavior

When a game completes:

1. Mark that game complete or seeding.
2. Remove its runtime session.
3. Start extraction for that game if requested.
4. Release its scheduler slot.
5. Call `pump()` to start the next queued game.

Extraction should remain independent of transfer slots, as it is today. A
completed game may extract while another game is downloading.

## Failure behavior

Each failure must be isolated:

- Game A failing marks only A as `error`.
- Game B continues downloading.
- A’s retry/pause/cancel cannot abort B’s controller.
- A’s progress-clear event contains A’s ID.
- The scheduler immediately fills the released slot.

Use provider-specific cleanup in the owning session. Avoid resetting global
flags because those flags will no longer describe one download.

## File-level implementation plan

### Phase 1: session extraction, behavior unchanged

- Add `DownloadSession` and `sessions` to `download-manager.ts`.
- Move JS, Epic, preparation, batch, controller, and generation state into the
  session.
- Keep the orchestrator limit at one.
- Preserve existing IPC and renderer behavior through compatibility adapters.
- Add tests proving pause/cancel/error for one session cannot affect another.

### Phase 2: multi-status support

- Make `watchDownloads()` iterate active session IDs.
- Add `gameId` to every progress event.
- Change renderer state to `downloadsById`.
- Add UI tests for two active progress records.

### Phase 3: concurrent scheduler

- Replace `activateNextQueueItem()` with `pump()`.
- Add `getActiveDownloadCount()` and provider-specific counts.
- Start with a feature flag and limit `2`.
- Add completion/error/cancel slot-release tests.

### Phase 4: provider rollout

- Enable concurrent HTTP/debrid sessions.
- Enable TorBox after batch/session tests.
- Enable concurrent torrent sessions only after the bridge status contract is
  confirmed.
- Enable concurrent Epic sessions only after runtime locking/workspace tests.

## Required tests

1. Two HTTP games start and both progress independently.
2. Cancelling A leaves B active.
3. A failing leaves B active and starts C from the queue.
4. A completing while extracting does not stop B.
5. Restart normalizes multiple active records safely.
6. Pause/resume works for each game independently.
7. The concurrency limit is never exceeded during races between queue pumps.
8. Disk-space failure pauses only the affected game.
9. Progress events remain associated with the correct game ID.
10. Torrent status/action isolation is verified against the bridge.

## Recommended first release

Implement concurrent HTTP/debrid downloads first, with a default limit of two
games and a user setting. Keep torrent and Epic concurrency disabled behind
provider-specific capability checks until their runtimes are proven to support
independent status and cleanup.

This delivers useful concurrent downloading without pretending that the current
single-status torrent and Epic integrations are already safe for parallel jobs.
