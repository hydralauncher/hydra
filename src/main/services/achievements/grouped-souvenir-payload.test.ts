import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PendingSouvenirAchievement } from "@types";

import {
  buildGroupedSouvenirSyncPayload,
  getGroupedSouvenirAchievementNames,
  MAX_ACHIEVEMENTS_PER_SOUVENIR,
} from "./grouped-souvenir-payload.js";

const buildAchievements = (count: number): PendingSouvenirAchievement[] =>
  Array.from({ length: count }, (_, index) => ({
    name: `ACHIEVEMENT_${index + 1}`,
    unlockTime: index + 1,
  }));

describe("grouped souvenir payload", () => {
  it("keeps every achievement when the souvenir is within the API limit", () => {
    const achievements = buildAchievements(3);

    assert.deepEqual(getGroupedSouvenirAchievementNames(achievements), [
      "ACHIEVEMENT_1",
      "ACHIEVEMENT_2",
      "ACHIEVEMENT_3",
    ]);
  });

  it("limits a souvenir to 50 achievements while syncing every achievement", () => {
    const achievements = buildAchievements(125);
    const payload = buildGroupedSouvenirSyncPayload(
      {
        capturedAt: 1,
        clientId: "client-id",
        imageKey: "achievement/image.jpeg",
        remoteGameId: "game-id",
      },
      achievements,
      true
    );
    const achievementNames = payload.souvenirs?.[0].achievementNames;

    assert.equal(achievementNames?.length, MAX_ACHIEVEMENTS_PER_SOUVENIR);
    assert.equal(achievementNames?.[0], "ACHIEVEMENT_1");
    assert.equal(achievementNames?.at(-1), "ACHIEVEMENT_50");
    assert.equal(payload.achievements.length, 125);
  });
});
