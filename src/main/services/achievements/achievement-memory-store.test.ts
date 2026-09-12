import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  AchievementMemoryStore,
  mergePersistedAchievementTotals,
  resolveAchievementCount,
  resolveUnlockedAchievementCount,
} from "./achievement-memory-store.js";

const entry = (name: string) => ({
  achievements: [],
  unlockedAchievements: [{ name, unlockTime: 1 }],
});

describe("AchievementMemoryStore", () => {
  afterEach(() => AchievementMemoryStore.clear());

  it("isolates achievement state by shop and object id", () => {
    AchievementMemoryStore.set("steam", "10", entry("STEAM_UNLOCK"));
    AchievementMemoryStore.set("launchbox", "10", entry("RA_UNLOCK"));

    assert.deepEqual(
      AchievementMemoryStore.get("steam", "10")?.unlockedAchievements,
      [{ name: "STEAM_UNLOCK", unlockTime: 1 }]
    );
    assert.deepEqual(
      AchievementMemoryStore.get("launchbox", "10")?.unlockedAchievements,
      [{ name: "RA_UNLOCK", unlockTime: 1 }]
    );
  });

  it("drops all achievement state when the authenticated session changes", () => {
    AchievementMemoryStore.set("steam", "10", entry("ACH_UNLOCK"));

    AchievementMemoryStore.clear();

    assert.equal(AchievementMemoryStore.get("steam", "10"), undefined);
  });

  it("uses the remote unlock count when local memory is empty", () => {
    AchievementMemoryStore.set("steam", "10", {
      achievements: [{ name: "ACH_ONE" } as never],
      unlockedAchievements: [],
    });

    assert.equal(resolveUnlockedAchievementCount("steam", "10", 22), 22);
  });

  it("keeps the larger of local and remote unlock counts", () => {
    AchievementMemoryStore.set("steam", "10", {
      achievements: [
        { name: "ACH_ONE" } as never,
        { name: "ACH_TWO" } as never,
      ],
      unlockedAchievements: [
        { name: "ACH_ONE", unlockTime: 1 },
        { name: "ACH_TWO", unlockTime: 2 },
      ],
    });

    assert.equal(resolveUnlockedAchievementCount("steam", "10", 1), 2);
  });

  it("counts steam unlocks when the schema is still empty", () => {
    AchievementMemoryStore.set("steam", "10", {
      achievements: [],
      unlockedAchievements: [
        { name: "ACH_ONE", unlockTime: 1 },
        { name: "ACH_TWO", unlockTime: 2 },
      ],
    });

    assert.equal(resolveUnlockedAchievementCount("steam", "10", 0), 2);
  });

  it("uses the schema length when the persisted total is missing", () => {
    AchievementMemoryStore.set("steam", "10", {
      achievements: [
        { name: "ACH_ONE" } as never,
        { name: "ACH_TWO" } as never,
        { name: "ACH_THREE" } as never,
      ],
      unlockedAchievements: [{ name: "ACH_ONE", unlockTime: 1 }],
    });

    assert.equal(resolveAchievementCount("steam", "10", 0), 3);
    assert.equal(resolveAchievementCount("steam", "10", 30), 30);
  });

  it("keeps local schema totals when remote catalogue count is zero", () => {
    AchievementMemoryStore.set("steam", "10", {
      achievements: Array.from({ length: 30 }, (_, index) => ({
        name: `ACH_${index}`,
      })) as never,
      unlockedAchievements: [
        { name: "ACH_0", unlockTime: 1 },
        { name: "ACH_1", unlockTime: 2 },
        { name: "ACH_2", unlockTime: 3 },
        { name: "ACH_3", unlockTime: 4 },
        { name: "ACH_4", unlockTime: 5 },
      ],
    });

    assert.deepEqual(
      mergePersistedAchievementTotals(
        "steam",
        "10",
        { achievementCount: 30, unlockedAchievementCount: 5 },
        { achievementCount: 0, unlockedAchievementCount: 0 }
      ),
      { achievementCount: 30, unlockedAchievementCount: 5 }
    );
  });
});
