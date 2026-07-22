import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { AchievementMemoryStore } from "./achievement-memory-store.js";

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
});
