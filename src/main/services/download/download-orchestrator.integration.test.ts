import assert from "node:assert/strict";
import { test } from "node:test";

import {
  epic,
  fixture,
  http,
  key,
  settle,
  torrent,
} from "./download-orchestrator-test-fixture.js";

test("production manager keeps concurrent torrent sessions independently controllable", async () => {
  const f = fixture();
  const first = torrent(
    "TorrentOne",
    "0000000000000000000000000000000000000001"
  );
  const second = {
    ...torrent("TorrentTwo", "0000000000000000000000000000000000000002"),
    bandwidthPriority: "high" as const,
  };
  f.add(first);
  f.add(second);

  await Promise.all([
    f.manager.startDownload(first),
    f.manager.startDownload(second),
  ]);
  assert.deepEqual(
    f.state.torrentActions.slice(0, 2).map((action) => action.game_id),
    [key(first), key(second)]
  );
  assert.deepEqual(
    f.state.torrentActions.slice(0, 2).map((action) => action.action),
    ["start", "start"]
  );
  assert.equal(f.manager.getActiveDownloadCount(), 2);
  assert.deepEqual(
    [...f.manager.getActiveDownloadIds()].sort(),
    [key(first), key(second)].sort()
  );

  await f.manager.applyDownloadSpeedLimit(300);
  const allocations = f.state.torrentActions
    .filter((action) => action.action === "set_game_download_limit")
    .map((action) => [
      action.game_id,
      action.max_download_speed_bytes_per_second,
    ]);
  assert.deepEqual(allocations.slice(-2), [
    [key(first), 100],
    [key(second), 200],
  ]);

  await f.manager.pauseDownload(key(first));
  await f.manager.cancelDownload(key(second));
  assert.deepEqual(
    f.state.torrentActions
      .filter(
        (action) => action.action === "pause" || action.action === "cancel"
      )
      .map((action) => [action.action, action.game_id]),
    [
      ["pause", key(first)],
      ["cancel", key(second)],
    ]
  );
  assert.equal(f.manager.getActiveDownloadCount(), 0);
});

test("production manager keeps concurrent HTTP sessions independently controllable", async () => {
  const f = fixture();
  const first = http("HttpOne");
  const second = http("HttpTwo");
  f.add(first);
  f.add(second);
  f.prepareHttp(first);
  f.prepareHttp(second);

  await Promise.all([
    f.manager.startDownload(first),
    f.manager.startDownload(second),
  ]);

  assert.equal(f.manager.getActiveDownloadCount(), 2);
  assert.deepEqual(
    [...f.manager.getActiveDownloadIds()].sort(),
    [key(first), key(second)].sort()
  );
  assert.equal(f.state.httpStarted.length, 2);
});

test("a global bandwidth cap is shared across concurrent HTTP and torrent transfers by priority", async () => {
  const f = fixture();
  const firstHttp = http("BandwidthHttpOne");
  const secondHttp = http("BandwidthHttpTwo");
  const highPriorityTorrent = {
    ...torrent("BandwidthTorrent", "0000000000000000000000000000000000000003"),
    bandwidthPriority: "high" as const,
  };
  f.add(firstHttp);
  f.add(secondHttp);
  f.add(highPriorityTorrent);
  f.prepareHttp(firstHttp);
  f.prepareHttp(secondHttp);

  await Promise.all([
    f.manager.startDownload(firstHttp),
    f.manager.startDownload(secondHttp),
    f.manager.startDownload(highPriorityTorrent),
  ]);
  await f.manager.applyDownloadSpeedLimit(400);

  assert.deepEqual(
    f.state.httpLimits.filter((limit): limit is number => limit !== null),
    [100, 100]
  );
  const torrentAllocation = f.state.torrentActions
    .filter((action) => action.action === "set_game_download_limit")
    .at(-1);
  assert.equal(torrentAllocation?.max_download_speed_bytes_per_second, 200);
  assert.equal(
    f.state.httpLimits
      .filter((limit): limit is number => limit !== null)
      .reduce((total, limit) => total + limit, 0) +
      Number(torrentAllocation?.max_download_speed_bytes_per_second),
    400
  );
});

