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
  type executeManagedLegendary,
} from "./legendary-managed-runtime.js";
import {
  EPIC_INSTALL_OPTIONS_CACHE_MS,
  EPIC_INSTALL_OPTIONS_CACHE_MAX_ENTRIES,
  EPIC_INSTALL_OPTIONS_TIMEOUT_MS,
} from "./constants.js";
import { EpicSessionProvider } from "./session-provider.js";
import { EpicConnectionStore } from "./store.js";
import {
  MemoryDatabase,
  bundle,
  connection,
  deferred,
} from "./store-test-helpers.js";

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
type FixtureMetadata = Omit<typeof metadata, "metadata" | "asset_infos"> & {
  metadata: Omit<typeof metadata.metadata, "customAttributes"> & {
    customAttributes: Record<string, { value: string; type?: string }>;
  };
  asset_infos: Record<string, typeof metadata.asset_infos.Windows>;
};
const squadronsMetadata = {
  app_name: "bobcat",
  app_title: "Star Wars Squadrons",
  metadata: {
    namespace: "bc2b0372eaa448469cb9a769f27acea1",
    id: "8cf2931625ac41cead9f0baf2c3fdfde",
    categories: [
      { path: "public" },
      { path: "games" },
      { path: "applications" },
    ],
    customAttributes: {
      ThirdPartyManagedApp: { type: "STRING", value: "Origin" },
    },
  },
  asset_infos: {},
};
const squadronsObjectId = `${squadronsMetadata.metadata.namespace}:${squadronsMetadata.metadata.id}`;
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

async function fixture(t: TestContext, platform: NodeJS.Platform = "win32") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-epic-install-"));
  let local = structuredClone(game);
  let remoteOwned = true;
  let activeAuth = auth;
  let localAuth: typeof auth | undefined;
  let infoResponse = structuredClone(info);
  let failInfo = false;
  let verifyOutput = "[cli] INFO: Verification finished successfully.";
  let ownershipRequests = 0;
  const games = new Map<string, Game>();
  const library: FixtureMetadata[] = [structuredClone(metadata)];
  let beforeExecute:
    | ((
        args: string[],
        options: Parameters<typeof executeManagedLegendary>[3]
      ) => Promise<void>)
    | undefined;
  let beforeCapture: (() => Promise<void>) | undefined;
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
    execute: async (_binary, args, directory, options) => {
      commands.push(args);
      await beforeExecute?.(args, options);
      if (args.includes("list")) {
        await fs.mkdir(path.join(directory, "metadata"), { recursive: true });
        await Promise.all(
          library.map((entry) =>
            fs.writeFile(
              path.join(directory, "metadata", `${entry.app_name}.json`),
              JSON.stringify(entry)
            )
          )
        );
        return { stdout: JSON.stringify(library), stderr: "" };
      }
      if (args.includes("verify")) return { stdout: "", stderr: verifyOutput };
      if (failInfo) throw new EpicManagedError("network");
      return {
        stdout: JSON.stringify({
          ...infoResponse,
          game: { ...infoResponse.game, app_name: args[3] },
        }),
        stderr: "",
      };
    },
  });
  t.mock.method(runtime, "inspect", async (target, id, signal) => {
    const entry = library.find((entry) => entry.app_name === target.artifactId);
    const verified = validateEpicMetadata(entry, target, id);
    const args = [
      "--config",
      root,
      "info",
      target.artifactId,
      "--json",
      "--platform",
      target.platform,
    ];
    commands.push(args);
    await beforeExecute?.(args, {
      signal,
      timeout: EPIC_INSTALL_OPTIONS_TIMEOUT_MS,
    });
    runtime.assertCurrent(target, signal);
    if (failInfo) throw new EpicManagedError("network");
    return {
      info: {
        ...infoResponse,
        game: { ...infoResponse.game, app_name: target.artifactId },
      },
      metadata: verified,
    };
  });
  const service = new EpicInstallationService({
    runtime,
    capture: async () => {
      await beforeCapture?.();
      return { auth: activeAuth, connection };
    },
    captureLocal: () => ({ auth: localAuth ?? activeAuth, connection }),
    current: (context) => context.auth.generation === activeAuth.generation,
    ownGame: async (_context, id) => {
      ownershipRequests++;
      return remoteOwned
        ? {
            epicImport: {
              connectionId: connection.connectionId,
              artifactIds: library
                .filter(
                  (entry) =>
                    `${entry.metadata.namespace}:${entry.metadata.id}` === id
                )
                .map((entry) => entry.app_name),
            },
          }
        : null;
    },
    getGame: async (id) => (id === local.objectId ? local : games.get(id)),
    updateGame: async (_id, patch) => {
      local = { ...local, ...patch(local) };
      return local;
    },
    platform,
    architecture: "x64",
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
    session,
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
    useStaleLocalContext: () => {
      localAuth = auth;
    },
    failInfo: (value: boolean) => {
      failInfo = value;
    },
    setVerifyOutput: (value: string) => {
      verifyOutput = value;
    },
    setInfo: (value: typeof info) => {
      infoResponse = value;
    },
    ownershipRequests: () => ownershipRequests,
    addGame: (id: string, artifactId: string) => {
      games.set(id, { ...structuredClone(game), objectId: id });
      const [namespace, item] = id.split(":");
      library.push({
        ...structuredClone(metadata),
        app_name: artifactId,
        metadata: {
          ...structuredClone(metadata.metadata),
          namespace,
          id: item,
        },
        asset_infos: {
          Windows: { app_name: artifactId, namespace, catalog_item_id: item },
        },
      });
    },
    addMetadata: (entry: FixtureMetadata) => {
      const id = `${entry.metadata.namespace}:${entry.metadata.id}`;
      games.set(id, { ...structuredClone(game), objectId: id });
      library.push(structuredClone(entry));
    },
    beforeExecute: (hook: typeof beforeExecute) => {
      beforeExecute = hook;
    },
    beforeCapture: (hook: typeof beforeCapture) => {
      beforeCapture = hook;
    },
  };
}

