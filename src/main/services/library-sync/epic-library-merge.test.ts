import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { test } from "node:test";
import { chunk } from "lodash-es";
import * as playtime from "../../../shared/playtime.js";
import { preserveEpicDefaultArtwork } from "../../../shared/artwork-resolver.js";
import { mergeLibraryCatalogueMetadata } from "../../../shared/library-catalogue.js";
import * as source from "./resolve-library-source.js";
import * as queue from "./library-write-queue.js";
import { mergeImportedProfileGame } from "./merge-imported-profile-game.js";
import type { Game, ShopAssets } from "@types";
import { EPIC_HYDRA_TIMEOUT_MS } from "../epic/constants.js";

const context = {
  environment: "https://api.test",
  userId: "HydraA",
  generation: 1,
};
const connectionId = "AbCdEfG1",
  key = "epic:Namespace:Item";
const game: Game = {
  shop: "epic",
  objectId: "Namespace:Item",
  title: "Game",
  remoteId: "Remote1",
  iconUrl: null,
  logoImageUrl: null,
  libraryHeroImageUrl: null,
  source: "hydra",
  isDeleted: false,
  playTimeInMilliseconds: 500,
  epicPlayTimeInMilliseconds: 3000,
  hasActiveEpicImport: true,
  epicImportScope: {
    environment: context.environment,
    userId: context.userId,
    connectionId,
  },
  lastTimePlayed: null,
  favorite: true,
  executablePath: "C:\\Games\\game.exe",
  customIconUrl: "local:icon.png",
  enableHydraPlaytimeTracking: true,
  achievementCount: 10,
  unlockedAchievementCount: 2,
};
const remote = {
  id: "Remote1",
  shop: "epic",
  objectId: game.objectId,
  title: game.title,
  source: "hydra",
  hasActiveEpicImport: true,
  runtimeByPlatform: { hydra: 0, steam: 0, epic: 100 },
  playTimeInMilliseconds: 100000,
  lastTimePlayed: null,
  achievementCount: 10,
  unlockedAchievementCount: 2,
};
function fixture() {
  queue.setEpicLibraryConnection(context, connectionId);
  const local = new Map<string, Game>([[key, { ...game }]]);
  const assets = new Map<string, ShopAssets>();
  const state = {
    remote: [{ ...remote }] as (typeof remote)[],
    current: true,
    reads: 0,
    ownerReads: 0,
    readGate: Promise.resolve(),
    fetchFail: false,
    ownerStatus: 404,
    activeOwnerReads: 0,
    maxActiveOwnerReads: 0,
    ownerRequests: [] as Array<{
      url: string;
      options: { signal?: AbortSignal; timeout?: number };
    }>,
    ownerGate: null as
      | ((
          url: string,
          options: { signal?: AbortSignal; timeout?: number }
        ) => Promise<void>)
      | null,
  };
  const games = {
    get: async (key: string) => local.get(key),
    getMany: async (keys: string[]) => {
      await state.readGate;
      return keys.map((key) => local.get(key));
    },
    iterator: () => ({ all: async () => [...local.entries()] }),
    put: async (key: string, value: Game) => {
      local.set(key, value);
    },
  };
  const modules: Record<string, unknown> = {
    "lodash-es": { chunk },
    "@shared": {
      ...playtime,
      preserveEpicDefaultArtwork,
      mergeLibraryCatalogueMetadata,
    },
    "./library-write-queue": queue,
    "../hydra-api": {
      HydraApi: {
        getAuthContext: () => context,
        isAuthContextCurrent: () => state.current,
        isLoggedIn: () => true,
        hasActiveSubscription: () => false,
        get: async (
          url: string,
          _params: unknown,
          options: { signal?: AbortSignal; timeout?: number } = {}
        ) => {
          if (url === "/profile/integrations/epic")
            return { connected: true, connectionId };
          state.ownerReads++;
          state.ownerRequests.push({ url, options });
          state.activeOwnerReads++;
          state.maxActiveOwnerReads = Math.max(
            state.maxActiveOwnerReads,
            state.activeOwnerReads
          );
          try {
            await state.ownerGate?.(url, options);
            if (state.ownerStatus === 200) return remote;
            throw { response: { status: state.ownerStatus } };
          } finally {
            state.activeOwnerReads--;
          }
        },
      },
    },
    "../game-artwork-cloud": { saveSteamGridDbArtwork: async () => false },
    "@main/level": {
      gamesSublevel: games,
      levelKeys: { game: (shop: string, id: string) => `${shop}:${id}` },
      gamesArtworkSelectionSublevel: {},
      markArtworkSelectionSynced: async () => {},
      gamesShopAssetsSublevel: {
        getMany: async (keys: string[]) => keys.map((key) => assets.get(key)),
      },
      db: {
        batch: () => {
          const operations: {
            key: string;
            value: Game;
            options: { sublevel: unknown };
          }[] = [];
          return {
            put: (key: string, value: Game, options: { sublevel: unknown }) =>
              operations.push({ key, value, options }),
            write: async () => {
              for (const operation of operations)
                if (operation.options.sublevel === games)
                  local.set(operation.key, operation.value);
                else
                  assets.set(
                    operation.key,
                    operation.value as unknown as ShopAssets
                  );
            },
          };
        },
      },
    },
    "./reconcile-remote-artwork-selection": {
      CUSTOM_ASSET_FIELD_BY_TYPE: {},
      reconcileRemoteArtworkSelection: () => ({ selected: {}, changed: false }),
    },
    "./merge-imported-profile-game": { mergeImportedProfileGame },
    "./resolve-library-source": source,
    "../achievements/achievement-memory-store": {
      mergePersistedAchievementTotals: (
        _shop: string,
        _id: string,
        local?: Game
      ) => ({
        achievementCount: local?.achievementCount ?? 0,
        unlockedAchievementCount: local?.unlockedAchievementCount ?? 0,
      }),
    },
    "../achievements/achievement-batch-games": {
      trackAchievementBatchGame: () => {},
    },
    "./fetch-remote-profile-games": {
      fetchRemoteProfileGames: async () => {
        state.reads++;
        if (state.fetchFail) throw new Error("incomplete-library");
        return state.remote;
      },
    },
  };
  const module = {} as typeof import("./merge-with-remote-games");
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        new URL("./merge-with-remote-games.ts", import.meta.url),
        "utf8"
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }
    ).outputText,
    {
      exports: module,
      require: (name: string) =>
        modules[name] ?? assert.fail(`Unexpected dependency ${name}`),
      Date,
      Set,
      Map,
      Object,
    }
  );
  return { merge: module.mergeWithRemoteGames, state, local, assets };
}
test("Epic merge preserves Hydra runtime, preferences, installs and achievement fields", async () => {
  const f = fixture();
  assert.equal(await f.merge(), true);
  const result = f.local.get(key)!;
  assert.equal(result.playTimeInMilliseconds, 500);
  assert.equal(result.epicPlayTimeInMilliseconds, 100000);
  assert.equal(result.source, "hydra");
  assert.equal(result.executablePath, game.executablePath);
  assert.equal(result.favorite, true);
  assert.equal(result.customIconUrl, game.customIconUrl);
  assert.equal(result.unlockedAchievementCount, 2);
  assert.equal(result.epicImportScope?.connectionId, connectionId);
});
test("confirmed removal restores deletion even with historical Hydra time, without deleting data", async () => {
  const f = fixture();
  f.state.remote = [];
  assert.equal(await f.merge(), true);
  assert.equal(f.state.ownerReads, 1);
  const result = f.local.get(key)!;
  assert.equal(result.isDeleted, true);
  assert.equal(result.hasActiveEpicImport, false);
  assert.equal(result.epicPlayTimeInMilliseconds, 0);
  assert.equal(result.playTimeInMilliseconds, 500);
  assert.equal(result.remoteId, null);
  assert.equal(result.executablePath, game.executablePath);
  assert.equal(result.customIconUrl, game.customIconUrl);
  assert.equal(await f.merge(), true);
  assert.equal(
    f.state.ownerReads,
    1,
    "confirmed removals are not probed again"
  );
});

