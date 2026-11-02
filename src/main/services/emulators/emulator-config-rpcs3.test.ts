import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { rpcs3GuiConfigsCandidates } from "./emulator-config.js";

describe("RPCS3 config candidates", () => {
  it("includes the macOS Application Support config first", () => {
    const candidates = rpcs3GuiConfigsCandidates(
      null,
      "darwin",
      "/home/player"
    );
    assert.equal(
      candidates[0],
      path.join(
        "/home/player",
        "Library",
        "Application Support",
        "rpcs3",
        "GuiConfigs",
        "persistent_settings.dat"
      )
    );
  });

  it("keeps Linux config and portable installs available", () => {
    const candidates = rpcs3GuiConfigsCandidates(
      "/opt/rpcs3/rpcs3",
      "linux",
      "/home/player"
    );
    assert.equal(
      candidates[0],
      path.join(
        "/home/player",
        ".config",
        "rpcs3",
        "GuiConfigs",
        "persistent_settings.dat"
      )
    );
    assert.ok(
      candidates.includes(
        path.join("/opt/rpcs3", "GuiConfigs", "persistent_settings.dat")
      )
    );
  });

  it("includes absolute XDG_CONFIG_HOME on Linux", () => {
    const candidates = rpcs3GuiConfigsCandidates(
      null,
      "linux",
      "/home/player",
      "/custom/config"
    );
    assert.ok(
      candidates.includes(
        path.join(
          "/custom/config",
          "rpcs3",
          "GuiConfigs",
          "persistent_settings.dat"
        )
      )
    );
    const relative = rpcs3GuiConfigsCandidates(
      null,
      "linux",
      "/home/player",
      "relative/config"
    );
    assert.ok(
      !relative.some((candidate) => candidate.includes("relative/config"))
    );
  });
});
