import assert from "node:assert/strict";
import { test } from "node:test";

import { Downloader } from "../../../shared/constants.js";
import type { Download } from "../../../types/level.types";
import { deferred } from "../epic/store-test-helpers.js";
import {
  epic,
  fixture,
  key,
  settle,
} from "./download-orchestrator-test-fixture.js";

test("Epic acceptance returns before preparation and concurrent clicks keep one active slot", async () => {
  const f = fixture();
  const first = epic("Namespace:FastOne"),
    second = epic("Namespace:FastTwo");
  f.add(first);
  f.add(second);
  const preparation = deferred<void>();
  f.state.startGate = preparation.promise;
  try {
    await Promise.all([
      f.orchestrator.acceptPreparedEpicDownload(first),
      f.orchestrator.acceptPreparedEpicDownload(second),
    ]);
    await settle();
    assert.equal(f.requests.length, 1);
    assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(first)]);
    assert.equal(f.downloads.get(key(second))?.queued, true);
  } finally {
    preparation.resolve();
    await settle();
  }
});

test("cancel immediately after Epic acknowledgement stops its reserved slot without resurrecting it", async () => {
  const f = fixture();
  const download = epic("Namespace:ImmediateCancel");
  f.add(download);
  const preparation = deferred<void>();
  f.state.startGate = preparation.promise;
  await f.orchestrator.acceptPreparedEpicDownload(download);
  assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(download)]);
  await f.orchestrator.cancelDownloadById(download.shop, download.objectId);
  preparation.resolve();
  await settle();
  assert.deepEqual([...f.manager.getActiveDownloadIds()], []);
  assert.equal(f.downloads.get(key(download))?.status, "removed");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].current(), false);
});

test("cancel during the acceptance lookup cannot recreate its removed download", async () => {
  const f = fixture();
  const download = epic("Namespace:CanceledBeforeAck");
  f.add(download);
  const entered = deferred<void>();
  const release = deferred<void>();
  let blocked = false;
  f.state.beforeRead = async (id) => {
    if (id === key(download) && !blocked) {
      blocked = true;
      entered.resolve();
      await release.promise;
    }
  };
  const acceptance = f.orchestrator.acceptPreparedEpicDownload(download);
  await entered.promise;
  await f.orchestrator.cancelDownloadById(download.shop, download.objectId);
  release.resolve();
  await acceptance;
  await settle();
  assert.deepEqual([...f.manager.getActiveDownloadIds()], []);
  assert.equal(f.downloads.get(key(download))?.status, "removed");
  assert.equal(f.requests.length, 0);
});

test("explicit Epic start reserves the selected game without waiting for older queued non-Epic preparation", async () => {
  const f = fixture();
  const older: Download = {
    ...epic("OlderHttp"),
    shop: "steam",
    downloader: Downloader.PixelDrain,
    epic: undefined,
    queued: true,
  };
  const download = epic("Namespace:Selected");
  f.add(older);
  f.add(download);
  f.state.layout.queueOrder = [key(older)];
  const preparation = deferred<void>();
  f.state.startGate = preparation.promise;
  try {
    await f.orchestrator.acceptPreparedEpicDownload(download);
    assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(download)]);
    assert.equal(f.requests.length, 1);
    assert.equal(f.state.httpStarted.length, 0);
    assert.equal(f.downloads.get(key(older))?.queued, true);
    assert.equal(f.downloads.get(key(older))?.status, "paused");
  } finally {
    preparation.resolve();
    await settle();
  }
});

for (const action of ["cancel-and-start", "pause-and-resume"] as const) {
  test(`late accepted Epic failure cannot overwrite ${action} with the same timestamp`, async (t) => {
    t.mock.method(Date, "now", () => 100);
    const f = fixture();
    const download = epic("Namespace:SameId");
    f.add(download);
    let fail!: (error: Error) => void;
    f.state.startGate = new Promise<void>((_resolve, reject) => {
      fail = reject;
    });
    await f.orchestrator.acceptPreparedEpicDownload(download);
    if (action === "cancel-and-start")
      await f.orchestrator.cancelDownloadById(download.shop, download.objectId);
    else
      await f.orchestrator.pauseDownloadById(download.shop, download.objectId);
    f.state.startGate = Promise.resolve();
    if (action === "cancel-and-start")
      await f.orchestrator.acceptPreparedEpicDownload(download);
    else await f.orchestrator.resumeDownload(download.shop, download.objectId);
    fail(new Error("obsolete preparation failed"));
    await settle();
    assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(download)]);
    assert.equal(f.downloads.get(key(download))?.status, "active");
    assert.equal(f.downloads.get(key(download))?.timestamp, 100);
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[0].current(), false);
    assert.equal(f.requests[1].current(), true);
  });
}