test("a terminal Epic entry needs no repeated owner probe and a positive snapshot still reactivates it", async () => {
  const f = fixture();
  f.state.remote = [];
  f.local.set(key, {
    ...game,
    isDeleted: true,
    hasActiveEpicImport: false,
    epicImportScope: undefined,
    epicPlayTimeInMilliseconds: 0,
  });
  assert.equal(await f.merge(), true);
  assert.equal(f.state.ownerReads, 0);
  assert.equal(f.local.get(key)?.remoteId, game.remoteId);
  assert.equal(f.local.get(key)?.playTimeInMilliseconds, 500);
  f.state.remote = [{ ...remote }];
  assert.equal(await f.merge(), true);
  assert.equal(f.state.ownerReads, 0);
  assert.equal(f.local.get(key)?.isDeleted, false);
  assert.equal(f.local.get(key)?.hasActiveEpicImport, true);
  assert.equal(f.local.get(key)?.epicPlayTimeInMilliseconds, 100000);
  assert.equal(f.local.get(key)?.executablePath, game.executablePath);
});

test("partially removed Epic entries are still checked for every unresolved import field", async () => {
  for (const unresolved of [
    { isDeleted: false },
    { hasActiveEpicImport: true },
    { epicImportScope: game.epicImportScope },
    { epicPlayTimeInMilliseconds: 1 },
  ]) {
    const f = fixture();
    f.state.remote = [];
    f.state.ownerStatus = 200;
    f.local.set(key, {
      ...game,
      isDeleted: true,
      hasActiveEpicImport: false,
      epicImportScope: undefined,
      epicPlayTimeInMilliseconds: 0,
      ...unresolved,
    });
    assert.equal(await f.merge(), true);
    assert.equal(f.state.ownerReads, 1);
    assert.equal(f.local.get(key)?.remoteId, game.remoteId);
  }
});

