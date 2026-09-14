import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Game } from "@types";

import { migrateCloudSaveAutomaticSyncDefaultsWithStore } from "./automatic-sync-default-migration-policy.js";

const game = (shop: Game["shop"], automaticCloudSync: boolean): Game =>
  ({
    objectId: "1",
    shop,
    automaticCloudSync,
  }) as Game;

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
      ["steam:1", game("steam", true)],
      ["steam:2", game("steam", false)],
      ["custom:3", game("custom", true)],
    ],
    getStoredSettings: async (): Promise<[string, boolean][]> => [
      ["steam:1", false],
      ["steam:orphaned", false],
      ["custom:3", false],
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

describe("cloud save automatic sync day-one migration", () => {
  it("moves existing Steam state to the V2 default and preserves other shops", async () => {
    const { store, state } = createStore();

    assert.equal(
      await migrateCloudSaveAutomaticSyncDefaultsWithStore(store),
      true
    );
    assert.deepEqual(
      state().committedGames.map(([key]) => key),
      ["steam:1"]
    );
    assert.deepEqual(state().deletedSettingKeys, ["steam:1", "steam:orphaned"]);
    assert.equal(state().isCompleted, true);
  });

  it("does not run again after the atomic marker is committed", async () => {
    const { store, state } = createStore({ completed: true });

    assert.equal(
      await migrateCloudSaveAutomaticSyncDefaultsWithStore(store),
      false
    );
    assert.equal(state().commitCount, 0);
  });

  it("does not complete when the atomic commit fails", async () => {
    const { store, state } = createStore({ failCommit: true });

    await assert.rejects(
      migrateCloudSaveAutomaticSyncDefaultsWithStore(store),
      /write failed/
    );
    assert.equal(state().commitCount, 1);
    assert.equal(state().isCompleted, false);
  });
});
