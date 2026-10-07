import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { UmuOutputMonitor, parseUmuOutputLine } from "./umu-output-monitor.js";

describe("umu output parsing", () => {
  it("reports runtime setup progress without the wait suffix", () => {
    assert.deepEqual(
      parseUmuOutputLine(
        "INFO: Downloading steamrt3 (3.0.20260928.262393), please wait..."
      ),
      {
        type: "progress",
        message: "Downloading steamrt3 (3.0.20260928.262393)",
      }
    );
    assert.deepEqual(
      parseUmuOutputLine("INFO: Extracting UMU-Proton-10.0-4.tar.gz..."),
      { type: "progress", message: "Extracting UMU-Proton-10.0-4.tar.gz" }
    );
  });

  it("strips terminal colors before parsing", () => {
    assert.deepEqual(
      parseUmuOutputLine(
        "\u001b[34m\u001b[1mINFO\u001b[0m: Verifying integrity of sniper_platform_3.0..."
      ),
      {
        type: "progress",
        message: "Verifying integrity of sniper_platform_3.0",
      }
    );
  });

  it("ignores informational lines that are not setup progress", () => {
    assert.equal(parseUmuOutputLine("INFO: Using UMU-Proton-10.0-4"), null);
    assert.equal(parseUmuOutputLine("fsync: up and running."), null);
    assert.equal(parseUmuOutputLine("   "), null);
  });

  it("separates recoverable errors from fatal failures", () => {
    assert.deepEqual(
      parseUmuOutputLine(
        "ERROR: Digest mismatched: SteamLinuxRuntime_sniper.tar.xz"
      ),
      {
        type: "error",
        message: "Digest mismatched: SteamLinuxRuntime_sniper.tar.xz",
      }
    );
    assert.deepEqual(
      parseUmuOutputLine(
        "FileNotFoundError: _v2-entry-point (umu) cannot be found in '/home/user/.local/share/umu/steamrt3'"
      ),
      {
        type: "fatal",
        message:
          "FileNotFoundError: _v2-entry-point (umu) cannot be found in '/home/user/.local/share/umu/steamrt3'",
      }
    );
    assert.deepEqual(
      parseUmuOutputLine(
        "pv-adverb[106667]: E: Failed to execute child process “/home/user/.local/share/umu/steamrt4/umu-shim” (No such file or directory)"
      ),
      {
        type: "fatal",
        message:
          "Failed to execute child process “/home/user/.local/share/umu/steamrt4/umu-shim” (No such file or directory)",
      }
    );
  });
});

describe("umu output monitor", () => {
  it("joins lines split across chunks", () => {
    const monitor = new UmuOutputMonitor();
    assert.deepEqual(monitor.feed("INFO: Downloading UMU-"), []);
    assert.deepEqual(monitor.feed("Proton-10.0-4.tar.gz...\nINFO: Using"), [
      { type: "progress", message: "Downloading UMU-Proton-10.0-4.tar.gz" },
    ]);
    assert.deepEqual(monitor.flush(), []);
  });

  it("prefers the fatal failure over earlier recoverable errors", () => {
    const monitor = new UmuOutputMonitor();
    monitor.feed(
      [
        "ERROR: Digest mismatched: SteamLinuxRuntime_sniper.tar.xz",
        "Traceback (most recent call last):",
        "ValueError: Digest mismatched: SteamLinuxRuntime_sniper.tar.xz",
        "",
      ].join("\n")
    );
    assert.equal(monitor.hasFatalError, true);
    assert.equal(
      monitor.failureMessage,
      "ValueError: Digest mismatched: SteamLinuxRuntime_sniper.tar.xz"
    );
  });

  it("keeps the last recoverable error when nothing was fatal", () => {
    const monitor = new UmuOutputMonitor();
    monitor.feed("ERROR: Aborting steamrt install due to network error");
    monitor.flush();
    assert.equal(monitor.hasFatalError, false);
    assert.equal(
      monitor.failureMessage,
      "Aborting steamrt install due to network error"
    );
  });
});
