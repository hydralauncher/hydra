import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { EpicLocalAchievementStore } from "./epic-local-achievement-store.ts";

const GAME = "epic:game";
const unlock = (name: string, unlockTime = 1) => ({ name, unlockTime });

afterEach(() => EpicLocalAchievementStore.clear());

describe("EpicLocalAchievementStore", () => {
  it("keeps the first observation of each unlock", () => {
    EpicLocalAchievementStore.addResolved(GAME, [unlock("epic_a", 1)]);
    EpicLocalAchievementStore.addResolved(GAME, [
      unlock("EPIC_A", 2),
      unlock("epic_b", 3),
    ]);

    assert.deepEqual(EpicLocalAchievementStore.getResolved(GAME), [
      unlock("epic_a", 1),
      unlock("epic_b", 3),
    ]);
  });

  it("replaces unresolved unlocks but keeps their first time", () => {
    EpicLocalAchievementStore.setUnresolved(
      GAME,
      [unlock("1", 1), unlock("2", 1)],
      0
    );
    EpicLocalAchievementStore.setUnresolved(GAME, [unlock("2", 9)], 0);

    assert.deepEqual(EpicLocalAchievementStore.getUnresolved(GAME), [
      unlock("2", 1),
    ]);
  });

  it("retries unresolved unlocks at most once a minute", () => {
    assert.equal(EpicLocalAchievementStore.shouldRetryUnresolved(GAME), false);

    EpicLocalAchievementStore.setUnresolved(GAME, [unlock("1")], 1_000);

    assert.equal(
      EpicLocalAchievementStore.shouldRetryUnresolved(GAME, 60_999),
      false
    );
    assert.equal(
      EpicLocalAchievementStore.shouldRetryUnresolved(GAME, 61_000),
      true
    );

    EpicLocalAchievementStore.setUnresolved(GAME, [], 0);
    assert.equal(
      EpicLocalAchievementStore.shouldRetryUnresolved(GAME, 61_000),
      false
    );
  });

  it("forgets a game", () => {
    EpicLocalAchievementStore.addResolved(GAME, [unlock("epic_a")]);
    EpicLocalAchievementStore.addResolved("epic:other", [unlock("epic_b")]);
    EpicLocalAchievementStore.delete(GAME);

    assert.deepEqual(EpicLocalAchievementStore.getResolved(GAME), []);
    assert.deepEqual(EpicLocalAchievementStore.getResolved("epic:other"), [
      unlock("epic_b"),
    ]);
  });
});