for (const [code, nextDownloader] of [
  ["insufficient-space", "epic"],
  ["stale-connection", "http"],
] as const) {
  test(`accepted Epic preparation failure preserves ${code} and starts the next ${nextDownloader} download`, async () => {
    const f = fixture();
    const download = epic("Namespace:Failed");
    const next: Download =
      nextDownloader === "epic"
        ? epic("Namespace:Next")
        : {
            ...epic("NextHttp"),
            shop: "steam",
            downloader: Downloader.PixelDrain,
            epic: undefined,
          };
    f.add(download);
    f.add(next);
    if (nextDownloader === "http") f.prepareHttp(next);
    let fail!: (error: Error) => void;
    f.state.startGate = new Promise<void>((_resolve, reject) => {
      fail = reject;
    });
    await f.orchestrator.acceptPreparedEpicDownload(download);
    await f.orchestrator.startPreparedDownload(next);
    if (nextDownloader === "epic")
      assert.equal(f.downloads.get(key(next))?.queued, true);
    else {
      assert.equal(f.downloads.get(key(next))?.status, "active");
      assert.equal(f.state.httpStarted.length, 1);
    }
    f.state.startGate = Promise.resolve();
    fail(Object.assign(new Error("current preparation failed"), { code }));
    await settle();
    assert.equal(f.downloads.get(key(download))?.status, "error");
    assert.equal(f.downloads.get(key(download))?.epic?.error, code);
    assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(next)]);
    assert.equal(f.downloads.get(key(next))?.status, "active");
    assert.equal(f.downloads.get(key(next))?.queued, false);
    const layout = await f.orchestrator.getLayoutState();
    assert.equal(layout.queueOrder.length, 0);
    assert.ok(layout.pausedOrder.includes(key(download)));
    if (nextDownloader === "epic") assert.equal(f.requests.length, 2);
    else assert.equal(f.state.httpStarted.length, 1);
  });
}

test("resuming a non-Epic download after Epic acknowledgement keeps both transfers active", async () => {
  const f = fixture();
  const download = epic("Namespace:Interrupt");
  const http: Download = {
    ...epic("HttpGame"),
    shop: "steam",
    downloader: Downloader.PixelDrain,
    epic: undefined,
  };
  f.add(download);
  f.add(http);
  f.prepareHttp(http);
  const preparation = deferred<void>();
  f.state.startGate = preparation.promise;
  await f.orchestrator.acceptPreparedEpicDownload(download);
  await f.orchestrator.resumeDownload(http.shop, http.objectId);
  preparation.resolve();
  await settle();
  assert.deepEqual(
    [...f.manager.getActiveDownloadIds()].sort(),
    [key(download), key(http)].sort()
  );
  assert.equal(f.downloads.get(key(download))?.status, "active");
  assert.equal(f.downloads.get(key(http))?.status, "active");
  assert.equal(f.requests[0].current(), true);
  assert.equal(f.state.httpStarted.length, 1);
  assert.equal(
    [...f.downloads.values()].filter((entry) => entry.status === "active")
      .length,
    2
  );
});

test("an accepted Epic download starts alongside a concurrently resumed non-Epic download", async () => {
  const f = fixture();
  const download = epic("Namespace:Concurrent");
  const http: Download = {
    ...epic("HttpGame"),
    shop: "steam",
    downloader: Downloader.PixelDrain,
    epic: undefined,
  };
  f.add(download);
  f.add(http);
  f.prepareHttp(http);
  await Promise.all([
    f.orchestrator.acceptPreparedEpicDownload(download),
    f.orchestrator.resumeDownload(http.shop, http.objectId),
  ]);
  await settle();
  assert.deepEqual(
    [...f.manager.getActiveDownloadIds()].sort(),
    [key(download), key(http)].sort()
  );
  assert.equal(f.downloads.get(key(download))?.queued, false);
  assert.equal(f.downloads.get(key(download))?.status, "active");
  assert.equal(f.requests.length, 1);
  assert.equal(f.state.httpStarted.length, 1);
  assert.equal(
    [...f.downloads.values()].filter((entry) => entry.status === "active")
      .length,
    2
  );
});