test("global concurrency limit schedules mixed sources and requeues excess transfers", async () => {
  const f = fixture();
  const first = {
    ...torrent("TorrentOne", "0000000000000000000000000000000000000001"),
    queued: true,
    timestamp: 1,
  };
  const second = { ...http("HttpOne"), queued: true, timestamp: 2 };
  const third = { ...http("HttpTwo"), queued: true, timestamp: 3 };
  f.state.preferences = { maxConcurrentDownloads: 2 };
  f.add(first);
  f.add(second);
  f.add(third);
  f.prepareHttp(second);
  f.prepareHttp(third);
  f.state.layout.queueOrder = [key(first), key(second), key(third)];

  await f.orchestrator.pumpDownloadQueue();

  assert.equal(f.downloads.get(key(first))?.status, "active");
  assert.equal(f.downloads.get(key(second))?.status, "active");
  assert.equal(f.downloads.get(key(third))?.queued, true);

  f.state.preferences = { maxConcurrentDownloads: 1 };
  await f.orchestrator.reconcileConcurrentDownloadLimit();

  assert.equal(f.downloads.get(key(third))?.queued, true);
  assert.equal(
    [first, second].filter(
      (download) => f.downloads.get(key(download))?.status === "active"
    ).length,
    1
  );
  assert.equal(
    [first, second].filter((download) => f.downloads.get(key(download))?.queued)
      .length,
    1
  );
  assert.equal(f.manager.getActiveDownloadCount(), 1);
});

test("the default global limit starts two transfers and leaves later work queued", async () => {
  const f = fixture();
  const first = {
    ...http("DefaultLimitOne"),
    queued: true,
    timestamp: 1,
  };
  const second = {
    ...torrent("DefaultLimitTwo", "0000000000000000000000000000000000000002"),
    queued: true,
    timestamp: 2,
  };
  const third = {
    ...http("DefaultLimitThree"),
    queued: true,
    timestamp: 3,
  };
  f.add(first);
  f.add(second);
  f.add(third);
  f.prepareHttp(first);
  f.prepareHttp(third);
  f.state.layout.queueOrder = [key(first), key(second), key(third)];

  await f.orchestrator.pumpDownloadQueue();

  assert.equal(f.downloads.get(key(first))?.status, "active");
  assert.equal(f.downloads.get(key(second))?.status, "active");
  assert.equal(f.downloads.get(key(third))?.queued, true);
  assert.equal(f.manager.getActiveDownloadCount(), 2);
});

test("invalid global limits fall back to the safe default of two transfers", async () => {
  for (const invalidLimit of [0, -1, 1.5, 9] as const) {
    const f = fixture();
    const first = { ...http(`Invalid${invalidLimit}One`), queued: true };
    const second = { ...http(`Invalid${invalidLimit}Two`), queued: true };
    const third = { ...http(`Invalid${invalidLimit}Three`), queued: true };
    f.state.preferences = { maxConcurrentDownloads: invalidLimit };
    f.add(first);
    f.add(second);
    f.add(third);
    f.prepareHttp(first);
    f.prepareHttp(second);
    f.prepareHttp(third);
    f.state.layout.queueOrder = [key(first), key(second), key(third)];

    await f.orchestrator.pumpDownloadQueue();

    assert.equal(
      [...f.downloads.values()].filter(
        (download) => download.status === "active"
      ).length,
      2,
      `limit ${invalidLimit}`
    );
    assert.equal(f.downloads.get(key(third))?.queued, true);
  }
});

