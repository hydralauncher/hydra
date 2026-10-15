import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { Download, Game } from "../../../types/level.types";
import { Downloader } from "../../../shared/constants.js";
import {
  EpicDownloadService,
  EpicDownloadProgressParser,
  getReusableEpicDiskBytes,
  quoteWindowsEpicArgument,
  runEpicPrerequisite,
} from "./download.js";
import { EpicInstallationService, epicManagedTarget } from "./installation.js";
import {
  EpicManagedError,
  LegendaryManagedRuntime,
  type executeManagedLegendary,
} from "./legendary-managed-runtime.js";
import { EpicSessionProvider } from "./session-provider.js";
import { EpicConnectionStore } from "./store.js";
import {
  MemoryDatabase,
  bundle,
  connection,
  deferred,
} from "./store-test-helpers.js";

const MIB = 1024 * 1024;
const auth = {
  environment: "https://api.example.test",
  userId: "managed-test",
  generation: 1,
};
const objectId = "Namespace1:Item1";
const metadata = {
  app_name: "Artifact1",
  metadata: {
    namespace: "Namespace1",
    id: "Item1",
    categories: [{ path: "games" }],
    customAttributes: { FolderName: { value: "EpicGame" } },
  },
  asset_infos: {
    Windows: {
      app_name: "Artifact1",
      namespace: "Namespace1",
      catalog_item_id: "Item1",
    },
  },
};
const info = {
  game: {
    app_name: "Artifact1",
    version: "build-1",
    is_dlc: false,
    external_activation: "No",
    cloud_saves_supported: false,
  },
  manifest: { download_size: 2 * MIB, disk_size: 4 * MIB, is_preloaded: false },
};
const initial: Game = {
  title: "Game",
  objectId,
  shop: "epic",
  source: "epic",
  remoteId: "remote",
  iconUrl: null,
  logoImageUrl: null,
  libraryHeroImageUrl: null,
  playTimeInMilliseconds: 0,
  epicPlayTimeInMilliseconds: 10_000,
  lastTimePlayed: null,
  isDeleted: false,
  hasActiveEpicImport: true,
  epicImportScope: {
    environment: auth.environment,
    userId: auth.userId,
    connectionId: connection.connectionId,
  },
  favorite: true,
};