test("production manager dispatches Epic preparation and retains the slot until pause stops it", async () => {
  const f = fixture();
  const download = epic("Namespace:One");
  f.add(download);
  const preparing = deferred<void>();
  f.state.startGate = preparing.promise;
  const start = f.orchestrator.startPreparedDownload(download);
  await settle();
  assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(download)]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].download.downloader, Downloader.Epic);
  assert.equal(f.requests[0].current(), true);
  const stopped = deferred<void>();
  f.state.stopGate = stopped.promise;
  const pause = f.orchestrator.pauseDownloadById(
    download.shop,
    download.objectId
  );
  await settle();
  assert.equal(f.requests[0].current(), false);
  assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(download)]);
  preparing.resolve();
  await start;
  stopped.resolve();
  await pause;
  assert.deepEqual([...f.manager.getActiveDownloadIds()], []);
  assert.equal(f.downloads.get(key(download))?.status, "paused");
  assert.equal(f.state.stopped[0], key(download));
  assert.equal(f.state.torrentCalls.length, 0);
});

test("Epic 100 percent telemetry does not complete or advance the queue before verification", async () => {
  const f = fixture();
  const first = epic("Namespace:One"),
    second = epic("Namespace:Two");
  f.add(first);
  f.add(second);
  await f.orchestrator.startPreparedDownload(first);
  await f.orchestrator.startPreparedDownload(second);
  await f.manager.watchDownloads();
  assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(first)]);
  assert.equal(f.downloads.get(key(first))?.status, "active");
  assert.equal(f.downloads.get(key(second))?.queued, true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.state.notifications.length, 0);
});

test("failed Epic startup persists a retryable paused record after confirmed cleanup", async () => {
  const f = fixture();
  const download = {
    ...epic("Namespace:Startup"),
    status: "active" as const,
    queued: true,
  };
  f.add(download);
  let rejectStart!: (reason: Error) => void;
  const cleanup = deferred<void>();
  f.state.startGate = new Promise<void>((_resolve, reject) => {
    rejectStart = reject;
  });
  f.state.stopGate = cleanup.promise;
  const started = f.manager.startDownload(download);
  const rejected = assert.rejects(started, /session-expired/);
  await settle();
  rejectStart(new Error("session-expired"));
  await settle();
  assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(download)]);
  assert.equal(f.downloads.get(key(download))?.status, "active");
  cleanup.resolve();
  await rejected;
  assert.deepEqual([...f.manager.getActiveDownloadIds()], []);
  assert.equal(f.downloads.get(key(download))?.status, "paused");
  assert.equal(f.downloads.get(key(download))?.queued, false);
});

test("verified Epic completion publishes once and starts the next common queued download", async () => {
  const f = fixture();
  const first = epic("Namespace:One"),
    second = epic("Namespace:Two");
  f.add(first);
  f.add(second);
  await f.orchestrator.startPreparedDownload(first);
  await f.orchestrator.startPreparedDownload(second);
  f.state.completed.add(key(first));
  const notification = deferred<void>();
  f.state.notificationGate = notification.promise;
  const stopped = deferred<void>();
  f.state.stopGate = stopped.promise;
  const completion = f.manager.watchDownloads();
  await settle();
  await f.manager.watchDownloads();
  assert.equal(f.state.stopping.length, 1);
  assert.equal(f.state.notifications.length, 0);
  stopped.resolve();
  await settle();
  assert.equal(f.state.notifications.length, 1);
  assert.deepEqual([...f.manager.getActiveDownloadIds()], []);
  notification.resolve();
  await completion;
  assert.equal(f.downloads.get(key(first))?.status, "complete");
  assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(second)]);
  assert.equal(f.requests.length, 2);
  assert.equal(f.downloads.get(key(second))?.status, "active");
  assert.equal(f.downloads.get(key(second))?.queued, false);
  assert.ok(f.state.torrentCalls.every((method) => method === "status"));
});

