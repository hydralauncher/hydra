import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getRetroArchExecutableStatus,
  isRetroArchExecutableError,
  isRetroArchSetupBlocked,
  RETROARCH_CONFIG_SETTINGS_URL,
} from "./retroarch-executable-status.js";

describe("RetroArch Cloud Save executable", () => {
  it("asks for configuration only when the executable is absent or gone", async () => {
    let checks = 0;
    const check = async () => {
      checks++;
      return { exists: true };
    };

    assert.equal(
      await getRetroArchExecutableStatus(
        async () => ({ executablePath: null }),
        check
      ),
      "missing"
    );
    assert.equal(checks, 0);
    assert.equal(
      await getRetroArchExecutableStatus(
        async () => ({ executablePath: "/retroarch" }),
        async () => ({ exists: false })
      ),
      "invalid"
    );
    assert.equal(
      await getRetroArchExecutableStatus(
        async () => ({ executablePath: "/retroarch" }),
        check
      ),
      "ready"
    );
  });

  it("keeps read failures distinct from an unconfigured emulator", async () => {
    assert.equal(
      await getRetroArchExecutableStatus(
        async () => {
          throw new Error("config unavailable");
        },
        async () => ({ exists: true })
      ),
      "error"
    );
    assert.equal(
      await getRetroArchExecutableStatus(
        async () => ({ executablePath: "/retroarch" }),
        async () => {
          throw new Error("check failed");
        }
      ),
      "error"
    );
    assert.equal(isRetroArchSetupBlocked("checking"), true);
    assert.equal(isRetroArchSetupBlocked("ready"), false);
    assert.equal(isRetroArchSetupBlocked(null), false);
  });

  it("links to the emulator executable settings", () => {
    assert.equal(
      RETROARCH_CONFIG_SETTINGS_URL,
      "/settings?tab=emulation&system=retroarch&section=emulator"
    );
  });

  it("recognizes a path removed after the UI check", () => {
    assert.equal(
      isRetroArchExecutableError(
        new Error("cloud_save_retroarch_executable_missing")
      ),
      true
    );
    assert.equal(
      isRetroArchExecutableError("cloud_save_retroarch_not_configured"),
      true
    );
    assert.equal(
      isRetroArchExecutableError("cloud_save_retroarch_config_unresolved"),
      false
    );
  });
});
