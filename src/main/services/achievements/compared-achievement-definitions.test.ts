import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ComparedAchievements } from "@types";
import { withComparedAchievementDefinitions } from "./compared-achievement-definitions.ts";

const row = (
  icon: string,
  displayName: string
): ComparedAchievements["achievements"][number] => ({
  hidden: false,
  icon,
  displayName,
  description: "",
  targetStat: { unlocked: false, unlockTime: 0 },
});

const singlePlayer = { id: 2, name: "Single Player", order: 0 };
const cooperative = { id: 1, name: "Cooperative", order: 1 };

describe("compared achievement definitions", () => {
  it("matches rows to catalogue definitions by icon", () => {
    const result = withComparedAchievementDefinitions(
      { achievements: [row("a.png", "Wake Up Call")] },
      [
        {
          icon: "a.png",
          displayName: "Hora de acordar",
          globalUnlockPercentage: 80.5,
          set: singlePlayer,
        },
      ]
    );

    assert.equal(result.achievements[0].globalUnlockPercentage, 80.5);
    assert.deepEqual(result.achievements[0].set, singlePlayer);
  });

  it("uses the display name when several definitions share an icon", () => {
    const result = withComparedAchievementDefinitions(
      {
        achievements: [row("shared.png", "Second"), row("shared.png", "First")],
      },
      [
        {
          icon: "shared.png",
          displayName: "First",
          globalUnlockPercentage: 50,
          set: singlePlayer,
        },
        {
          icon: "shared.png",
          displayName: "Second",
          globalUnlockPercentage: 5,
          set: cooperative,
        },
      ]
    );

    assert.equal(result.achievements[0].globalUnlockPercentage, 5);
    assert.deepEqual(result.achievements[0].set, cooperative);
    assert.equal(result.achievements[1].globalUnlockPercentage, 50);
  });

  it("leaves unmatched rows empty and keeps values the API already sent", () => {
    const result = withComparedAchievementDefinitions(
      {
        achievements: [
          row("missing.png", "Missing"),
          { ...row("a.png", "Kept"), globalUnlockPercentage: 9, set: null },
        ],
      },
      [
        {
          icon: "a.png",
          displayName: "Kept",
          globalUnlockPercentage: 70,
          set: singlePlayer,
        },
      ]
    );

    assert.equal(result.achievements[0].globalUnlockPercentage, null);
    assert.equal(result.achievements[0].set, null);
    assert.equal(result.achievements[1].globalUnlockPercentage, 9);
    assert.deepEqual(result.achievements[1].set, singlePlayer);
  });
});