test("Epic completion cannot replace a new active slot while its notification is pending", async () => {
  const f = fixture();
  const first = epic("Namespace:One"),
    second = epic("Namespace:Two"),
    third = epic("Namespace:Three");
  f.add(first);
  f.add(second);
  f.add(third);
  await f.orchestrator.startPreparedDownload(first);
  await f.orchestrator.startPreparedDownload(second);
  f.state.completed.add(key(first));
  const notification = deferred<void>();
  f.state.notificationGate = notification.promise;
  const completion = f.manager.watchDownloads();
  await settle();
  assert.deepEqual([...f.manager.getActiveDownloadIds()], []);
  // Explicit resume claims the slot; prepared downloads preserve queue order.
  await f.orchestrator.resumeDownload(third.shop, third.objectId);
  notification.resolve();
  await completion;
  assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(third)]);
  assert.equal(f.downloads.get(key(second))?.queued, true);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].download.objectId, third.objectId);
});

test("stale Epic error callbacks cannot stop a restarted download with the same identity", async () => {
  const f = fixture();
  const download = epic("Namespace:One");
  f.add(download);
  await f.orchestrator.startPreparedDownload(download);
  const old = f.requests[0];
  await f.orchestrator.pauseDownloadById(download.shop, download.objectId);
  await f.orchestrator.resumeDownload(download.shop, download.objectId);
  const stoppedBefore = f.state.stopped.length;
  old.failure({ code: "process-failed" });
  await settle();
  assert.equal(old.current(), false);
  assert.equal(f.requests[1].current(), true);
  assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(download)]);
  assert.equal(f.downloads.get(key(download))?.status, "active");
  assert.equal(f.state.stopped.length, stoppedBefore);
});

test("Epic runtime failure waits for shutdown then marks error and advances the queue", async () => {
  const f = fixture();
  const first = epic("Namespace:One"),
    second = epic("Namespace:Two");
  f.add(first);
  f.add(second);
  await f.orchestrator.startPreparedDownload(first);
  await f.orchestrator.startPreparedDownload(second);
  const stopped = deferred<void>();
  f.state.stopGate = stopped.promise;
  f.requests[0].failure({ code: "insufficient-space" });
  await settle();
  assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(first)]);
  assert.equal(f.requests.length, 1);
  stopped.resolve();
  await settle();
  assert.equal(f.downloads.get(key(first))?.status, "error");
  assert.equal(f.downloads.get(key(first))?.epic?.error, "insufficient-space");
  assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(second)]);
  assert.equal(f.requests.length, 2);
});

test("a busy Linux prefix waits for cleanup and resumes finalization at full progress", async () => {
  const f = fixture();
  const download = {
    ...epic("Namespace:BusyPrefix"),
    progress: 1,
    bytesDownloaded: 1000,
    epic: {
      ...epic("Namespace:BusyPrefix").epic!,
      phase: "prerequisites" as const,
    },
  };
  f.add(download);
  await f.orchestrator.startPreparedDownload(download);
  const stopped = deferred<void>();
  f.state.stopGate = stopped.promise;
  f.requests[0].failure({ code: "compatibility-prefix-busy" });
  await settle();
  assert.deepEqual([...f.manager.getActiveDownloadIds()], [key(download)]);
  assert.equal(f.downloads.get(key(download))?.status, "active");
  assert.equal(f.state.notifications.length, 0);
  stopped.resolve();
  await settle();

  const failed = f.downloads.get(key(download))!;
  assert.deepEqual([...f.manager.getActiveDownloadIds()], []);
  assert.equal(failed.status, "error");
  assert.equal(failed.epic?.error, "compatibility-prefix-busy");
  assert.equal(failed.progress, download.progress);
  assert.equal(failed.bytesDownloaded, download.bytesDownloaded);
  assert.equal(failed.folderName, download.folderName);
  assert.equal(failed.epic?.artifactId, download.epic.artifactId);
  assert.equal(f.state.notifications.length, 0);

  assert.equal(
    await f.orchestrator.resumeDownload(download.shop, download.objectId),
    true
  );
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].current(), false);
  assert.equal(f.requests[1].current(), true);
  assert.equal(f.requests[1].download.progress, download.progress);
  assert.equal(
    f.requests[1].download.bytesDownloaded,
    download.bytesDownloaded
  );
  f.state.completed.add(key(download));
  await f.manager.watchDownloads();
  assert.equal(f.downloads.get(key(download))?.status, "complete");
  assert.equal(f.state.notifications.length, 1);
  assert.deepEqual([...f.manager.getActiveDownloadIds()], []);
});