test("a blocked second Epic download does not waste an available global slot", async () => {
  const f = fixture();
  const firstEpic = { ...epic("Namespace:First"), queued: true, timestamp: 1 };
  const secondEpic = {
    ...epic("Namespace:Second"),
    queued: true,
    timestamp: 2,
  };
  const eligibleHttp = { ...http("EligibleHttp"), queued: true, timestamp: 3 };
  f.state.preferences = { maxConcurrentDownloads: 3 };
  f.add(firstEpic);
  f.add(secondEpic);
  f.add(eligibleHttp);
  f.prepareHttp(eligibleHttp);
  f.state.layout.queueOrder = [
    key(firstEpic),
    key(secondEpic),
    key(eligibleHttp),
  ];

  await f.orchestrator.pumpDownloadQueue();

  assert.equal(f.downloads.get(key(firstEpic))?.status, "active");
  assert.equal(f.downloads.get(key(secondEpic))?.queued, true);
  assert.equal(f.downloads.get(key(eligibleHttp))?.status, "active");
  assert.equal(f.requests.length, 1);
  assert.equal(f.state.httpStarted.length, 1);
});

test("an Epic download respects a full global limit held by another source", async () => {
  const f = fixture();
  const activeHttp = http("ActiveHttp");
  const queuedEpic = epic("Namespace:Queued");
  f.state.preferences = { maxConcurrentDownloads: 1 };
  f.add(activeHttp);
  f.add(queuedEpic);
  f.prepareHttp(activeHttp);

  await f.orchestrator.startPreparedDownload(activeHttp);
  await f.orchestrator.acceptPreparedEpicDownload(queuedEpic);

  assert.equal(f.downloads.get(key(activeHttp))?.status, "active");
  assert.equal(f.downloads.get(key(queuedEpic))?.status, "paused");
  assert.equal(f.downloads.get(key(queuedEpic))?.queued, true);
  assert.equal(f.requests.length, 0);
});

test("raising the global limit immediately starts queued work in queue order", async () => {
  const f = fixture();
  const first = { ...http("RaiseLimitOne"), queued: true, timestamp: 1 };
  const second = { ...http("RaiseLimitTwo"), queued: true, timestamp: 2 };
  const third = { ...http("RaiseLimitThree"), queued: true, timestamp: 3 };
  f.state.preferences = { maxConcurrentDownloads: 1 };
  f.add(first);
  f.add(second);
  f.add(third);
  f.prepareHttp(first);
  f.prepareHttp(second);
  f.prepareHttp(third);
  f.state.layout.queueOrder = [key(first), key(second), key(third)];

  await f.orchestrator.pumpDownloadQueue();
  f.state.preferences = { maxConcurrentDownloads: 3 };
  await f.orchestrator.reconcileConcurrentDownloadLimit();

  assert.deepEqual(f.state.httpStarted, [
    "https://fixture.invalid/archive.zip",
    "https://fixture.invalid/archive.zip",
    "https://fixture.invalid/archive.zip",
  ]);
  assert.equal(f.manager.getActiveDownloadCount(), 3);
  assert.equal(
    [...f.downloads.values()].filter((download) => download.queued).length,
    0
  );
});

test("lowering the limit preserves high priority and older equally-prioritized transfers", async () => {
  const f = fixture();
  const olderNormal = {
    ...http("OlderNormal"),
    status: "active" as const,
    timestamp: 10,
  };
  const highPriority = {
    ...http("HighPriority"),
    status: "active" as const,
    timestamp: 20,
    bandwidthPriority: "high" as const,
  };
  const newerNormal = {
    ...http("NewerNormal"),
    status: "active" as const,
    timestamp: 30,
  };
  f.state.preferences = { maxConcurrentDownloads: 1 };
  f.add(olderNormal);
  f.add(highPriority);
  f.add(newerNormal);

  await f.orchestrator.reconcileConcurrentDownloadLimit();

  assert.equal(f.downloads.get(key(highPriority))?.status, "active");
  assert.equal(f.downloads.get(key(olderNormal))?.queued, true);
  assert.equal(f.downloads.get(key(newerNormal))?.queued, true);
  const layout = await f.orchestrator.getLayoutState();
  assert.equal(
    Array.from(layout.queueOrder).join(","),
    [key(olderNormal), key(newerNormal)].join(",")
  );
});