type Stream = (
  directory: string,
  options: Parameters<typeof executeManagedLegendary>[3],
  destination: string
) => Promise<void>;
async function fixture(
  t: TestContext,
  stream?: Stream,
  prereq?: boolean,
  platform: NodeJS.Platform = "win32"
) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "hydra-epic-download-"))
  );
  const base = path.join(root, "games");
  await fs.mkdir(base);
  let game = structuredClone(initial);
  let current = true;
  let remoteOwned = true;
  let freeSpace = 100 * 1024 * MIB;
  let diskRequests = 0;
  let download: Download | undefined;
  let downloadRead:
    | ((value: Download | undefined) => Promise<Download | undefined>)
    | undefined;
  let prerequisiteResult = prereq ?? true;
  let prerequisiteCalls = 0;
  const enqueued: Download[] = [];
  const started: Download[] = [];
  const complete = deferred<void>();
  const failed = deferred<unknown>();
  const store = new EpicConnectionStore({
    userDataPath: root,
    createDatabase: () => new MemoryDatabase(),
  });
  await store.save(auth, connection, bundle, () => true);
  const session = new EpicSessionProvider(
    store,
    root,
    async () => "fixture",
    () => current
  );
  const commands: string[][] = [];
  const runtime = new LegendaryManagedRuntime({
    userData: root,
    binary: async () => "fixture",
    session,
    current: () => current,
    execute: async (_binary, args, directory, options) => {
      commands.push(args);
      if (args.includes("list")) {
        await fs.mkdir(path.join(directory, "metadata"), { recursive: true });
        await fs.writeFile(
          path.join(directory, "metadata", "Artifact1.json"),
          JSON.stringify(metadata)
        );
        return { stdout: JSON.stringify([metadata]), stderr: "" };
      }
      if (args.includes("info"))
        return { stdout: JSON.stringify(info), stderr: "" };
      const destination = path.join(base, "EpicGame");
      if (stream) await stream(directory, options, destination);
      else {
        options.onLine?.("[cli] INFO: Download size: 2.00 MiB");
        await fs.mkdir(destination, { recursive: true });
        await fs.writeFile(path.join(destination, "Game.exe"), "fixture-game");
        if (prereq !== undefined)
          await fs.writeFile(
            path.join(destination, "Prerequisite.exe"),
            "fixture-prerequisite"
          );
        await fs.writeFile(
          path.join(directory, "installed.json"),
          JSON.stringify({
            Artifact1: {
              app_name: "Artifact1",
              platform: "Windows",
              install_path: destination,
              executable: "Game.exe",
              install_size: 4 * MIB,
              version: "build-1",
              prereq_info:
                prereq === undefined
                  ? null
                  : {
                      path: "Prerequisite.exe",
                      args: '/quiet "/quoted argument"',
                      installed: false,
                    },
            },
          })
        );
      }
      return { stdout: "", stderr: "" };
    },
  });
  t.mock.method(runtime, "inspect", async (target, _id, signal) => {
    runtime.assertCurrent(target, signal);
    commands.push([
      "info",
      target.artifactId,
      "--json",
      "--platform",
      target.platform,
    ]);
    return { info, metadata };
  });
  t.mock.method(
    runtime,
    "streamInstall",
    (target, _id, _prepared, args, options) =>
      runtime.stream(target, args, options)
  );
  const installation = new EpicInstallationService({
    runtime,
    capture: async () => ({ auth, connection }),
    current: () => current,
    ownGame: async () =>
      remoteOwned
        ? {
            epicImport: {
              connectionId: connection.connectionId,
              artifactIds: ["Artifact1"],
            },
          }
        : null,
    getGame: async () => game,
    updateGame: async (_id, patch) => {
      game = { ...game, ...patch(game) };
      return game;
    },
    platform,
  });
  const service = new EpicDownloadService({
    platform,
    runtime,
    installation,
    getDownload: async () => (downloadRead ? downloadRead(download) : download),
    putDownload: async (_id, value) => {
      download = value;
    },
    startPreparedDownload: async (value) => {
      started.push(value);
    },
    enqueuePreparedDownload: async (value) => {
      enqueued.push(value);
    },
    isGameRunning: () => false,
    getDiskUsage: async () => {
      diskRequests++;
      return { free: freeSpace };
    },
    afterGameUpdated: () => complete.resolve(),
    runPrerequisite: async (_exe, args) => {
      prerequisiteCalls++;
      assert.deepEqual(args, ["/quiet", "/quoted argument"]);
      return prerequisiteResult;
    },
  });
  t.after(async () => {
    await service.stop();
    await runtime.stop();
    await store.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const payload = {
    epicObjectId: objectId,
    connectionId: connection.connectionId,
    artifactId: "Artifact1",
    platform: "Windows" as const,
    downloadPath: base,
  };
  return {
    root,
    base,
    runtime,
    installation,
    service,
    payload,
    complete,
    failed,
    enqueued,
    started,
    commands,
    diskRequests: () => diskRequests,
    disown: () => {
      remoteOwned = false;
    },
    setFreeSpace: (value: number) => {
      freeSpace = value;
    },
    getDownload: () => download,
    getGame: () => game,
    getPrerequisiteCalls: () => prerequisiteCalls,
    invalidate: () => {
      current = false;
    },
    setDownload: (value: Download) => {
      download = value;
    },
    setDownloadRead: (read: typeof downloadRead) => {
      downloadRead = read;
    },
    setPrerequisiteResult: (value: boolean) => {
      prerequisiteResult = value;
    },
  };
}

test("Epic progress carries reused bytes and never infers completion from 100 percent", () => {
  const parser = new EpicDownloadProgressParser(10 * MIB, 2 * MIB);
  parser.line("[cli] INFO: Download size: 6.00 MiB");
  parser.line(
    "[DLManager] INFO: = Progress: 50.00% (50/100), Running for 00:01:00, ETA: 00:00:30"
  );
  parser.line("[DLManager] INFO: - Downloaded: 3.00 MiB, Written: 5.00 MiB");
  parser.line(
    "[DLManager] INFO: + Download\t- 2.00 MiB/s (raw) / 4.00 MiB/s (decompressed)"
  );
  assert.equal(parser.state.progress, 0.7);
  assert.equal(parser.state.bytesDownloaded, 7 * MIB);
  assert.equal(parser.state.downloadSpeed, 2 * MIB);
  assert.equal(parser.state.timeRemaining, 30_000);
  parser.line(
    "= Progress: 100.00% (100/100), Running for 00:01:00, ETA: 00:00:00"
  );
  assert.equal(parser.state.progress, 1);
  parser.line("[cli] INFO: Installation failed after 60 seconds.");
  assert.equal(parser.state.failed, true);
  const unknown = new EpicDownloadProgressParser(1);
  assert.equal(unknown.state.timeRemaining, -1);
});

test("resumed Epic progress preserves persisted chunk completion without inflating transferred bytes", () => {
  const previousProgress = 0.1294018185234835;
  const previousBytes = 70991929.08000012;
  const parser = new EpicDownloadProgressParser(
    1596061835,
    previousBytes,
    previousProgress
  );
  assert.equal(parser.state.progress, previousProgress);
  assert.equal(parser.state.bytesDownloaded, previousBytes);
  parser.line("[cli] INFO: Download size: 1448.08 MiB");
  parser.line("[DLManager] INFO: = Progress: 0.00%, ETA: 00:00:00");
  assert.equal(parser.state.progress, previousProgress);
  assert.ok(
    parser.state.bytesDownloaded < previousProgress * parser.state.fileSize
  );
  parser.line("[DLManager] INFO: = Progress: 20.00%, ETA: 00:00:30");
  assert.ok(parser.state.progress > previousProgress);
  for (const [persisted, expected] of [
    [2, 1],
    [-1, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ]) {
    assert.equal(
      new EpicDownloadProgressParser(1, 0, persisted).state.progress,
      expected
    );
  }
});

test("Epic runtime resume keeps persisted progress during preparation and initial download telemetry", async (t) => {
  const ready = deferred<void>();
  const f = await fixture(t, async (_directory, options) => {
    options.onLine?.("[cli] INFO: Download size: 2.00 MiB");
    options.onLine?.("[DLManager] INFO: = Progress: 0.00%, ETA: 00:00:00");
    ready.resolve();
    await new Promise<void>((resolve) =>
      options.signal.addEventListener("abort", () => resolve(), { once: true })
    );
  });
  await f.service.start(f.payload);
  const persisted = {
    ...f.getDownload()!,
    progress: 0.1294018185234835,
    bytesDownloaded: 0.044479435272005055 * 2 * MIB,
  };
  f.setDownload(persisted);
  await f.service.startRuntime(structuredClone(persisted), (error) =>
    f.failed.resolve(error)
  );
  const preparing = f.service.progress(persisted)!;
  assert.equal(preparing.progress, persisted.progress);
  assert.equal(preparing.download.bytesDownloaded, persisted.bytesDownloaded);
  assert.equal(preparing.download.status, "active");
  await ready.promise;
  const downloading = f.service.progress(persisted)!;
  assert.equal(downloading.progress, persisted.progress);
  assert.equal(downloading.download.bytesDownloaded, persisted.bytesDownloaded);
  await f.service.stop();
});

test("dedicated Epic enqueue preserves imported identity/provenance and separates installed size", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(
    await f.service.start({ ...f.payload, addToQueueOnly: true }),
    { ok: true }
  );
  assert.equal(f.enqueued.length, 1);
  assert.equal(f.started.length, 0);
  assert.equal(f.getDownload()?.downloader, Downloader.Epic);
  assert.equal(f.getDownload()?.uri, "");
  assert.equal(f.getDownload()?.fileSize, 2 * MIB);
  assert.equal(f.getDownload()?.epic?.diskSizeInBytes, 4 * MIB);
  assert.equal(f.getDownload()?.automaticallyExtract, false);
  assert.equal(f.getGame().source, "epic");
  assert.equal(f.getGame().playTimeInMilliseconds, 0);
  assert.equal(f.getGame().epicPlayTimeInMilliseconds, 10_000);
  assert.deepEqual(
    await f.service.start({ ...f.payload, artifactId: "NotOwned" }),
    { ok: false, error: "invalid-artifact" }
  );
  assert.deepEqual(
    await f.service.start({
      ...f.payload,
      connectionId: "DifferentConnection",
    }),
    { ok: false, error: "stale-connection" }
  );
});

test("a prepared preview enqueues without CLI, remote ownership or disk scans", async (t) => {
  const f = await fixture(t);
  const preview = await f.service.getOptions(objectId);
  const count = f.commands.length;
  const capture = t.mock.method(f.installation, "capture", async () => {
    throw new Error("enqueue must reuse the validated preview");
  });
  assert.deepEqual(
    await f.service.start({
      ...f.payload,
      preparationId: preview.options[0].preparationId,
      addToQueueOnly: true,
    }),
    { ok: true }
  );
  assert.equal(f.commands.length, count);
  assert.equal(f.diskRequests(), 0);
  capture.mock.restore();
  f.disown();
  await assert.rejects(
    f.service.startRuntime(f.getDownload()!, () => {}),
    { code: "game-not-owned" }
  );
  assert.equal(
    f.commands.some((args) => args.includes("install")),
    false
  );
});

test("space is checked immediately before transfer even when enqueue reused a preview", async (t) => {
  const f = await fixture(t);
  const preview = await f.service.getOptions(objectId);
  assert.deepEqual(
    await f.service.start({
      ...f.payload,
      preparationId: preview.options[0].preparationId,
    }),
    { ok: true }
  );
  f.setFreeSpace(0);
  await assert.rejects(
    f.service.startRuntime(f.getDownload()!, () => {}),
    { code: "insufficient-space" }
  );
  assert.equal(f.diskRequests(), 1);
  assert.equal(
    f.commands.some((args) => args.includes("install")),
    false
  );
});

test("an incomplete cancelled installation can load options, enqueue and finish its repair", async (t) => {
  const f = await fixture(t);
  const owned = await f.installation.capture(
    objectId,
    new AbortController().signal
  );
  const prepared = await f.installation.prepare(
    owned,
    "Artifact1",
    "Windows",
    new AbortController().signal
  );
  await f.installation.persistPreparation(
    prepared,
    objectId,
    new AbortController().signal
  );
  const destination = path.join(f.base, "EpicGame");
  await fs.mkdir(destination);
  await fs.writeFile(path.join(destination, "Game.exe"), "partial game");
  await fs.writeFile(
    path.join(f.runtime.workspace(prepared.target), "installed.json"),
    JSON.stringify({
      Artifact1: {
        app_name: "Artifact1",
        platform: "Windows",
        install_path: destination,
        executable: "Game.exe",
        install_size: 4 * MIB,
        version: "build-1",
        needs_verification: true,
      },
    })
  );
  const options = await f.service.getOptions(objectId);
  assert.equal(options.error, undefined);
  assert.equal(options.options.length, 1);
  assert.equal(options.options[0].installed, false);
  assert.deepEqual(await f.service.start(f.payload), { ok: true });
  await f.service.startRuntime(f.getDownload()!, (error) =>
    f.failed.resolve(error)
  );
  await f.complete.promise;
  assert.ok(f.commands.some((args) => args.includes("install")));
  assert.ok(
    await f.installation.readInstalled(prepared.target, objectId, destination)
  );
});

test("100 percent before child exit remains active until installed manifest/executable are verified", async (t) => {
  const ready = deferred<void>();
  const finish = deferred<void>();
  const f = await fixture(t, async (directory, options, destination) => {
    options.onLine?.("[cli] INFO: Download size: 2.00 MiB");
    options.onLine?.(
      "= Progress: 100.00% (100/100), Running for 00:00:02, ETA: 00:00:00"
    );
    ready.resolve();
    await finish.promise;
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination, "Game.exe"), "fixture-game");
    await fs.writeFile(
      path.join(directory, "installed.json"),
      JSON.stringify({
        Artifact1: {
          app_name: "Artifact1",
          platform: "Windows",
          install_path: destination,
          executable: "Game.exe",
          install_size: 4 * MIB,
          version: "build-1",
        },
      })
    );
  });
  await f.service.start(f.payload);
  await f.service.startRuntime(f.getDownload()!, (error) =>
    f.failed.resolve(error)
  );
  await ready.promise;
  assert.equal(f.service.progress(f.getDownload()!)?.progress, 1);
  assert.equal(f.service.progress(f.getDownload()!)?.download.status, "active");
  assert.equal(f.getGame().executablePath, undefined);
  finish.resolve();
  await f.complete.promise;
  assert.equal(f.getDownload()?.status, "complete");
  assert.equal(f.getGame().source, "epic");
  assert.ok(f.getGame().executablePath?.endsWith("Game.exe"));
  assert.equal(f.getGame().favorite, true);
});

