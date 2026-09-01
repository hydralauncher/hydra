import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { dolphinLogCandidates } from "./emulator-log-paths.js";

describe("Dolphin log paths", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses the Flatpak data directory on Linux", () => {
    const home = "/home/player";
    const candidates = dolphinLogCandidates(
      "/home/player/.local/share/flatpak/exports/bin/org.DolphinEmu.dolphin-emu",
      { platform: "linux", home, environment: {} }
    );

    assert.equal(
      candidates[0],
      "/home/player/.var/app/org.DolphinEmu.dolphin-emu/data/dolphin-emu/Logs/dolphin.log"
    );
  });

  it("honors Dolphin's Linux user-path environment variable", () => {
    const candidates = dolphinLogCandidates("/usr/bin/dolphin-emu", {
      platform: "linux",
      home: "/home/player",
      environment: { DOLPHIN_EMU_USERPATH: "/games/dolphin-user" },
    });

    assert.equal(candidates[0], "/games/dolphin-user/Logs/dolphin.log");
  });

  it("uses a portable user directory beside the executable", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "hydra-dolphin-portable-")
    );
    temporaryDirectories.push(directory);
    fs.writeFileSync(path.join(directory, "portable.txt"), "");

    const candidates = dolphinLogCandidates(
      path.join(directory, "Dolphin.exe"),
      { platform: "win32", home: "C:\\Users\\player", environment: {} }
    );

    assert.equal(
      candidates[0],
      path.join(directory, "User", "Logs", "dolphin.log")
    );
  });
});
