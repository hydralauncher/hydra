import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseEmulatorAchievementLogLine } from "./emulator-achievement-log.js";

describe("emulator achievement logs", () => {
  it("reads a PPSSPP achievement ID and title", () => {
    assert.deepEqual(
      parseEmulatorAchievementLogLine(
        "psp",
        "45:12:345 Core/Achievements: Achievement unlocked: 'First Victory' (12345)"
      ),
      { id: "12345", title: "First Victory" }
    );
  });

  it("keeps apostrophes in PPSSPP achievement titles", () => {
    assert.deepEqual(
      parseEmulatorAchievementLogLine(
        "psp",
        "Achievement unlocked: 'It's About Time' (57)"
      ),
      { id: "57", title: "It's About Time" }
    );
  });

  it("reads a Dolphin rcheevos achievement ID and title", () => {
    assert.deepEqual(
      parseEmulatorAchievementLogLine(
        "dolphin",
        "42:01:123 Achievements Info: Awarding achievement 9876: Finish the Fight"
      ),
      { id: "9876", title: "Finish the Fight" }
    );
  });

  it("ignores Dolphin spectator and unofficial events", () => {
    assert.equal(
      parseEmulatorAchievementLogLine(
        "dolphin",
        "Spectated achievement 9876: Finish the Fight"
      ),
      null
    );
    assert.equal(
      parseEmulatorAchievementLogLine(
        "dolphin",
        "Unlocked unofficial achievement 9876: Finish the Fight"
      ),
      null
    );
  });
});