test("zero exit without a verified installation is an error, never a completion", async (t) => {
  const f = await fixture(t, async (_directory, options) => {
    options.onLine?.("[cli] INFO: Download size: 2.00 MiB");
    options.onLine?.("= Progress: 100.00%");
  });
  await f.service.start(f.payload);
  await f.service.startRuntime(f.getDownload()!, (error) =>
    f.failed.resolve(error)
  );
  assert.equal(
    ((await f.failed.promise) as EpicManagedError).code,
    "installation-incomplete"
  );
  assert.notEqual(f.getDownload()?.status, "complete");
  assert.equal(f.getGame().executablePath, undefined);
});

test("pause waits for downloader termination and preserves partial files", async (t) => {
  const ready = deferred<void>();
  let stopped = false;
  const f = await fixture(t, async (_directory, options, destination) => {
    options.onLine?.("[cli] INFO: Download size: 2.00 MiB");
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination, "partial.bin"), "partial");
    ready.resolve();
    await new Promise<void>((resolve) =>
      options.signal.addEventListener(
        "abort",
        () => {
          setImmediate(() => {
            stopped = true;
            resolve();
          });
        },
        { once: true }
      )
    );
    throw new EpicManagedError("operation-cancelled");
  });
  await f.service.start(f.payload);
  await f.service.startRuntime(f.getDownload()!, (error) =>
    f.failed.resolve(error)
  );
  await ready.promise;
  await f.service.stop();
  assert.equal(stopped, true);
  assert.equal(
    await fs.readFile(path.join(f.base, "EpicGame", "partial.bin"), "utf8"),
    "partial"
  );
  assert.notEqual(f.getDownload()?.status, "complete");
});

