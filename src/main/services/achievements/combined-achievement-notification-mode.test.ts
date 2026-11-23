import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCombinedAchievementNotificationMode } from "./combined-achievement-notification-mode.ts";

describe("getCombinedAchievementNotificationMode", () => {
  it("stays silent when achievement notifications are disabled", () => {
    for (const platform of ["win32", "linux", "darwin"] as const) {
      assert.equal(
        getCombinedAchievementNotificationMode(
          { achievementNotificationsEnabled: false },
          platform
        ),
        "none"
      );
    }
  });

  it("uses the custom notification on Windows by default", () => {
    assert.equal(getCombinedAchievementNotificationMode({}, "win32"), "custom");
    assert.equal(
      getCombinedAchievementNotificationMode(null, "win32"),
      "custom"
    );
  });

  it("falls back to the system notification otherwise", () => {
    assert.equal(getCombinedAchievementNotificationMode({}, "linux"), "system");
    assert.equal(
      getCombinedAchievementNotificationMode(
        { achievementCustomNotificationsEnabled: false },
        "win32"
      ),
      "system"
    );
  });
});