test("pausing an active transfer immediately fills its released global slot", async () => {
  const f = fixture();
  const first = { ...http("PausedFirst"), queued: true };
  const second = { ...http("QueuedSecond"), queued: true };
  f.state.preferences = { maxConcurrentDownloads: 1 };
  f.add(first);
  f.add(second);
  f.prepareHttp(first);
  f.prepareHttp(second);
  f.state.layout.queueOrder = [key(first), key(second)];

  await f.orchestrator.pumpDownloadQueue();
  await f.orchestrator.pauseDownloadById(first.shop, first.objectId);

  assert.equal(f.downloads.get(key(first))?.status, "paused");
  assert.equal(f.downloads.get(key(second))?.status, "active");
  assert.equal(f.manager.getActiveDownloadCount(), 1);
});

test("queue-if-active resume keeps the current transfer running when the global limit is full", async () => {
  const f = fixture();
  const active = {
    ...http("CurrentTransfer"),
    status: "active" as const,
  };
  const resumed = http("RequestedTransfer");
  f.state.preferences = { maxConcurrentDownloads: 1 };
  f.add(active);
  f.add(resumed);
  f.prepareHttp(resumed);

  await f.orchestrator.resumeDownload(
    resumed.shop,
    resumed.objectId,
    "queueIfActive"
  );

  assert.equal(f.downloads.get(key(active))?.status, "active");
  assert.equal(f.downloads.get(key(resumed))?.status, "paused");
  assert.equal(f.downloads.get(key(resumed))?.queued, true);
  assert.equal(f.state.httpPaused, 0);
  assert.equal(f.state.httpStarted.length, 0);
});

test("Big Picture hero placement uses a free slot without pausing another transfer", async () => {
  const f = fixture();
  const first = http("ExistingHero");
  const second = http("NewHero");
  f.add(first);
  f.add(second);
  f.prepareHttp(first);
  f.prepareHttp(second);
  await f.orchestrator.startPreparedDownload(first);
  await f.orchestrator.moveDownloadPlacement(
    second.shop,
    second.objectId,
    "hero"
  );
  assert.equal(f.manager.getActiveDownloadCount(), 2);
  assert.equal(f.state.httpPaused, 0);
  assert.equal(
    (await f.orchestrator.getLayoutState()).preferredHeroId,
    key(second)
  );
});

test("Big Picture hero placement queues work when the configured limit is full", async () => {
  const f = fixture();
  const first = http("FullHero");
  const second = http("WaitingHero");
  f.state.preferences = { maxConcurrentDownloads: 1 };
  f.add(first);
  f.add(second);
  f.prepareHttp(first);
  f.prepareHttp(second);
  await f.orchestrator.startPreparedDownload(first);
  await f.orchestrator.moveDownloadPlacement(
    second.shop,
    second.objectId,
    "hero"
  );
  assert.equal(f.manager.getActiveDownloadCount(), 1);
  assert.equal(f.downloads.get(key(first))?.status, "active");
  assert.equal(f.downloads.get(key(second))?.queued, true);
  assert.equal(f.state.httpPaused, 0);
});

test("pausing a secondary active transfer stops its runtime and preserves the selected hero", async () => {
  const f = fixture();
  const first = http("FirstActive");
  const second = http("SecondActive");
  f.add(first);
  f.add(second);
  f.prepareHttp(first);
  f.prepareHttp(second);
  await f.orchestrator.startPreparedDownload(first);
  await f.orchestrator.startPreparedDownload(second);
  await f.orchestrator.moveDownloadPlacement(
    first.shop,
    first.objectId,
    "hero"
  );
  await f.orchestrator.moveDownloadPlacement(
    second.shop,
    second.objectId,
    "paused"
  );
  assert.equal(f.manager.hasRunningDownload(key(second)), false);
  assert.equal(f.manager.hasRunningDownload(key(first)), true);
  assert.equal(f.downloads.get(key(second))?.queued, false);
  assert.equal(
    (await f.orchestrator.getLayoutState()).preferredHeroId,
    key(first)
  );
});