test("prerequisite failure keeps installation incomplete and does not mark the prerequisite installed", async (t) => {
  const f = await fixture(t, undefined, false);
  await f.service.start(f.payload);
  await f.service.startRuntime(f.getDownload()!, (error) =>
    f.failed.resolve(error)
  );
  assert.equal(
    ((await f.failed.promise) as EpicManagedError).code,
    "prerequisites-required"
  );
  assert.equal(f.getGame().executablePath, undefined);
  const owned = await f.installation.capture(
    objectId,
    new AbortController().signal
  );
  const raw = JSON.parse(
    await fs.readFile(
      path.join(
        f.runtime.workspace(epicManagedTarget(owned, "Artifact1", "Windows")),
        "installed.json"
      ),
      "utf8"
    )
  );
  assert.equal(raw.Artifact1.prereq_info.installed, false);
});

test("observed prerequisite success finishes installation and persists its installed flag", async (t) => {
  const f = await fixture(t, undefined, true);
  await f.service.start(f.payload);
  await f.service.startRuntime(f.getDownload()!, (error) =>
    f.failed.resolve(error)
  );
  await f.complete.promise;
  const owned = await f.installation.capture(
    objectId,
    new AbortController().signal
  );
  const raw = JSON.parse(
    await fs.readFile(
      path.join(
        f.runtime.workspace(epicManagedTarget(owned, "Artifact1", "Windows")),
        "installed.json"
      ),
      "utf8"
    )
  );
  assert.equal(raw.Artifact1.prereq_info.installed, true);
  assert.equal(f.getDownload()?.status, "complete");
});

