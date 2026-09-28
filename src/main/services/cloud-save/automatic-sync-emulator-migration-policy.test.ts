import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Game } from "@types";
import { migrateEmulatorCloudSaveDefaultsWithStore } from "./automatic-sync-emulator-migration-policy.js";

const game = (
  shop: Game["shop"],
  platform: string,
  automaticCloudSync: boolean
) => ({ shop, platform, automaticCloudSync }) as Game;

const createStore = ({
  completed = false,
  failCommit = false,
}: {
  completed?: boolean;
  failCommit?: boolean;
} = {}) => {
  let isCompleted = completed;
  let commitCount = 0;
  let committedGames: [string, Game][] = [];
  let deletedSettingKeys: string[] = [];
  const store = {
    getCompleted: async () => isCompleted,
    getGames: async (): Promise<[string, Game][]> => [
      ["launchbox:ps3", game("launchbox", "Sony PlayStation 3", true)],
      ["launchbox:gba", game("launchbox", "Nintendo Game Boy Advance", false)],
      ["launchbox:ps2", game("launchbox", "Sony PlayStation 2", true)],
      ["steam:1", game("steam", "Sony PlayStation 3", false)],
    ],
    getStoredSettings: async (): Promise<[string, boolean][]> => [
      ["launchbox:ps3", false],
      ["launchbox:gba", true],
      ["launchbox:ps2", false],
      ["steam:1", false],
    ],
    commit: async (
      gamesToDisableLegacy: [string, Game][],
      settingKeysToDelete: string[]
    ) => {
      commitCount += 1;
      if (failCommit) throw new Error("write failed");
      committedGames = gamesToDisableLegacy;
      deletedSettingKeys = settingKeysToDelete;
      isCompleted = true;
    },
  };
  return {
    store,
    state: () => ({
      isCompleted,
      commitCount,
      committedGames,
      deletedSettingKeys,
    }),
  };
};

describe("emulator Cloud Save V2 default migration", () => {
  it("clears eligible legacy mode and earlier V2 preferences only", async () => {
    const { store, state } = createStore();
    assert.equal(await migrateEmulatorCloudSaveDefaultsWithStore(store), true);
    assert.deepEqual(
      state().committedGames.map(([key]) => key),
      ["launchbox:ps3"]
    );
    assert.deepEqual(state().deletedSettingKeys, [
      "launchbox:ps3",
      "launchbox:gba",
    ]);
    assert.equal(state().isCompleted, true);
  });

  it("does not repeat after completion", async () => {
    const { store, state } = createStore({ completed: true });
    assert.equal(await migrateEmulatorCloudSaveDefaultsWithStore(store), false);
    assert.equal(state().commitCount, 0);
  });

  it("keeps the marker unset when the atomic commit fails", async () => {
    const { store, state } = createStore({ failCommit: true });
    await assert.rejects(
      migrateEmulatorCloudSaveDefaultsWithStore(store),
      /write failed/
    );
    assert.equal(state().isCompleted, false);
  });
});
