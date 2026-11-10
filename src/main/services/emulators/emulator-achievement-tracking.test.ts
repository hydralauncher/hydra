import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserPreferences } from "@types";
import {
  isEmulatorAchievementTrackingActive,
  resolveEmulatorAchievementTracking,
} from "./emulator-achievement-tracking.js";

const connected = {
  retroAchievementsUsername: "player",
  retroAchievementsWebApiKey: "key",
} as UserPreferences;

describe("emulator achievement tracking", () => {
  it("enables realtime unlocks without a subscription", () => {
    const tracking = resolveEmulatorAchievementTracking(
      connected,
      false,
      "win32"
    );

    assert.deepEqual(tracking, { souvenirs: false, realtimeUnlocks: true });
    assert.equal(isEmulatorAchievementTrackingActive(tracking), true);
  });

  it("requires a subscription for souvenirs", () => {
    assert.equal(
      resolveEmulatorAchievementTracking(
        { enableAchievementSouvenirs: true } as UserPreferences,
        false,
        "win32"
      ).souvenirs,
      false
    );
    assert.equal(
      resolveEmulatorAchievementTracking(
        { enableAchievementSouvenirs: true } as UserPreferences,
        true,
        "win32"
      ).souvenirs,
      true
    );
  });

  it("requires both RetroAchievements credentials for realtime unlocks", () => {
    assert.equal(
      resolveEmulatorAchievementTracking(
        { retroAchievementsUsername: "player" } as UserPreferences,
        true,
        "win32"
      ).realtimeUnlocks,
      false
    );
  });

  it("is inactive when neither feature applies", () => {
    const tracking = resolveEmulatorAchievementTracking(
      { enableAchievementSouvenirs: false } as UserPreferences,
      true,
      "win32"
    );

    assert.equal(isEmulatorAchievementTrackingActive(tracking), false);
  });
});