test("orphan owner probes are bounded to ten and progress includes them before the remote chunk finishes", async (t) => {
  const f = fixture();
  for (let index = 0; index < 23; index++) {
    const objectId = `Namespace:Orphan${index}`;
    f.local.set(`epic:${objectId}`, {
      ...game,
      objectId,
      remoteId: `Remote-orphan-${index}`,
    });
  }
  const pending = new Set<() => void>();
  f.state.ownerGate = () =>
    new Promise<void>((resolve) => {
      const release = () => {
        pending.delete(release);
        resolve();
      };
      pending.add(release);
    });
  const releaseBatch = () => {
    for (const release of pending) release();
  };
  const progress: number[][] = [];
  const merging = f.merge((processed, total) =>
    progress.push([processed, total])
  );
  t.after(async () => {
    f.state.ownerGate = null;
    releaseBatch();
    await merging;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.state.ownerReads, 10);
  assert.equal(f.state.activeOwnerReads, 10);
  assert.deepEqual(progress, [
    [0, 24],
    [1, 24],
  ]);
  releaseBatch();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.state.ownerReads, 20);
  assert.equal(f.state.activeOwnerReads, 10);
  assert.deepEqual(progress.at(-1), [11, 24]);
  releaseBatch();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.state.ownerReads, 23);
  assert.equal(f.state.activeOwnerReads, 3);
  releaseBatch();
  assert.equal(await merging, true);
  assert.equal(f.state.maxActiveOwnerReads, 10);
  assert.deepEqual(progress.at(-1), [24, 24]);
  assert.deepEqual(
    progress.map(([processed]) => processed),
    Array.from({ length: 25 }, (_, index) => index)
  );
});

