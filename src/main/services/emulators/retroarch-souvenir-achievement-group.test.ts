import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserAchievement } from "@types";
import {
  groupRetroArchSouvenirAchievements,
  partitionHandledRetroArchSouvenirs,
} from "./retroarch-souvenir-achievement-group.js";

const createAchievement = (
  name: string,
  unlockTime: number | null
): UserAchievement => ({
  name,
  displayName: `Achievement ${name}`,
  description: "",
  icon: "",
  icongray: "",
  hidden: false,
  unlocked: unlockTime !== null,
  unlockTime,
});

describe("RetroArch souvenir achievement grouping", () => {
  it("adds achievements with the same canonical unlock time", () => {
    const grouped = groupRetroArchSouvenirAchievements(
      [{ id: "9459", title: "9459" }],
      [
        createAchievement("9459", 1_787_323_454_000),
        createAchievement("9460", 1_787_323_454_000),
        createAchievement("9461", 1_787_323_500_000),
      ]
    );

    assert.deepEqual(grouped, [
      {
        id: "9459",
        title: "9459",
        unlockTime: 1_787_323_454_000,
      },
      {
        id: "9460",
        title: "Achievement 9460",
        unlockTime: 1_787_323_454_000,
      },
    ]);
  });

  it("does not group achievements with a different unlock time", () => {
    const detected = [{ id: "9459", title: "9459" }];
    const grouped = groupRetroArchSouvenirAchievements(detected, [
      createAchievement("9459", 1_000),
      createAchievement("9460", 2_000),
    ]);

    assert.deepEqual(grouped, [
      { id: "9459", title: "9459", unlockTime: 1_000 },
    ]);
  });

  it("keeps the detected achievements when progress is unavailable", () => {
    const detected = [{ id: "9459", title: "9459" }];

    assert.deepEqual(
      groupRetroArchSouvenirAchievements(detected, []),
      detected
    );
  });

  it("separates delayed screenshots for an achievement already grouped", () => {
    const primaryScreenshot = {
      entry: "game-cheevo-9459.png",
      achievement: { id: "9459" },
    };
    const delayedScreenshot = {
      entry: "game-cheevo-9460.png",
      achievement: { id: "9460" },
    };

    assert.deepEqual(
      partitionHandledRetroArchSouvenirs(
        [primaryScreenshot, delayedScreenshot],
        new Set(["9460"])
      ),
      {
        handled: [delayedScreenshot],
        unhandled: [primaryScreenshot],
      }
    );
  });
});
