import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { retroArchConfigCandidates } from "./retroarch-config-paths.js";

describe("RetroArch configuration paths", () => {
  it("finds the macOS config subfolder for standalone and Steam builds", () => {
    const home = "/Users/player";
    const executable = "/Applications/RetroArch.app/Contents/MacOS/RetroArch";
    const candidates = retroArchConfigCandidates(executable, "darwin", home);
    assert.ok(
      candidates.includes(
        path.join(
          home,
          "Library",
          "Application Support",
          "RetroArch",
          "config",
          "retroarch.cfg"
        )
      )
    );
    assert.ok(
      retroArchConfigCandidates(
        "/Games/RetroArch/retroarch",
        "darwin",
        home
      ).includes("/Games/RetroArch/config/retroarch.cfg")
    );
  });

  it("keeps portable Windows and Flatpak configs available", () => {
    assert.ok(
      retroArchConfigCandidates(
        "C:/Games/RetroArch/retroarch.exe",
        "win32",
        "/Users/player",
        "C:/Users/player/AppData/Roaming"
      ).includes(path.join("C:/Games/RetroArch", "retroarch.cfg"))
    );
    assert.ok(
      retroArchConfigCandidates(
        "/var/lib/flatpak/org.libretro.RetroArch/bin/retroarch",
        "linux",
        "/home/player"
      ).includes(
        path.join(
          "/home/player/.var/app/org.libretro.RetroArch/config/retroarch",
          "retroarch.cfg"
        )
      )
    );
  });
});
