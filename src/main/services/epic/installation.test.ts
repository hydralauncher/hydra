import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import type { Game } from "../../../types/level.types";
import {
  EpicInstallationService,
  epicManagedTarget,
  parseEpicInstallInfo,
  validateEpicMetadata,
} from "./installation.js";
import {
  EpicManagedError,
  LegendaryManagedRuntime,
} from "./legendary-managed-runtime.js";
import { EPIC_INSTALL_OPTIONS_CACHE_MS } from "./constants.js";
import { EpicSessionProvider } from "./session-provider.js";
import { EpicConnectionStore } from "./store.js";
import { MemoryDatabase, bundle, connection } from "./store-test-helpers.js";

const objectId = "Namespace1:Item1";
const auth = {
  environment: "https://api.example.test",
  userId: "managed-test",
  generation: 1,
};
const info = {
  game: {
    app_name: "Artifact1",
    version: "build-1",
    is_dlc: false,
    external_activation: "No",
    cloud_saves_supported: true,
  },
  manifest: { download_size: 100, disk_size: 1000, is_preloaded: false },
};
const metadata = {
  app_name: "Artifact1",
  metadata: {
    namespace: "Namespace1",
    id: "Item1",
    categories: [{ path: "games" }],
    customAttributes: {
      FolderName: { value: "EpicGame" },
      CloudSaveFolder: { value: "{appdata}/Game" },
    },
  },
  asset_infos: {
    Windows: {
      app_name: "Artifact1",
      namespace: "Namespace1",
      catalog_item_id: "Item1",
    },
  },
};
const game: Game = {
  title: "Game",
  objectId,
  shop: "epic",
  source: "epic",
  remoteId: "remote",
  iconUrl: null,
  logoImageUrl: null,
  libraryHeroImageUrl: null,
  playTimeInMilliseconds: 0,
  epicPlayTimeInMilliseconds: 120_000,
  lastTimePlayed: null,
  isDeleted: false,
  hasActiveEpicImport: true,
  epicImportScope: {
    environment: auth.environment,
    userId: auth.userId,
    connectionId: connection.connectionId,
  },
};

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-epic-install-"));
  let local = structuredClone(game);
  let remoteOwned = true;
  let activeAuth = auth;
  let infoResponse = structuredClone(info);
  let failInfo = false;
  let ownershipRequests = 0;
  const db = new MemoryDatabase();
  const store = new EpicConnectionStore({
    userDataPath: root,
    createDatabase: () => db,
  });
  await store.save(auth, connection, bundle, () => true);
  const session = new EpicSessionProvider(
    store,
    root,
    async () => "fixture",
    () => true
  );
  const commands: string[][] = [];
  const runtime = new LegendaryManagedRuntime({
    userData: root,
    binary: async () => "fixture",
    session,
    current: (target) => target.auth.generation === activeAuth.generation,
    execute: async (_binary, args, directory) => {
      commands.push(args);
      if (args.includes("list")) {
        await fs.mkdir(path.join(directory, "metadata"), { recursive: true });
        await fs.writeFile(
          path.join(directory, "metadata", "Artifact1.json"),
          JSON.stringify(metadata)
        );
        return { stdout: JSON.stringify([metadata]), stderr: "" };
      }
      if (failInfo) throw new EpicManagedError("network");
      return { stdout: JSON.stringify(infoResponse), stderr: "" };
    },
  });
  const service = new EpicInstallationService({
    runtime,
    capture: async () => ({ auth: activeAuth, connection }),
    captureLocal: () => ({ auth: activeAuth, connection }),
    current: (context) => context.auth.generation === activeAuth.generation,
    ownGame: async () => {
      ownershipRequests++;
      return remoteOwned
        ? {
            epicImport: {
              connectionId: connection.connectionId,
              artifactIds: ["Artifact1"],
            },
          }
        : null;
    },
    getGame: async () => local,
    updateGame: async (_id, patch) => {
      local = { ...local, ...patch(local) };
      return local;
    },
    platform: "win32",
  });
  t.after(async () => {
    await runtime.stop();
    await store.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const owned = await service.capture(objectId, new AbortController().signal);
  const target = epicManagedTarget(owned, "Artifact1", "Windows");
  return {
    root,
    service,
    runtime,
    target,
    owned,
    commands,
    getGame: () => local,
    setGame: (value: Game) => {
      local = value;
    },
    disown: () => {
      remoteOwned = false;
    },
    nextGeneration: () => {
      activeAuth = { ...activeAuth, generation: activeAuth.generation + 1 };
    },
    failInfo: (value: boolean) => {
      failInfo = value;
    },
    setInfo: (value: typeof info) => {
      infoResponse = value;
    },
    ownershipRequests: () => ownershipRequests,
  };
}

test("installation options prove exact alias identity and separate download/disk sizes", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.service.getOptions(objectId), {
    connectionId: connection.connectionId,
    options: [
      {
        artifactId: "Artifact1",
        platform: "Windows",
        downloadSizeInBytes: 100,
        diskSizeInBytes: 1000,
        supportsCloudSaves: true,
        installed: false,
      },
    ],
  });
  assert.equal(f.commands.filter((args) => args.includes("list")).length, 1);
  await f.service.getOptions(objectId);
  assert.equal(
    f.commands.filter((args) => args.includes("list")).length,
    1,
    "verified metadata can be reused for the same owner/alias/platform"
  );
  assert.equal(f.commands.filter((args) => args.includes("info")).length, 1);
});

