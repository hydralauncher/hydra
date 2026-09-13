import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PendingSouvenirAchievement } from "@types";

import {
  buildGroupedSouvenirSyncPayload,
  getGroupedSouvenirAchievementNames,
  MAX_ACHIEVEMENTS_PER_SOUVENIR,
} from "./grouped-souvenir-payload.js";

const SMALL_UNLOCK_COUNT = 3;
const BULK_UNLOCK_COUNT = 125;
const CAPTURED_AT = 1_787_342_400_000;

const buildAchievements = (count: number): PendingSouvenirAchievement[] =>
  Array.from({ length: count }, (_, index) => ({
    name: `ACHIEVEMENT_${index + 1}`,
    unlockTime: index + 1,
  }));

describe("grouped souvenir payload", () => {
  it("keeps every achievement when the souvenir is within the API limit", () => {
    const achievements = buildAchievements(SMALL_UNLOCK_COUNT);

    assert.deepEqual(getGroupedSouvenirAchievementNames(achievements), [
      "ACHIEVEMENT_1",
      "ACHIEVEMENT_2",
      "ACHIEVEMENT_3",
    ]);
  });

  it("limits a souvenir to 50 achievements while syncing every achievement", () => {
    const achievements = buildAchievements(BULK_UNLOCK_COUNT);
    const payload = buildGroupedSouvenirSyncPayload(
      {
        capturedAt: CAPTURED_AT,
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
    assert.equal(
      achievementNames?.at(-1),
      `ACHIEVEMENT_${MAX_ACHIEVEMENTS_PER_SOUVENIR}`
    );
    assert.equal(payload.achievements.length, BULK_UNLOCK_COUNT);
  });
});
