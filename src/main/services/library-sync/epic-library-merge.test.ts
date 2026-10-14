import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { test } from "node:test";
import { chunk } from "lodash-es";
import * as playtime from "../../../shared/playtime.js";
import { preserveEpicDefaultArtwork } from "../../../shared/artwork-resolver.js";
import * as source from "./resolve-library-source.js";
import * as queue from "./library-write-queue.js";
import { mergeImportedProfileGame } from "./merge-imported-profile-game.js";
import type { Game } from "@types";

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
  const state = {
    remote: [remote] as (typeof remote)[],
    current: true,
    reads: 0,
    ownerReads: 0,
    readGate: Promise.resolve(),
    fetchFail: false,
    ownerStatus: 404,
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
    "@shared": { ...playtime, preserveEpicDefaultArtwork },
    "./library-write-queue": queue,
    "../hydra-api": {
      HydraApi: {
        getAuthContext: () => context,
        isAuthContextCurrent: () => state.current,
        isLoggedIn: () => true,
        hasActiveSubscription: () => false,
        get: async (url: string) => {
          if (url === "/profile/integrations/epic")
            return { connected: true, connectionId };
          state.ownerReads++;
          if (state.ownerStatus === 200) return remote;
          throw { response: { status: state.ownerStatus } };
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
        getMany: async (keys: string[]) => keys.map(() => undefined),
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
  return { merge: module.mergeWithRemoteGames, state, local };
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
  assert.equal(result.remoteId, game.remoteId);
  assert.equal(result.executablePath, game.executablePath);
  assert.equal(result.customIconUrl, game.customIconUrl);
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