test("disk reuse calculation does not follow external junctions", async (t) => {
  const f = await fixture(t);
  const inside = path.join(f.base, "EpicGame");
  const outside = path.join(f.root, "Outside");
  await fs.mkdir(inside);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(inside, "part"), "1234");
  assert.equal(await getReusableEpicDiskBytes(inside), 4);
  await fs.symlink(outside, path.join(inside, "outside"), "junction");
  await assert.rejects(getReusableEpicDiskBytes(inside), {
    code: "invalid-path",
  });
});

test("Windows prerequisite argument quoting preserves spaces, quotes, trailing backslashes and shell literals", () => {
  assert.equal(quoteWindowsEpicArgument("/quiet"), '"/quiet"');
  assert.equal(
    quoteWindowsEpicArgument("C:\\Game Path\\"),
    '"C:\\Game Path\\\\"'
  );
  assert.equal(quoteWindowsEpicArgument('with"quote'), '"with\\"quote"');
  assert.equal(
    quoteWindowsEpicArgument("$(secret) & value"),
    '"$(secret) & value"'
  );
});

test("direct prerequisite success uses observed process completion", async () => {
  assert.equal(
    await runEpicPrerequisite(
      process.execPath,
      ["-e", "process.exit(0)"],
      new AbortController().signal
    ),
    true
  );
});

