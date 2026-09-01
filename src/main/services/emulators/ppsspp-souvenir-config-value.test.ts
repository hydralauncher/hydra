import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { enablePPSSPPAchievementLog } from "./ppsspp-souvenir-config-value.js";

describe("PPSSPP souvenir configuration", () => {
  it("enables the Achievements channel at Info in a copied config", () => {
    const original =
      "[Log]\nAchievementsEnabled = false\nAchievementsLevel = 2\nUILevel = 5\n";
    const enabled = enablePPSSPPAchievementLog(original);

    assert.match(enabled, /AchievementsEnabled = true/);
    assert.match(enabled, /AchievementsLevel = 4/);
    assert.match(enabled, /UILevel = 5/);
  });

  it("adds values that are absent from the copied config", () => {
    const original = "[Log]\nUILevel = 5\n";
    const enabled = enablePPSSPPAchievementLog(original);

    assert.match(enabled, /AchievementsEnabled = true/);
    assert.match(enabled, /AchievementsLevel = 4/);
  });
});
