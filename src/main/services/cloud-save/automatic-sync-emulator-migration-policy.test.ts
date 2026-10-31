import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Game } from "@types";
import { migrateEmulatorCloudSaveDefaultsWithStore } from "./automatic-sync-emulator-migration-policy.js";
import { resolveStoredCloudSaveAutomaticSyncModeForShop } from "./automatic-sync-mode.js";

const game = (
  shop: Game["shop"],
  platform: string,
  automaticCloudSync: boolean
) => ({ shop, platform, automaticCloudSync }) as Game;

const createStore = ({
  completed = false,
  failCommit = false,
  games = [
    ["launchbox:ps3", game("launchbox", "Sony PlayStation 3", true)],
    ["launchbox:gba", game("launchbox", "Nintendo Game Boy Advance", false)],
    ["launchbox:ps2", game("launchbox", "Sony PlayStation 2", true)],
    ["steam:1", game("steam", "Sony PlayStation 3", false)],
  ],
  storedSettings = [
    ["launchbox:ps3", false],
    ["launchbox:gba", true],
    ["launchbox:ps2", false],
    ["steam:1", false],
  ],
}: {
  completed?: boolean;
  failCommit?: boolean;
  games?: [string, Game][];
  storedSettings?: [string, boolean][];
} = {}) => {
  let isCompleted = completed;
  let commitCount = 0;
  let committedGames: [string, Game][] = [];
  let deletedSettingKeys: string[] = [];
  const gameRecords = new Map(games);
  const settingRecords = new Map(storedSettings);
  const store = {
    getCompleted: async () => isCompleted,
    getGames: async (): Promise<[string, Game][]> => [...gameRecords],
    getStoredSettings: async (): Promise<[string, boolean][]> => [
      ...settingRecords,
    ],
    commit: async (
      gamesToDisableLegacy: [string, Game][],
      settingKeysToDelete: string[]
    ) => {
      commitCount += 1;
      if (failCommit) throw new Error("write failed");
      committedGames = gamesToDisableLegacy;
      deletedSettingKeys = settingKeysToDelete;
      for (const [key, game] of gamesToDisableLegacy) {
        gameRecords.set(key, { ...game, automaticCloudSync: false });
      }
      for (const key of settingKeysToDelete) settingRecords.delete(key);
      isCompleted = true;
    },
  };
  return {
    store,
    modeFor: (key: string) => {
      const game = gameRecords.get(key);
      assert.ok(game);
      return resolveStoredCloudSaveAutomaticSyncModeForShop(
        game.shop,
        game.automaticCloudSync === true,
        settingRecords.get(key),
        game.platform
      );
    },
    state: () => ({
      isCompleted,
      commitCount,
      committedGames,
      deletedSettingKeys,
      games: [...gameRecords],
      storedSettings: [...settingRecords],
    }),
  };
};

describe("emulator Cloud Save V2 default migration", () => {
  it("clears eligible legacy mode and enabled V2 preferences only", async () => {
    const { store, state } = createStore();
    assert.equal(await migrateEmulatorCloudSaveDefaultsWithStore(store), true);
    assert.deepEqual(
      state().committedGames.map(([key]) => key),
      ["launchbox:ps3"]
    );
    assert.deepEqual(state().deletedSettingKeys, ["launchbox:gba"]);
    assert.equal(state().isCompleted, true);
    assert.equal(await migrateEmulatorCloudSaveDefaultsWithStore(store), false);
    assert.equal(state().commitCount, 1);
  });

  for (const [provider, platform] of [
    ["RPCS3", "Sony PlayStation 3"],
    ["RetroArch", "Nintendo Game Boy Advance"],
  ]) {
    for (const enabled of [false, true, undefined]) {
      it(`preserves ${provider} sync behavior with preference ${enabled}`, async () => {
        const key = "launchbox:game";
        const { store, state, modeFor } = createStore({
          games: [[key, game("launchbox", platform, true)]],
          storedSettings: enabled === undefined ? [] : [[key, enabled]],
        });

        await migrateEmulatorCloudSaveDefaultsWithStore(store);

        assert.equal(modeFor(key), enabled === false ? "disabled" : "v2");
        assert.deepEqual(
          state().storedSettings,
          enabled === false ? [[key, false]] : []
        );
        assert.equal(state().games[0][1].automaticCloudSync, false);
      });
    }
  }

  it("preserves Steam and unsupported emulator games and settings", async () => {
    for (const shop of ["steam", "launchbox"] as const) {
      for (const enabled of [false, true, undefined]) {
        const key = `${shop}:game`;
        const { store, state, modeFor } = createStore({
          games: [[key, game(shop, "Sony PlayStation 2", true)]],
          storedSettings: enabled === undefined ? [] : [[key, enabled]],
        });
        const before = state();
        const modeBefore = modeFor(key);

        await migrateEmulatorCloudSaveDefaultsWithStore(store);

        assert.equal(modeFor(key), modeBefore);
        assert.deepEqual(state().games, before.games);
        assert.deepEqual(state().storedSettings, before.storedSettings);
      }
    }
  });

  it("does not repeat after completion", async () => {
    const { store, state } = createStore({ completed: true });
    assert.equal(await migrateEmulatorCloudSaveDefaultsWithStore(store), false);
    assert.equal(state().commitCount, 0);
  });

  it("keeps the marker unset when the atomic commit fails", async () => {
    const { store, state } = createStore({ failCommit: true });
    const before = state();
    await assert.rejects(
      migrateEmulatorCloudSaveDefaultsWithStore(store),
      /write failed/
    );
    assert.equal(state().isCompleted, false);
    assert.deepEqual(state().games, before.games);
    assert.deepEqual(state().storedSettings, before.storedSettings);
  });
});