test("resume repairs an installed manifest left needing verification", async (t) => {
  const f = await fixture(t);
  await f.service.start(f.payload);
  const owned = await f.installation.capture(
    objectId,
    new AbortController().signal
  );
  const target = epicManagedTarget(owned, "Artifact1", "Windows");
  const prepared = await f.installation.prepare(
    owned,
    "Artifact1",
    "Windows",
    new AbortController().signal
  );
  await f.installation.persistPreparation(
    prepared,
    objectId,
    new AbortController().signal
  );
  const destination = path.join(f.base, "EpicGame");
  await fs.mkdir(destination);
  await fs.writeFile(path.join(destination, "Game.exe"), "partial");
  await fs.writeFile(
    path.join(f.runtime.workspace(target), "installed.json"),
    JSON.stringify({
      Artifact1: {
        app_name: "Artifact1",
        platform: "Windows",
        install_path: destination,
        executable: "Game.exe",
        install_size: 4 * MIB,
        version: "build-1",
        needs_verification: true,
      },
    })
  );
  await f.service.startRuntime(f.getDownload()!, (error) =>
    f.failed.resolve(error)
  );
  await f.complete.promise;
  assert.equal(f.commands.filter((args) => args.includes("install")).length, 1);
  assert.equal(f.getDownload()?.status, "complete");
});

test("retry after prerequisite failure completes without downloading the same build again", async (t) => {
  const f = await fixture(t, undefined, false);
  await f.service.start(f.payload);
  await f.service.startRuntime(f.getDownload()!, (error) =>
    f.failed.resolve(error)
  );
  assert.equal(
    ((await f.failed.promise) as EpicManagedError).code,
    "prerequisites-required"
  );
  await f.service.stop();
  f.setPrerequisiteResult(true);
  f.setDownload({
    ...f.getDownload()!,
    status: "error",
    progress: 1,
    bytesDownloaded: 2 * MIB,
  });
  await f.service.startRuntime(f.getDownload()!, (error) =>
    f.failed.resolve(error)
  );
  await f.complete.promise;
  assert.equal(f.commands.filter((args) => args.includes("install")).length, 1);
  assert.equal(f.getDownload()?.status, "complete");
});

test("Linux download completes without preparing Wine, Proton or Windows prerequisites", async (t) => {
  const f = await fixture(t, undefined, false, "linux");
  await f.service.start(f.payload);
  await f.service.startRuntime(f.getDownload()!, (error) =>
    f.failed.resolve(error)
  );
  await f.complete.promise;
  const owned = await f.installation.capture(
    objectId,
    new AbortController().signal
  );
  const installed = await f.installation.readInstalled(
    epicManagedTarget(owned, "Artifact1", "Windows"),
    objectId
  );
  assert.equal(f.getDownload()?.status, "complete");
  assert.equal(f.getDownload()?.progress, 1);
  assert.ok(f.getGame().epicInstallation);
  assert.ok(f.getGame().executablePath?.endsWith("Game.exe"));
  assert.equal(f.getGame().winePrefixPath, undefined);
  assert.equal(f.getPrerequisiteCalls(), 0);
  assert.equal(installed?.prereq_info?.installed, false);
  assert.equal(f.commands.filter((args) => args.includes("install")).length, 1);
});

