import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { ppssppConfigCandidates } from "./ppsspp-paths.js";

describe("PPSSPP config paths", () => {
  it("finds native Linux and AppImage saves under XDG config", () => {
    const candidates = ppssppConfigCandidates(
      "/home/user/Downloads/PPSSPP.AppImage",
      {
        platform: "linux",
        home: "/home/user",
        environment: {},
      }
    );

    assert.ok(
      candidates.includes("/home/user/.config/ppsspp/PSP/SYSTEM/ppsspp.ini")
    );
  });

  it("prioritizes the Flatpak config sandbox", () => {
    const candidates = ppssppConfigCandidates(
      "/home/user/.local/share/flatpak/exports/bin/org.ppsspp.PPSSPP",
      {
        platform: "linux",
        home: "/home/user",
        environment: {},
      }
    );

    assert.equal(
      candidates[2],
      "/home/user/.var/app/org.ppsspp.PPSSPP/config/ppsspp/PSP/SYSTEM/ppsspp.ini"
    );
  });

  it("checks both portable and Documents locations on Windows", () => {
    const executable = "/emulators/PPSSPP/PPSSPPWindows64.exe";
    const candidates = ppssppConfigCandidates(executable, {
      platform: "win32",
      home: "/users/test-user",
      environment: {},
    });

    assert.deepEqual(candidates, [
      path.join(
        path.dirname(executable),
        "memstick",
        "PSP",
        "SYSTEM",
        "ppsspp.ini"
      ),
      path.join(path.dirname(executable), "PSP", "SYSTEM", "ppsspp.ini"),
      path.join(
        "/users/test-user",
        "Documents",
        "PPSSPP",
        "PSP",
        "SYSTEM",
        "ppsspp.ini"
      ),
    ]);
  });
});