test("preview prefetch and modal coalesce commands and reuse successful options without remote requests", async (t) => {
  const f = await fixture(t);
  const requests = f.ownershipRequests();
  const [prefetched, modal] = await Promise.all([
    f.service.getOptions(objectId),
    f.service.getOptions(objectId),
  ]);
  assert.deepEqual(modal, prefetched);
  assert.equal(f.commands.filter((args) => args.includes("info")).length, 1);
  assert.equal(f.ownershipRequests(), requests + 1);
  prefetched.options[0].downloadSizeInBytes = 999;
  const reopened = await f.service.getOptions(objectId);
  assert.equal(reopened.options[0].downloadSizeInBytes, 100);
  assert.equal(f.commands.filter((args) => args.includes("info")).length, 1);
  assert.equal(f.ownershipRequests(), requests + 1);
});

test("preview expires and is never reused across auth generations or a removed local import", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = await fixture(t);
  await f.service.getOptions(objectId);
  now += EPIC_INSTALL_OPTIONS_CACHE_MS;
  await f.service.getOptions(objectId);
  assert.equal(f.commands.filter((args) => args.includes("info")).length, 2);
  f.nextGeneration();
  await f.service.getOptions(objectId);
  assert.equal(f.commands.filter((args) => args.includes("info")).length, 3);
  f.setGame({ ...f.getGame(), hasActiveEpicImport: false });
  assert.deepEqual(await f.service.getOptions(objectId), {
    options: [],
    error: "game-not-owned",
  });
});

test("preview failures are retryable and fresh prepare/ownership do not trust cached options", async (t) => {
  const f = await fixture(t);
  f.failInfo(true);
  assert.equal((await f.service.getOptions(objectId)).error, "network");
  f.failInfo(false);
  assert.equal((await f.service.getOptions(objectId)).options.length, 1);
  f.setInfo({
    ...info,
    game: { ...info.game, version: "build-2" },
    manifest: { ...info.manifest, download_size: 200, disk_size: 2000 },
  });
  const prepared = await f.service.prepare(
    f.owned,
    "Artifact1",
    "Windows",
    new AbortController().signal
  );
  assert.equal(prepared.version, "build-2");
  assert.equal(prepared.downloadSizeInBytes, 200);
  assert.equal(prepared.diskSizeInBytes, 2000);
  assert.equal(f.commands.filter((args) => args.includes("info")).length, 3);
  f.disown();
  await assert.rejects(
    f.service.capture(objectId, new AbortController().signal),
    { code: "game-not-owned" }
  );
});

test("install info rejects external platforms, DLC, preload and invalid sizes", () => {
  assert.deepEqual(parseEpicInstallInfo(info, "Artifact1"), {
    downloadSizeInBytes: 100,
    diskSizeInBytes: 1000,
    supportsCloudSaves: true,
    version: "build-1",
  });
  for (const value of [
    { ...info, game: { ...info.game, external_activation: "uplay" } },
    { ...info, game: { ...info.game, is_dlc: true } },
    { ...info, manifest: { ...info.manifest, is_preloaded: true } },
    { ...info, manifest: { ...info.manifest, disk_size: -1 } },
  ])
    assert.throws(() => parseEpicInstallInfo(value, "Artifact1"));
});

test("metadata does not associate by title or namespace alone", async (t) => {
  const f = await fixture(t);
  validateEpicMetadata(metadata, f.target, objectId);
  assert.throws(
    () => validateEpicMetadata(metadata, f.target, "Namespace1:DifferentItem"),
    { code: "invalid-artifact" }
  );
  assert.throws(
    () =>
      validateEpicMetadata(
        {
          ...metadata,
          asset_infos: {
            Windows: {
              ...metadata.asset_infos.Windows,
              catalog_item_id: "DifferentItem",
            },
          },
        },
        f.target,
        objectId
      ),
    { code: "invalid-artifact" }
  );
  assert.throws(
    () =>
      validateEpicMetadata(
        {
          ...metadata,
          metadata: { ...metadata.metadata, mainGameItem: { id: "base" } },
        },
        f.target,
        objectId
      ),
    { code: "not-installable" }
  );
});