test("repeated resume of an active transfer cannot queue or interrupt it", async () => {
  const f = fixture();
  const download = http("RepeatedResume");
  f.state.preferences = { maxConcurrentDownloads: 1 };
  f.add(download);
  f.prepareHttp(download);
  await f.orchestrator.startPreparedDownload(download);
  await f.orchestrator.resumeDownload(
    download.shop,
    download.objectId,
    "queueIfActive"
  );
  assert.equal(f.downloads.get(key(download))?.status, "active");
  assert.equal(f.downloads.get(key(download))?.queued, false);
  assert.equal(f.state.httpStarted.length, 1);
});

test("Epic acceptance and ordinary starts share the same global activation lock", async () => {
  const f = fixture();
  const first = http("ConcurrentHttp");
  const second = epic("Namespace:ConcurrentEpic");
  f.state.preferences = { maxConcurrentDownloads: 1 };
  f.add(first);
  f.add(second);
  f.prepareHttp(first);
  await Promise.all([
    f.orchestrator.startPreparedDownload(first),
    f.orchestrator.acceptPreparedEpicDownload(second),
  ]);
  assert.equal(
    [...f.downloads.values()].filter((entry) => entry.status === "active")
      .length,
    1
  );
  assert.equal(f.manager.getActiveDownloadCount(), 1);
});

test("restart preserves the resume intent of every interrupted concurrent transfer", async () => {
  const f = fixture();
  const first = { ...http("RestartOne"), status: "active" as const };
  const second = { ...http("RestartTwo"), status: "active" as const };
  const manual = http("ManuallyPaused");
  f.add(first);
  f.add(second);
  f.add(manual);
  await f.orchestrator.bootstrapDownloadsOnStartup();
  assert.equal(f.downloads.get(key(first))?.queued, true);
  assert.equal(f.downloads.get(key(second))?.queued, true);
  assert.equal(f.downloads.get(key(manual))?.queued, false);
});

for (const seedAfterDownloadComplete of [false, true]) {
  test(`torrent completion releases its slot and refills the queue (seeding: ${seedAfterDownloadComplete})`, async () => {
    const f = fixture();
    const completed = {
      ...torrent(
        "CompletedTorrent",
        "0000000000000000000000000000000000000004"
      ),
      status: "active" as const,
      folderName: null,
    };
    const next = { ...http("AfterCompletionOne"), queued: true };
    const later = { ...http("AfterCompletionTwo"), queued: true };
    f.state.preferences = {
      maxConcurrentDownloads: 2,
      seedAfterDownloadComplete,
    };
    f.add(completed);
    f.add(next);
    f.add(later);
    f.prepareHttp(next);
    f.prepareHttp(later);
    f.state.layout.queueOrder = [key(next), key(later)];
    f.state.torrentStatuses.set(key(completed), {
      progress: 1,
      bytesDownloaded: 1000,
      fileSize: 1000,
      downloadSpeed: 0,
      numPeers: 0,
      numSeeds: 0,
      status: 5,
    });
    await f.manager.startDownload(completed);
    await f.manager.watchDownloads();

    assert.equal(
      f.downloads.get(key(completed))?.status,
      seedAfterDownloadComplete ? "seeding" : "complete"
    );
    assert.equal(f.manager.hasRunningDownload(key(completed)), false);
    assert.equal(f.downloads.get(key(next))?.status, "active");
    assert.equal(f.downloads.get(key(later))?.status, "active");
    assert.equal(f.manager.getActiveDownloadCount(), 2);
    await f.manager.watchDownloads();
    assert.deepEqual(f.state.notifications, [completed.objectId]);
  });
}

test("startup queue pumping resumes every available slot and leaves manual pauses alone", async () => {
  const f = fixture();
  const first = { ...http("StartupOne"), status: "active" as const };
  const second = { ...http("StartupTwo"), status: "active" as const };
  const manual = http("StartupPaused");
  f.add(first);
  f.add(second);
  f.add(manual);
  f.prepareHttp(first);
  f.prepareHttp(second);
  await f.orchestrator.bootstrapDownloadsOnStartup();
  await f.orchestrator.pumpDownloadQueue();
  assert.equal(f.manager.getActiveDownloadCount(), 2);
  assert.equal(f.downloads.get(key(first))?.status, "active");
  assert.equal(f.downloads.get(key(second))?.status, "active");
  assert.equal(f.downloads.get(key(manual))?.status, "paused");
});