test("aborting owner probes stops the first batch without stale removals or a completed progress counter", async (t) => {
  const f = fixture();
  f.state.remote = [];
  for (let index = 1; index < 20; index++) {
    const objectId = `Namespace:Orphan${index}`;
    f.local.set(`epic:${objectId}`, { ...game, objectId });
  }
  const controller = new AbortController();
  f.state.ownerGate = (_url, options) =>
    new Promise<void>((_resolve, reject) => {
      const cancel = () => reject(new Error("request-cancelled"));
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) cancel();
    });
  const progress: number[][] = [];
  const merging = f.merge(
    (processed, total) => progress.push([processed, total]),
    context,
    connectionId,
    undefined,
    { signal: controller.signal, timeout: EPIC_HYDRA_TIMEOUT_MS }
  );
  t.after(async () => {
    controller.abort();
    await merging;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const readsAtAbort = f.state.ownerReads;
  assert.ok(readsAtAbort > 0);
  controller.abort();
  const result = await merging;
  assert.equal(
    f.state.ownerReads,
    readsAtAbort,
    "abort starts no more requests"
  );
  assert.equal(readsAtAbort, 10);
  assert.equal(result, false);
  assert.equal(f.state.activeOwnerReads, 0);
  assert.deepEqual(progress, [[0, 20]]);
  for (const request of f.state.ownerRequests) {
    assert.equal(request.options.signal, controller.signal);
    assert.equal(request.options.timeout, EPIC_HYDRA_TIMEOUT_MS);
  }
  for (const current of f.local.values()) {
    assert.equal(current.isDeleted, false);
    assert.equal(current.remoteId, game.remoteId);
    assert.equal(current.epicPlayTimeInMilliseconds, 3000);
  }
});

test("a changed remote ID or new unsynced Hydra time during an owner check prevents removal", async () => {
  for (const changed of [
    { remoteId: "New-remote-id" },
    { unsyncedDeltaPlayTimeInMilliseconds: 1000 },
  ]) {
    const f = fixture();
    f.state.remote = [];
    f.state.ownerGate = async () => {
      f.local.set(key, { ...f.local.get(key)!, ...changed });
    };
    assert.equal(await f.merge(), true);
    assert.equal(f.state.ownerReads, 1);
    assert.equal(f.local.get(key)?.isDeleted, false);
    assert.equal(f.local.get(key)?.epicPlayTimeInMilliseconds, 3000);
  }
});

test("context changes during a confirmed owner response cannot clear a new session's local game", async () => {
  const f = fixture();
  f.state.remote = [];
  f.state.ownerGate = async () => {
    f.state.current = false;
  };
  assert.equal(await f.merge(), false);
  assert.equal(f.state.ownerReads, 1);
  assert.equal(f.local.get(key)?.remoteId, game.remoteId);
  assert.equal(f.local.get(key)?.isDeleted, false);
});

test("a Hydra claim started during an owner request protects the latest local game", async () => {
  const f = fixture();
  f.state.remote = [];
  let completeClaim: (() => void) | undefined;
  let claiming: Promise<void> | undefined;
  f.state.ownerGate = async () => {
    claiming = queue.withHydraClaim(
      key,
      () =>
        new Promise<void>((resolve) => {
          completeClaim = resolve;
        })
    );
  };
  try {
    assert.equal(await f.merge(), true);
    assert.equal(f.state.ownerReads, 1);
    assert.equal(f.local.get(key)?.isDeleted, false);
    assert.equal(f.local.get(key)?.remoteId, game.remoteId);
    assert.equal(f.local.get(key)?.epicPlayTimeInMilliseconds, 3000);
  } finally {
    completeClaim?.();
    await claiming;
  }
});

test("failed/partial library and unconfirmed owner reads never decide removal", async () => {
  const f = fixture();
  f.state.fetchFail = true;
  assert.equal(await f.merge(), false);
  assert.equal(f.local.get(key)?.isDeleted, false);
  f.state.fetchFail = false;
  f.state.remote = [];
  f.state.ownerStatus = 503;
  assert.equal(await f.merge(), true);
  assert.equal(f.local.get(key)?.isDeleted, false);
  assert.equal(f.local.get(key)?.epicPlayTimeInMilliseconds, 3000);
});
test("a still-existing game missed by moving pagination is not hidden", async () => {
  const f = fixture();
  f.state.remote = [];
  f.state.ownerStatus = 200;
  assert.equal(await f.merge(), true);
  assert.equal(f.local.get(key)?.isDeleted, false);
});
test("an explicit zero-time Hydra claim in flight protects the game", async () => {
  const f = fixture();
  f.state.remote = [];
  await queue.withHydraClaim(key, async () => {
    assert.equal(await f.merge(), true);
    assert.equal(f.local.get(key)?.isDeleted, false);
    assert.equal(f.state.ownerReads, 0);
  });
});
test("context invalidation during a local read prevents old snapshot writes", async () => {
  const f = fixture();
  let release!: () => void;
  f.state.readGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const result = f.merge();
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.state.current = false;
  release();
  assert.equal(await result, false);
  assert.equal(f.local.get(key)?.epicPlayTimeInMilliseconds, 3000);
});
test("a connection change invalidates old snapshots inside the write queue", async () => {
  const f = fixture();
  let release!: () => void;
  f.state.readGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const result = f.merge();
  await new Promise<void>((resolve) => setImmediate(resolve));
  queue.setEpicLibraryConnection(context, null);
  f.state.remote = [];
  release();
  assert.equal(await result, true);
  assert.equal(f.state.reads, 2);
  assert.equal(f.local.get(key)?.epicPlayTimeInMilliseconds, 0);
});
test("a snapshot fetched before Hydra reset cannot restore Hydra hours", async () => {
  const f = fixture();
  f.state.remote = [
    { ...remote, runtimeByPlatform: { hydra: 900, steam: 0, epic: 100 } },
  ];
  let release!: () => void;
  f.state.readGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const result = f.merge();
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.local.set(key, {
    ...game,
    playTimeInMilliseconds: 0,
    hasManuallyUpdatedPlaytime: false,
  });
  queue.markHydraPlaytimeChanged(key);
  release();
  assert.equal(await result, true);
  assert.equal(f.local.get(key)?.playTimeInMilliseconds, 0);
  assert.equal(f.local.get(key)?.epicPlayTimeInMilliseconds, 100000);
});

test("a remote Epic-only entry cannot acknowledge an unpublished Hydra claim", async () => {
  const f = fixture();
  f.local.set(key, {
    ...game,
    source: "hydra",
    remoteId: null,
    playTimeInMilliseconds: 1234,
  });
  f.state.remote = [
    {
      ...remote,
      source: "epic",
      runtimeByPlatform: { hydra: 0, steam: 0, epic: 100 },
    },
  ];
  assert.equal(await f.merge(), true);
  assert.equal(f.local.get(key)?.remoteId, null);
  assert.equal(f.local.get(key)?.source, "hydra");
  assert.equal(f.local.get(key)?.playTimeInMilliseconds, 1234);
  assert.equal(f.local.get(key)?.epicPlayTimeInMilliseconds, 100000);
});

test("catalogue presentation metadata and Steam defaults keep Epic storage identity", async () => {
  const f = fixture();
  const metadata = {
    canonicalId: "canonical-game",
    catalogueGame: { shop: "steam" as const, objectId: "123" },
    availableShops: ["steam", "epic"] as Game["availableShops"],
  };
  Object.assign(f.state.remote[0], metadata, {
    title: "Steam preferred title",
    iconUrl: "steam-icon",
    libraryHeroImageUrl: "steam-hero",
  });
  assert.equal(await f.merge(), true);
  const result = f.local.get(key)!;
  assert.equal(result.shop, "epic");
  assert.equal(result.objectId, game.objectId);
  assert.equal(result.canonicalId, metadata.canonicalId);
  assert.deepEqual(result.catalogueGame, metadata.catalogueGame);
  assert.equal(result.title, "Steam preferred title");
  assert.equal(result.playTimeInMilliseconds, 500);
  assert.equal(result.customIconUrl, game.customIconUrl);
  assert.equal(f.assets.get(key)?.shop, "epic");
  assert.equal(f.assets.get(key)?.objectId, game.objectId);
  assert.equal(f.assets.get(key)?.iconUrl, "steam-icon");
  assert.equal(f.local.has("steam:123"), false);
  assert.equal(f.assets.get("steam:123")?.shop, "steam");
  assert.equal(f.assets.get("steam:123")?.objectId, "123");
  assert.equal(f.assets.get("steam:123")?.iconUrl, "steam-icon");
  assert.equal(
    f.assets.get(key)?.coverImageUrl,
    "https://shared.steamstatic.com/store_item_assets/steam/apps/123/library_600x900_2x.jpg"
  );

  const individual = mergeImportedProfileGame(result, {
    id: "Remote1",
    shop: "epic",
    objectId: game.objectId,
    runtimeByPlatform: { hydra: 0, steam: 0, epic: 101 },
    hasActiveEpicImport: true,
  });
  assert.deepEqual(individual.catalogueGame, metadata.catalogueGame);
  assert.equal(individual.canonicalId, metadata.canonicalId);
  assert.deepEqual(individual.availableShops, metadata.availableShops);
  assert.equal(individual.epicPlayTimeInMilliseconds, 101000);
});