test("installation rejects missing remote ownership and unsupported builds", async (t) => {
  const f = await fixture(t);
  f.disown();
  await assert.rejects(
    f.service.capture(objectId, new AbortController().signal),
    { code: "game-not-owned" }
  );
  assert.throws(() => f.service.assertPlatform("Mac"), {
    code: "unsupported-platform",
  });
});

test("installed metadata binds the manifest executable preserving import provenance/time/preferences", async (t) => {
  const f = await fixture(t);
  await f.service.prepare(
    f.owned,
    "Artifact1",
    "Windows",
    new AbortController().signal
  );
  const installPath = path.join(f.root, "EpicGame");
  await fs.mkdir(path.join(installPath, "bin"), { recursive: true });
  await fs.writeFile(path.join(installPath, "bin", "Game.exe"), "game");
  const installed = {
    app_name: "Artifact1",
    platform: "Windows",
    install_path: installPath,
    executable: "/bin/Game.exe",
    install_size: 1000,
    version: "build-1",
    is_dlc: false,
    needs_verification: false,
  };
  await fs.writeFile(
    path.join(f.runtime.workspace(f.target), "installed.json"),
    JSON.stringify({ Artifact1: installed })
  );
  f.setGame({
    ...f.getGame(),
    favorite: true,
    customIconUrl: "custom-icon",
    playTimeInMilliseconds: 5000,
  });
  const verified = await f.service.readInstalled(
    f.target,
    objectId,
    installPath
  );
  assert.ok(verified);
  await f.service.bind(f.owned, f.target, verified);
  assert.equal(
    f.getGame().executablePath,
    await fs.realpath(path.join(installPath, "bin", "Game.exe"))
  );
  assert.equal(f.getGame().source, "epic");
  assert.equal(f.getGame().playTimeInMilliseconds, 5000);
  assert.equal(f.getGame().epicPlayTimeInMilliseconds, 120_000);
  assert.equal(f.getGame().favorite, true);
  assert.equal(f.getGame().customIconUrl, "custom-icon");
  assert.equal(
    (await f.service.getOptions(objectId)).options[0].installed,
    true
  );
  await fs.writeFile(
    path.join(f.runtime.workspace(f.target), "installed.json"),
    JSON.stringify({ Artifact1: { ...installed, needs_verification: true } })
  );
  const cachedOptions = await f.service.getOptions(objectId);
  assert.equal(cachedOptions.error, undefined);
  assert.equal(cachedOptions.options[0].installed, false);
  await assert.rejects(f.service.readInstalled(f.target, objectId), {
    code: "installation-incomplete",
  });
  await assert.rejects(
    f.service.readInstalledForRepair(f.target, objectId, f.root),
    {
      code: "invalid-path",
    }
  );
  for (const executable of [
    "../escape.exe",
    "C:\\outside\\Game.exe",
    "//server/share/Game.exe",
  ]) {
    await fs.writeFile(
      path.join(f.runtime.workspace(f.target), "installed.json"),
      JSON.stringify({
        Artifact1: { ...installed, executable, needs_verification: true },
      })
    );
    await assert.rejects(f.service.readInstalled(f.target, objectId), {
      code: "invalid-path",
    });
    await assert.rejects(f.service.readInstalledForRepair(f.target, objectId), {
      code: "invalid-path",
    });
  }
});

test("installed executable realpath cannot escape through a directory junction", async (t) => {
  const f = await fixture(t);
  await f.service.prepare(
    f.owned,
    "Artifact1",
    "Windows",
    new AbortController().signal
  );
  const installPath = path.join(f.root, "EpicGame");
  const outside = path.join(f.root, "Outside");
  await fs.mkdir(installPath);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "Game.exe"), "outside");
  await fs.symlink(outside, path.join(installPath, "escape"), "junction");
  await fs.writeFile(
    path.join(f.runtime.workspace(f.target), "installed.json"),
    JSON.stringify({
      Artifact1: {
        app_name: "Artifact1",
        platform: "Windows",
        install_path: installPath,
        executable: "escape/Game.exe",
        install_size: 1000,
        version: "build-1",
      },
    })
  );
  assert.equal(await f.service.readInstalled(f.target, objectId), null);
});