test("installation options prove exact alias identity and separate download/disk sizes", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.service.getOptions(objectId), {
    connectionId: connection.connectionId,
    options: [
      {
        preparationId: (await f.service.getOptions(objectId)).options[0]
          .preparationId,
        artifactId: "Artifact1",
        platform: "Windows",
        downloadSizeInBytes: 100,
        diskSizeInBytes: 1000,
        supportsCloudSaves: true,
        installed: false,
      },
    ],
  });
  assert.equal(f.commands.filter((args) => args.includes("list")).length, 0);
  await f.service.getOptions(objectId);
  assert.equal(
    f.commands.filter((args) => args.includes("list")).length,
    0,
    "verified metadata can be reused for the same owner/alias/platform"
  );
  assert.equal(f.commands.filter((args) => args.includes("info")).length, 1);
});

test("Linux x64 resolves owned Windows builds with the same installation validations", async (t) => {
  const f = await fixture(t, "linux");
  const options = await f.service.getOptions(objectId);
  assert.equal(options.options[0].platform, "Windows");
  assert.equal(options.options[0].artifactId, "Artifact1");
  f.disown();
  await assert.rejects(
    f.service.capture(objectId, new AbortController().signal),
    { code: "game-not-owned" }
  );
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

test("preview rechecks the connection when its local context is not confirmed current", async (t) => {
  const f = await fixture(t);
  f.nextGeneration();
  f.useStaleLocalContext();
  assert.equal((await f.service.getOptions(objectId)).options.length, 1);
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

test("cancelling one preview consumer preserves another consumer of the same game", async (t) => {
  const f = await fixture(t);
  const entered = deferred<AbortSignal>();
  const finish = deferred<void>();
  f.beforeExecute(async (args, options) => {
    if (args.includes("info")) {
      entered.resolve(options.signal);
      await finish.promise;
    }
  });
  t.after(() => finish.resolve());
  const controller = new AbortController();
  const prefetch = f.service.getOptions(objectId, controller.signal);
  const modal = f.service.getOptions(objectId);
  const processSignal = await entered.promise;
  controller.abort();
  assert.equal((await prefetch).error, "operation-cancelled");
  assert.equal(processSignal.aborted, false);
  finish.resolve();
  assert.equal((await modal).options.length, 1);
  assert.equal(f.commands.filter((args) => args.includes("info")).length, 1);
});

test("cancelling the last preview consumer aborts work and reopening immediately retries", async (t) => {
  const f = await fixture(t);
  const entered = deferred<AbortSignal>();
  const stopped = deferred<void>();
  f.beforeExecute(async (args, options) => {
    if (!args.includes("info")) return;
    entered.resolve(options.signal);
    await new Promise<void>((_resolve, reject) =>
      options.signal.addEventListener(
        "abort",
        () => {
          stopped.resolve();
          reject(new EpicManagedError("operation-cancelled"));
        },
        { once: true }
      )
    );
  });
  const controller = new AbortController();
  const pending = f.service.getOptions(objectId, controller.signal);
  const processSignal = await entered.promise;
  controller.abort();
  assert.equal((await pending).error, "operation-cancelled");
  await stopped.promise;
  assert.equal(processSignal.aborted, true);
  f.beforeExecute(undefined);
  assert.equal((await f.service.getOptions(objectId)).options.length, 1);
  assert.equal(f.commands.filter((args) => args.includes("info")).length, 2);
});

test("cancelling a capture releases connection cleanup before the captured query resolves without checking ownership", async (t) => {
  const f = await fixture(t);
  const entered = deferred<void>();
  const releaseQuery = deferred<void>();
  let querySettled = false;
  f.beforeCapture(async () => {
    entered.resolve();
    await releaseQuery.promise;
    querySettled = true;
  });
  const ownershipRequests = f.ownershipRequests();
  const controller = new AbortController();
  const pending = f.service.capture(objectId, controller.signal);
  let cleanupSettled = false;
  const cleanup = assert
    .rejects(pending, { code: "operation-cancelled" })
    .then(() => {
      cleanupSettled = true;
    });
  await entered.promise;
  controller.abort();
  try {
    // A connection transition waits for launch cleanup before resolving its
    // query. Cancellation must break that dependency without awaiting the query.
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(cleanupSettled, true);
    assert.equal(querySettled, false);
    assert.equal(f.ownershipRequests(), ownershipRequests);
    assert.equal(f.commands.length, 0);
  } finally {
    releaseQuery.resolve();
    await cleanup;
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(querySettled, true);
  assert.equal(f.ownershipRequests(), ownershipRequests);
  f.beforeCapture(undefined);
  await f.service.capture(objectId, new AbortController().signal);
  assert.equal(f.ownershipRequests(), ownershipRequests + 1);
});
test("preview deadline includes connection capture and a timeout remains retryable", async (t) => {
  const f = await fixture(t);
  const entered = deferred<void>();
  const release = deferred<void>();
  f.beforeCapture(async () => {
    entered.resolve();
    await release.promise;
  });
  t.after(() => release.resolve());
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = f.service.getOptions(objectId);
  await entered.promise;
  t.mock.timers.tick(EPIC_INSTALL_OPTIONS_TIMEOUT_MS);
  assert.deepEqual(await pending, { options: [], error: "timeout" });
  f.beforeCapture(undefined);
  release.resolve();
  assert.equal((await f.service.getOptions(objectId)).options.length, 1);
});

test("different previews inspect only their selected aliases and do not mutate installation workspaces", async (t) => {
  const f = await fixture(t);
  const secondId = "Namespace2:Item2";
  f.addGame(secondId, "Artifact2");
  const [first, second] = await Promise.all([
    f.service.getOptions(objectId),
    f.service.getOptions(secondId),
  ]);
  assert.equal(first.options[0].artifactId, "Artifact1");
  assert.equal(second.options[0].artifactId, "Artifact2");
  assert.deepEqual(f.commands.map((args) => args[3]).sort(), [
    "Artifact1",
    "Artifact2",
  ]);
  assert.equal(
    f.commands.some((args) => args.includes("list")),
    false
  );
  await assert.rejects(fs.stat(f.runtime.workspace(f.target)), {
    code: "ENOENT",
  });
});

test("preparation receipts reuse only the exact validated local context and expire conservatively", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const f = await fixture(t);
  const options = await f.service.getOptions(objectId);
  const payload = {
    epicObjectId: objectId,
    connectionId: connection.connectionId,
    artifactId: "Artifact1",
    platform: "Windows" as const,
    preparationId: options.options[0].preparationId,
    downloadPath: f.root,
  };
  const count = f.commands.length;
  const requests = f.ownershipRequests();
  assert.equal(
    (await f.service.resolvePreparation(payload, new AbortController().signal))
      .prepared.preparationId,
    payload.preparationId
  );
  assert.equal(f.commands.length, count);
  assert.equal(f.ownershipRequests(), requests);
  now += EPIC_INSTALL_OPTIONS_CACHE_MS;
  const refreshed = await f.service.resolvePreparation(
    payload,
    new AbortController().signal
  );
  assert.notEqual(refreshed.prepared.preparationId, payload.preparationId);
  assert.equal(f.commands.length, count + 1);
  assert.equal(f.ownershipRequests(), requests + 1);
  f.setGame({ ...f.getGame(), hasActiveEpicImport: false });
  await assert.rejects(
    f.service.resolvePreparation(
      { ...payload, preparationId: refreshed.prepared.preparationId },
      new AbortController().signal
    ),
    { code: "game-not-owned" }
  );
});

test("an old renderer reuses the same validated preparation without a receipt field", async (t) => {
  const f = await fixture(t);
  await f.service.getOptions(objectId);
  const commands = f.commands.length;
  await f.service.resolvePreparation(
    {
      epicObjectId: objectId,
      connectionId: connection.connectionId,
      artifactId: "Artifact1",
      platform: "Windows",
      downloadPath: f.root,
    },
    new AbortController().signal
  );
  assert.equal(f.commands.length, commands);
});

test("preparation receipts stay bounded and cannot survive a different auth generation", async (t) => {
  const f = await fixture(t);
  const first = await f.service.getOptions(objectId);
  const payload = {
    epicObjectId: objectId,
    connectionId: connection.connectionId,
    artifactId: "Artifact1",
    platform: "Windows" as const,
    downloadPath: f.root,
    preparationId: first.options[0].preparationId,
  };
  for (let index = 0; index < EPIC_INSTALL_OPTIONS_CACHE_MAX_ENTRIES; index++) {
    const id = `Another:Item${index}`;
    f.addGame(id, `Another${index}`);
    await f.service.getOptions(id);
  }
  const count = f.commands.length;
  const refreshed = await f.service.resolvePreparation(
    payload,
    new AbortController().signal
  );
  assert.equal(f.commands.length, count + 1);
  assert.notEqual(refreshed.prepared.preparationId, payload.preparationId);
  f.nextGeneration();
  const generation = await f.service.resolvePreparation(
    { ...payload, preparationId: refreshed.prepared.preparationId },
    new AbortController().signal
  );
  assert.equal(generation.owned.auth.generation, auth.generation + 1);
  assert.notEqual(
    generation.prepared.preparationId,
    refreshed.prepared.preparationId
  );
});

test("revalidating the same build preserves its preview receipt but a new build invalidates cached options", async (t) => {
  const f = await fixture(t);
  const first = await f.service.getOptions(objectId);
  const current = await f.service.prepare(
    f.owned,
    "Artifact1",
    "Windows",
    new AbortController().signal
  );
  assert.equal(current.preparationId, first.options[0].preparationId);
  f.setInfo({ ...info, game: { ...info.game, version: "build-2" } });
  const newer = await f.service.prepare(
    f.owned,
    "Artifact1",
    "Windows",
    new AbortController().signal
  );
  assert.notEqual(newer.preparationId, first.options[0].preparationId);
  assert.equal(
    (await f.service.getOptions(objectId)).options[0].preparationId,
    newer.preparationId
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

test("Squadrons metadata reports its Origin requirement before missing assets without requesting a manifest", async (t) => {
  const f = await fixture(t);
  f.addMetadata(squadronsMetadata);
  const result = await f.service.getOptions(squadronsObjectId);
  assert.deepEqual(result, {
    connectionId: connection.connectionId,
    options: [],
    error: "external-launcher-required",
  });
  assert.equal(f.commands.filter((args) => args.includes("list")).length, 0);
  assert.equal(f.commands.filter((args) => args.includes("info")).length, 0);
  const owned = await f.service.capture(
    squadronsObjectId,
    new AbortController().signal
  );
  await assert.rejects(
    f.service.prepare(owned, "bobcat", "Windows", new AbortController().signal),
    {
      code: "external-launcher-required",
    }
  );
  assert.equal(f.commands.filter((args) => args.includes("info")).length, 0);
  assert.equal(
    (await f.service.getOptions(objectId)).options[0].artifactId,
    "Artifact1"
  );
  assert.equal(
    f.commands.filter((args) => args.includes("list")).length,
    0,
    "external aliases do not require any library enumeration"
  );
});

test("external-launcher metadata must still prove the exact artifact and catalog identity", async (t) => {
  const f = await fixture(t);
  const target = { ...f.target, artifactId: "bobcat" };
  assert.throws(
    () =>
      validateEpicMetadata(
        squadronsMetadata,
        target,
        "DifferentNamespace:DifferentItem"
      ),
    {
      code: "invalid-artifact",
    }
  );
  assert.throws(
    () => validateEpicMetadata(squadronsMetadata, f.target, squadronsObjectId),
    {
      code: "invalid-artifact",
    }
  );
  assert.throws(
    () =>
      validateEpicMetadata(
        {
          ...squadronsMetadata,
          metadata: { ...squadronsMetadata.metadata, id: undefined },
        },
        target
      ),
    {
      code: "invalid-artifact",
    }
  );
  for (const name of [
    "ThirdPartyManagedApp",
    "ThirdPartyManagedProvider",
    "partnerLinkType",
  ]) {
    assert.throws(
      () =>
        validateEpicMetadata(
          {
            ...squadronsMetadata,
            metadata: {
              ...squadronsMetadata.metadata,
              customAttributes: { [name]: { value: "ubisoft" } },
            },
          },
          target,
          squadronsObjectId
        ),
      {
        code: "external-launcher-required",
      }
    );
  }
});

test("an external alias does not prevent another verified alias of the game from being installable", async (t) => {
  const f = await fixture(t);
  f.addMetadata({
    ...squadronsMetadata,
    app_name: "Artifact0",
    metadata: {
      ...squadronsMetadata.metadata,
      namespace: metadata.metadata.namespace,
      id: metadata.metadata.id,
    },
  });
  const result = await f.service.getOptions(objectId);
  assert.equal(result.error, undefined);
  assert.deepEqual(
    result.options.map((option) => option.artifactId),
    ["Artifact1"]
  );
  assert.deepEqual(
    f.commands.filter((args) => args.includes("info")).map((args) => args[3]),
    ["Artifact1"]
  );
});

test("the external launcher requirement remains the error when every alias is unavailable", async (t) => {
  const f = await fixture(t);
  f.addMetadata(squadronsMetadata);
  f.addMetadata({
    ...squadronsMetadata,
    app_name: "zUnavailableAlias",
    metadata: {
      ...squadronsMetadata.metadata,
      categories: [{ path: "addons" }],
      customAttributes: {},
    },
  });
  assert.equal(
    (await f.service.getOptions(squadronsObjectId)).error,
    "external-launcher-required"
  );
  assert.equal(f.commands.filter((args) => args.includes("info")).length, 0);
});

test("install info identifies an external launcher even without a native version or manifest", () => {
  for (const external_activation of [
    "Origin",
    "the ea app",
    "ubisoft",
    "UbisoftConnect",
  ]) {
    const externalInfo = {
      ...info,
      game: { ...info.game, external_activation, version: null },
      manifest: {},
    };
    assert.throws(() => parseEpicInstallInfo(externalInfo, "Artifact1"), {
      code: "external-launcher-required",
    });
    assert.throws(
      () =>
        parseEpicInstallInfo(
          { ...externalInfo, game: { ...externalInfo.game, is_dlc: true } },
          "Artifact1"
        ),
      {
        code: "not-installable",
      }
    );
    assert.throws(
      () =>
        parseEpicInstallInfo(
          { ...externalInfo, manifest: { is_preloaded: true } },
          "Artifact1"
        ),
      {
        code: "not-installable",
      }
    );
  }
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
  const prepared = await f.service.prepare(
    f.owned,
    "Artifact1",
    "Windows",
    new AbortController().signal
  );
  await f.service.persistPreparation(
    prepared,
    objectId,
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

test("queued prerequisite confirmation cancels without modifying installation or releasing the active workspace", async (t) => {
  const f = await fixture(t, "linux");
  const prepared = await f.service.prepare(
    f.owned,
    "Artifact1",
    "Windows",
    new AbortController().signal
  );
  await f.service.persistPreparation(
    prepared,
    objectId,
    new AbortController().signal
  );
  const installPath = path.join(f.root, "EpicGame");
  await fs.mkdir(installPath);
  await fs.writeFile(path.join(installPath, "Game.exe"), "game");
  const file = path.join(f.runtime.workspace(f.target), "installed.json");
  await fs.writeFile(
    file,
    JSON.stringify({
      Artifact1: {
        app_name: "Artifact1",
        platform: "Windows",
        version: "build-1",
        install_path: installPath,
        executable: "Game.exe",
        install_size: 1000,
        prereq_info: { path: "Redist.exe", args: "/quiet", installed: false },
      },
    })
  );
  const installed = await f.service.readInstalled(f.target, objectId);
  assert.ok(installed);
  const release = deferred<void>();
  const entered = deferred<void>();
  const active = f.runtime.serializeWorkspace(f.target, async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const controller = new AbortController();
  const confirmation = f.service.confirmPrerequisites(
    f.target,
    installed,
    controller.signal
  );
  const cancelled = assert.rejects(confirmation, {
    code: "operation-cancelled",
  });
  let nextRan = false;
  const next = f.runtime.serializeWorkspace(f.target, async () => {
    nextRan = true;
  });
  try {
    controller.abort();
    await cancelled;
    assert.equal(nextRan, false);
    assert.equal(
      JSON.parse(await fs.readFile(file, "utf8")).Artifact1.prereq_info
        .installed,
      false
    );
  } finally {
    release.resolve();
    await active;
    await next;
  }
  assert.equal(
    JSON.parse(await fs.readFile(file, "utf8")).Artifact1.prereq_info.installed,
    false
  );
  await f.service.confirmPrerequisites(
    f.target,
    installed,
    new AbortController().signal
  );
  assert.equal(
    JSON.parse(await fs.readFile(file, "utf8")).Artifact1.prereq_info.installed,
    true
  );
});

test("installed executable realpath cannot escape through a directory junction", async (t) => {
  const f = await fixture(t);
  const prepared = await f.service.prepare(
    f.owned,
    "Artifact1",
    "Windows",
    new AbortController().signal
  );
  await f.service.persistPreparation(
    prepared,
    objectId,
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
  await assert.rejects(f.service.readInstalled(f.target, objectId), {
    code: "invalid-path",
  });
});

async function epicStoreInstall(root: string, withStoreFolder = true) {
  const installPath = path.join(root, "Epic Games", "EpicGame");
  await fs.mkdir(path.join(installPath, "bin"), { recursive: true });
  await fs.writeFile(path.join(installPath, "bin", "Game.exe"), "game");
  if (withStoreFolder)
    await fs.mkdir(path.join(installPath, ".egstore"), { recursive: true });
  return installPath;
}

function importWritesInstalled(
  f: Awaited<ReturnType<typeof fixture>>,
  installPath: string,
  extra: Record<string, unknown> = {}
) {
  f.beforeExecute(async (args) => {
    if (!args.includes("import")) return;
    // Legendary's import saves the game's metadata in the workspace.
    await fs.mkdir(path.join(f.runtime.workspace(f.target), "metadata"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(f.runtime.workspace(f.target), "metadata", "Artifact1.json"),
      JSON.stringify(metadata)
    );
    await fs.writeFile(
      path.join(f.runtime.workspace(f.target), "installed.json"),
      JSON.stringify({
        Artifact1: {
          app_name: "Artifact1",
          platform: "Windows",
          install_path: args[args.indexOf("import") + 2],
          executable: "/bin/Game.exe",
          install_size: 1000,
          version: "build-1",
          is_dlc: false,
          needs_verification: false,
          ...extra,
        },
      })
    );
    assert.equal(
      await fs.realpath(args[args.indexOf("import") + 2]),
      await fs.realpath(installPath)
    );
  });
}

test("an Epic Games Store install is imported in place and bound to the game", async (t) => {
  const f = await fixture(t);
  const installPath = await epicStoreInstall(f.root);
  importWritesInstalled(f, installPath);
  const { installed } = await f.service.importExisting(
    objectId,
    { artifactId: "Artifact1", installLocation: installPath },
    new AbortController().signal
  );
  const command = f.commands.find((args) => args.includes("import"))!;
  assert.deepEqual(command.slice(command.indexOf("-y")), [
    "-y",
    "import",
    "Artifact1",
    await fs.realpath(installPath),
    "--platform",
    "Windows",
  ]);
  assert.equal(installed.installPath, await fs.realpath(installPath));
  assert.equal(
    f.getGame().executablePath,
    await fs.realpath(path.join(installPath, "bin", "Game.exe"))
  );
  assert.equal(f.getGame().epicInstallation?.artifactId, "Artifact1");
  assert.equal(
    await fs.readFile(path.join(installPath, "bin", "Game.exe"), "utf8"),
    "game"
  );
});

test("a folder without Epic Games Store data is never imported", async (t) => {
  const f = await fixture(t);
  const installPath = await epicStoreInstall(f.root, false);
  await assert.rejects(
    f.service.importExisting(
      objectId,
      { artifactId: "Artifact1", installLocation: installPath },
      new AbortController().signal
    ),
    { code: "invalid-path" }
  );
  assert.equal(
    f.commands.some((args) => args.includes("import")),
    false
  );
  assert.equal(f.getGame().epicInstallation, undefined);
});

test("an import without store manifest data is verified before it is bound", async (t) => {
  const f = await fixture(t);
  const installPath = await epicStoreInstall(f.root);
  importWritesInstalled(f, installPath, { needs_verification: true });
  await f.service.importExisting(
    objectId,
    { artifactId: "Artifact1", installLocation: installPath },
    new AbortController().signal
  );
  assert.ok(f.commands.some((args) => args.includes("verify")));
  assert.equal(f.getGame().epicInstallation?.artifactId, "Artifact1");
  const workspaceInstalled = JSON.parse(
    await fs.readFile(
      path.join(f.runtime.workspace(f.target), "installed.json"),
      "utf8"
    )
  );
  assert.equal(workspaceInstalled.Artifact1.needs_verification, false);
});

test("an import that fails verification is forgotten and stays a normal download", async (t) => {
  const f = await fixture(t);
  const installPath = await epicStoreInstall(f.root);
  importWritesInstalled(f, installPath, { needs_verification: true });
  f.setVerifyOutput(
    "[cli] ERROR: Verification failed, 1 file(s) corrupted, 0 file(s) are missing."
  );
  await assert.rejects(
    f.service.importExisting(
      objectId,
      { artifactId: "Artifact1", installLocation: installPath },
      new AbortController().signal
    ),
    { code: "process-failed" }
  );
  assert.equal(f.getGame().epicInstallation, undefined);
  assert.equal(f.getGame().executablePath, undefined);
  const workspaceInstalled = JSON.parse(
    await fs.readFile(
      path.join(f.runtime.workspace(f.target), "installed.json"),
      "utf8"
    )
  );
  assert.equal(workspaceInstalled.Artifact1, undefined);
});
