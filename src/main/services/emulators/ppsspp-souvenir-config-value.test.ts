import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPPSSPPSouvenirLaunchArguments,
  enablePPSSPPAchievementLog,
} from "./ppsspp-souvenir-config-value.js";

describe("PPSSPP souvenir configuration", () => {
  it("enables info-level achievement logging in the session config", () => {
    assert.equal(
      enablePPSSPPAchievementLog("[General]\nFirstRun = false"),
      "[General]\nFirstRun = false\n\n[Log]\nAchievementsEnabled = true\n\nAchievementsLevel = 4"
    );
  });

  it("replaces existing achievement log settings case-insensitively", () => {
    const config = [
      "[Log]",
      "ACHIEVEMENTSEnabled = false",
      "ACHIEVEMENTSLevel = 2",
      "SYSTEMEnabled = true",
    ].join("\n");

    assert.equal(
      enablePPSSPPAchievementLog(config),
      [
        "[Log]",
        "AchievementsEnabled = true",
        "AchievementsLevel = 4",
        "SYSTEMEnabled = true",
      ].join("\n")
    );
  });

  it("forces PPSSPP's runtime log level to include unlock events", () => {
    assert.deepEqual(
      buildPPSSPPSouvenirLaunchArguments("hydra-souvenirs.ini", "/tmp/run.log"),
      ["--config=hydra-souvenirs.ini", "--loglevel=4", "--log=/tmp/run.log"]
    );
  });
});