for (const error of [
  "compatibility-prefix-busy",
  "compatibility-runtime-unavailable",
] as const) {
  test(`Linux retry after ${error} completes the existing transfer without compatibility setup`, async (t) => {
    const f = await fixture(t, undefined, false, "linux");
    await f.service.start(f.payload);
    const owned = await f.installation.capture(
      objectId,
      new AbortController().signal
    );
    const target = epicManagedTarget(owned, "Artifact1", "Windows");
    const prepared = await f.installation.prepare(
      owned,
      "Artifact1",
      "Windows",
      new AbortController().signal
    );
    await f.installation.persistPreparation(
      prepared,
      objectId,
      new AbortController().signal
    );
    const destination = path.join(f.base, "EpicGame");
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination, "Game.exe"), "downloaded-game");
    await fs.writeFile(
      path.join(f.runtime.workspace(target), "installed.json"),
      JSON.stringify({
        Artifact1: {
          app_name: "Artifact1",
          platform: "Windows",
          install_path: destination,
          executable: "Game.exe",
          install_size: 4 * MIB,
          version: "build-1",
          prereq_info: {
            path: "Prerequisite.exe",
            args: "/quiet",
            installed: false,
          },
        },
      })
    );
    f.setDownload({
      ...f.getDownload()!,
      status: "error",
      progress: 0.9907,
      bytesDownloaded: 2 * MIB,
      epic: { ...f.getDownload()!.epic!, phase: "prerequisites", error },
    });
    await f.service.startRuntime(f.getDownload()!, (failure) =>
      f.failed.resolve(failure)
    );
    await f.complete.promise;
    assert.equal(
      f.commands.filter((args) => args.includes("install")).length,
      0
    );
    assert.equal(f.getPrerequisiteCalls(), 0);
    assert.equal(f.getDownload()?.status, "complete");
    assert.equal(f.getDownload()?.progress, 1);
    assert.equal(f.getDownload()?.bytesDownloaded, 2 * MIB);
    assert.equal(f.getDownload()?.epic?.error, undefined);
    assert.ok(f.getGame().epicInstallation);
    assert.equal(
      await fs.readFile(path.join(destination, "Game.exe"), "utf8"),
      "downloaded-game"
    );
  });
}

test("pause during finalization record read cannot publish completion afterwards", async (t) => {
  const f = await fixture(t);
  const reading = deferred<void>();
  const release = deferred<void>();
  await f.service.start(f.payload);
  f.setDownloadRead(async (value) => {
    reading.resolve();
    await release.promise;
    return value;
  });
  await f.service.startRuntime(f.getDownload()!, (error) =>
    f.failed.resolve(error)
  );
  await reading.promise;
  const stopping = f.service.stop();
  release.resolve();
  await stopping;
  assert.notEqual(f.getDownload()?.status, "complete");
  assert.equal(f.service.progress(f.getDownload()!), null);
});

test("finalization cannot overwrite a replacement download in the same connection", async (t) => {
  const f = await fixture(t);
  await f.service.start(f.payload);
  const original = f.getDownload()!;
  const replacement = {
    ...original,
    timestamp: original.timestamp! + 1,
    progress: 0.2,
  };
  f.setDownloadRead(async () => {
    f.setDownload(replacement);
    return replacement;
  });
  await f.service.startRuntime(original, (error) => f.failed.resolve(error));
  assert.equal(
    ((await f.failed.promise) as EpicManagedError).code,
    "operation-cancelled"
  );
  assert.equal(f.getDownload()?.timestamp, replacement.timestamp);
  assert.equal(f.getDownload()?.progress, 0.2);
});

test("failed file removal preserves the installed manifest and permits retry", async (t) => {
  const f = await fixture(t);
  await f.service.start(f.payload);
  await f.service.startRuntime(f.getDownload()!, (error) =>
    f.failed.resolve(error)
  );
  await f.complete.promise;
  await f.service.stop();
  const owned = await f.installation.capture(
    objectId,
    new AbortController().signal
  );
  const target = epicManagedTarget(owned, "Artifact1", "Windows");
  await assert.rejects(
    f.service.forgetInstallation(f.getDownload()!, async () => {
      throw new Error("file removal failed");
    })
  );
  assert.ok(await f.installation.readInstalled(target, objectId));
  await f.service.forgetInstallation(f.getDownload()!, async () => {
    await fs.rm(path.join(f.base, "EpicGame"), { recursive: true });
  });
  assert.equal(await f.installation.readInstalled(target, objectId), null);
});

test("file removal holds the workspace and blocks restarting the same download", async (t) => {
  const f = await fixture(t);
  await f.service.start(f.payload);
  await f.service.startRuntime(f.getDownload()!, (error) =>
    f.failed.resolve(error)
  );
  await f.complete.promise;
  await f.service.stop();
  const ready = deferred<void>();
  const release = deferred<void>();
  const removal = f.service.forgetInstallation(f.getDownload()!, async () => {
    ready.resolve();
    await release.promise;
  });
  await ready.promise;
  assert.deepEqual(await f.service.start(f.payload), {
    ok: false,
    error: "operation-in-progress",
  });
  await assert.rejects(
    f.service.startRuntime(f.getDownload()!, () => {}),
    { code: "operation-in-progress" }
  );
  release.resolve();
  await removal;
});
