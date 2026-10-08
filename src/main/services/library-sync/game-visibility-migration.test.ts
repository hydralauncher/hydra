import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Game } from "@types";

import { migrateGameVisibilityWithStore } from "./game-visibility-migration-policy.ts";

const legacyGame = (hide: boolean, isHidden: boolean) =>
  ({ hide, isHidden, objectId: "1", shop: "steam" }) as unknown as Game;

const createStore = (failCommit = false) => {
  let completed = false;
  let writes = 0;
  let migrated: [string, Game][] = [];
  const store = {
    getCompleted: async () => completed,
    getGames: async (): Promise<[string, Game][]> => [
      ["steam:00", legacyGame(false, false)],
      ["steam:10", legacyGame(true, false)],
      ["steam:01", legacyGame(false, true)],
      ["steam:11", legacyGame(true, true)],
      ["steam:new", { isHiddenFromOthers: true, isConcealed: false } as Game],
    ],
    commit: async (games: [string, Game][]) => {
      writes += 1;
      if (failCommit) throw new Error("write failed");
      migrated = games;
      completed = true;
    },
  };
  return { store, state: () => ({ completed, writes, migrated }) };
};

describe("local game visibility migration", () => {
  it("preserves all four old states offline and removes old keys", async () => {
    const { store, state } = createStore();

    assert.equal(await migrateGameVisibilityWithStore(store), true);
    assert.deepEqual(
      state().migrated.map(([key, game]) => [
        key,
        game.isHiddenFromOthers,
        game.isConcealed,
        "hide" in game,
        "isHidden" in game,
      ]),
      [
        ["steam:00", false, false, false, false],
        ["steam:10", true, false, false, false],
        ["steam:01", false, true, false, false],
        ["steam:11", true, true, false, false],
      ]
    );
    assert.equal(await migrateGameVisibilityWithStore(store), false);
    assert.equal(state().writes, 1);
  });

  it("does not mark the migration complete when storage fails", async () => {
    const { store, state } = createStore(true);
    await assert.rejects(migrateGameVisibilityWithStore(store), /write failed/);
    assert.equal(state().completed, false);
  });

  it("keeps new values if a record also has old keys", async () => {
    let migrated: [string, Game][] = [];
    await migrateGameVisibilityWithStore({
      getCompleted: async () => false,
      getGames: async () => [
        [
          "steam:mixed",
          {
            ...legacyGame(true, true),
            isHiddenFromOthers: false,
            isConcealed: false,
          },
        ],
      ],
      commit: async (games) => {
        migrated = games;
      },
    });

    assert.deepEqual(migrated[0][1], {
      objectId: "1",
      shop: "steam",
      isHiddenFromOthers: false,
      isConcealed: false,
    });
  });
});