test("a failed queued start does not strand later eligible downloads", async () => {
  const f = fixture();
  const failed = { ...http("FailedQueuedStart"), queued: true };
  const next = { ...http("AfterFailedStart"), queued: true };
  f.add(failed);
  f.add(next);
  f.prepareHttp(next);
  f.state.layout.queueOrder = [key(failed), key(next)];
  await f.orchestrator.pumpDownloadQueue();
  assert.equal(f.downloads.get(key(failed))?.status, "error");
  assert.equal(f.downloads.get(key(next))?.status, "active");
  assert.equal(f.manager.getActiveDownloadCount(), 1);
});

test("restart places interrupted transfers before an existing queue in timestamp order", async () => {
  const f = fixture();
  const queued = { ...http("AlreadyQueued"), queued: true, timestamp: 1 };
  const later = {
    ...http("LaterInterrupted"),
    status: "active" as const,
    timestamp: 3,
  };
  const first = {
    ...http("FirstInterrupted"),
    status: "active" as const,
    timestamp: 2,
  };
  for (const download of [queued, later, first]) {
    f.add(download);
    f.prepareHttp(download);
  }
  f.state.layout.queueOrder = [key(queued)];
  f.state.preferences = { maxConcurrentDownloads: 1 };
  await f.orchestrator.bootstrapDownloadsOnStartup();
  assert.deepEqual(f.state.layout.queueOrder, [
    key(first),
    key(later),
    key(queued),
  ]);
  await f.orchestrator.pumpDownloadQueue();
  assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(first)]);
});

test("resuming a paused torrent after removing the global cap resets its handle limit", async () => {
  const f = fixture();
  const download = torrent(
    "RetainedCap",
    "0000000000000000000000000000000000000010"
  );
  f.add(download);
  await f.manager.startDownload(download);
  await f.manager.applyDownloadSpeedLimit(5000000);
  await f.manager.pauseDownload(key(download));
  await f.manager.applyDownloadSpeedLimit(null);
  f.state.torrentActions.length = 0;
  await f.manager.resumeDownload(download);
  await settle();
  assert.ok(
    f.state.torrentActions.some(
      (action) =>
        action.action === "set_game_download_limit" &&
        action.game_id === key(download) &&
        action.max_download_speed_bytes_per_second === 0
    )
  );
});

