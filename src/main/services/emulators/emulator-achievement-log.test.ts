import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getEmulatorAchievementLogFormat,
  parseEmulatorAchievementLogLine,
} from "./emulator-achievement-log.js";

const parse = (
  system: Parameters<typeof getEmulatorAchievementLogFormat>[0],
  line: string
) => {
  const format = getEmulatorAchievementLogFormat(system);
  assert.ok(format);
  return parseEmulatorAchievementLogLine(line, format);
};

describe("emulator achievement log parsing", () => {
  it("parses RetroArch rcheevos award lines for every RetroArch platform", () => {
    for (const platform of [
      "nes",
      "snes",
      "n64",
      "gb",
      "gbc",
      "gba",
    ] as const) {
      assert.deepEqual(
        parse(
          platform,
          "[INFO] [RCHEEVOS] Awarding achievement 4821: Bonus Stage Clear"
        ),
        { id: "4821", title: "Bonus Stage Clear" }
      );
    }
  });

  it("parses Dolphin award lines", () => {
    assert.deepEqual(
      parse(
        "dolphin",
        "52:31:221 Core\\AchievementManager.cpp:1056 I[Achievements]: Awarding achievement 123: Star Get"
      ),
      { id: "123", title: "Star Get" }
    );
  });

  it("parses DuckStation, PCSX2 and PPSSPP unlock lines", () => {
    assert.deepEqual(
      parse("ps1", "Achievement 77 (Gold Rush) for game 900 unlocked"),
      { id: "77", title: "Gold Rush" }
    );
    assert.deepEqual(
      parse(
        "ps2",
        "Achievements: Achievement Gold Rush (78) for game 901 unlocked"
      ),
      { id: "78", title: "Gold Rush" }
    );
    assert.deepEqual(parse("psp", "Achievement unlocked: 'Gold Rush' (79)"), {
      id: "79",
      title: "Gold Rush",
    });
  });

  it("ignores unrelated lines", () => {
    assert.equal(
      parse("snes", "[INFO] [RCHEEVOS] Loaded 12 achievements"),
      null
    );
  });

  it("has no log format for RPCS3", () => {
    assert.equal(getEmulatorAchievementLogFormat("ps3"), null);
  });
});