test("a stale torrent start cannot cancel a newer session for the same game", async () => {
  const f = fixture();
  const download = torrent(
    "ReplacedTorrent",
    "0000000000000000000000000000000000000011"
  );
  f.add(download);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.state.torrentStart = () => {
    entered();
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  const oldStart = f.manager.startDownload(download);
  await started;
  await f.manager.pauseDownload(key(download));
  f.state.torrentStart = async () => {};
  await f.manager.startDownload(download);
  f.state.torrentActions.length = 0;
  release();
  await oldStart;
  assert.equal(f.manager.hasRunningDownload(key(download)), true);
  assert.equal(
    f.state.torrentActions.some((action) => action.action === "cancel"),
    false
  );
});

test("session polling cancels an orphan without stopping another transfer", async () => {
  const f = fixture();
  const orphan = http("Orphan");
  const survivor = http("Survivor");
  for (const download of [orphan, survivor]) {
    f.add(download);
    f.prepareHttp(download);
    await f.manager.startDownload(download);
  }
  f.downloads.delete(key(orphan));
  await f.manager.watchDownloads();
  assert.equal(f.manager.hasRunningDownload(key(orphan)), true);
  await f.manager.watchDownloads();
  assert.equal(f.manager.hasRunningDownload(key(orphan)), false);
  assert.equal(f.manager.hasRunningDownload(key(survivor)), true);
});

test("concurrent status polling throttles disk checks independently and aggregates taskbar progress", async () => {
  const f = fixture();
  const first = torrent("DiskOne", "0000000000000000000000000000000000000012");
  const second = torrent("DiskTwo", "0000000000000000000000000000000000000013");
  for (const [download, progress] of [
    [first, 0.2],
    [second, 0.8],
  ] as const) {
    f.add(download);
    f.state.torrentStatuses.set(key(download), {
      progress,
      bytesDownloaded: progress * 1000,
      fileSize: 1000,
      downloadSpeed: 10,
      numPeers: 1,
      numSeeds: 1,
      folderName: "Game",
      status: 3,
    });
    await f.manager.startDownload(download);
  }
  await f.manager.watchDownloads();
  await f.manager.watchDownloads();
  assert.deepEqual(f.state.diskChecks.sort(), [key(first), key(second)].sort());
  assert.equal(f.state.taskbarProgress.at(-1), 0.5);
  await f.manager.pauseDownload(key(first));
  assert.equal(f.state.taskbarProgress.at(-1), 0.8);
});

test("lowering concurrency leaves a non-resumable TorBox zip running", async () => {
  const f = fixture();
  const first = http("SafeToPause");
  const protectedDownload = { ...http("TorBoxZip"), timestamp: 2 };
  for (const download of [first, protectedDownload]) {
    f.add(download);
    f.prepareHttp(download);
    await f.orchestrator.startPreparedDownload(download);
  }
  const internals = f.manager as unknown as {
    sessions: Map<
      string,
      { batch: unknown; downloader: { getDownloadStatus: () => unknown } }
    >;
  };
  const session = internals.sessions.get(key(protectedDownload))!;
  session.batch = {
    provider: "torBox",
    currentIndex: 0,
    entries: [{ isZip: true }],
  };
  session.downloader.getDownloadStatus = () => ({
    resumeCapability: "unsupported",
  });
  f.state.preferences = { maxConcurrentDownloads: 1 };
  await f.orchestrator.reconcileConcurrentDownloadLimit();
  assert.equal(f.manager.hasRunningDownload(key(protectedDownload)), true);
  assert.equal(f.manager.hasRunningDownload(key(first)), false);
});

for (const priorityFirst of [false, true]) {
  test(`overlapping priority and torrent progress writes preserve both updates (priority first: ${priorityFirst})`, async () => {
    const f = fixture();
    const download = torrent(
      "PriorityRace",
      "0000000000000000000000000000000000000014"
    );
    f.add(download);
    await f.manager.startDownload(download);
    f.state.torrentStatuses.set(key(download), {
      progress: 0.2,
      bytesDownloaded: 200,
      fileSize: 1000,
      downloadSpeed: 10,
      numPeers: 1,
      numSeeds: 1,
      folderName: "Game",
      status: 3,
    });
    let entered!: () => void;
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.state.beforeWrite = async () => {
      f.state.beforeWrite = () => {};
      entered();
      await gate;
    };
    const setPriority = () =>
      f.updateDownloadRecord(key(download), { bandwidthPriority: "high" });
    const first = priorityFirst ? setPriority() : f.manager.watchDownloads();
    await writing;
    const second = priorityFirst ? f.manager.watchDownloads() : setPriority();
    await settle();
    release();
    await Promise.all([first, second]);
    const saved = f.downloads.get(key(download))!;
    assert.equal(saved.bandwidthPriority, "high");
    assert.equal(saved.bytesDownloaded, 200);
    await f.manager.watchDownloads();
    assert.equal(f.downloads.get(key(download))?.bandwidthPriority, "high");
  });
}

test("startup preserves the preferred hero through normalization and queue pumping", async () => {
  const f = fixture();
  const download = {
    ...http("PreferredInterrupted"),
    status: "active" as const,
  };
  f.add(download);
  f.prepareHttp(download);
  f.state.layout.preferredHeroId = key(download);
  await f.orchestrator.bootstrapDownloadsOnStartup();
  assert.equal(f.state.layout.preferredHeroId, key(download));
  await f.orchestrator.pumpDownloadQueue();
  assert.equal(f.state.layout.preferredHeroId, key(download));
  f.downloads.delete(key(download));
  await f.orchestrator.getLayoutState();
  assert.equal(f.state.layout.preferredHeroId, null);
});
