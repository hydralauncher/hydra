import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  UmuOutputMonitor,
  getUmuSetupFailureMessage,
  parseUmuOutputLine,
  tailUmuLog,
} from "./umu-output-monitor.js";

describe("umu setup failure detection", () => {
  const baseInput = {
    exitCode: 0,
    signal: null,
    failureMessage: null,
    hasFatalError: false,
    gameDetected: false,
  };

  it("reports a fatal exception before game detection even with exit code 0", () => {
    const monitor = new UmuOutputMonitor();
    monitor.feed("INFO: Downloading steamrt3 (3.0.20260928.262393)...\n");
    monitor.feed(
      "Traceback (most recent call last):\nRuntimeError: runtime setup failed\n"
    );

    assert.equal(
      getUmuSetupFailureMessage({
        ...baseInput,
        failureMessage: monitor.failureMessage,
        hasFatalError: monitor.hasFatalError,
      }),
      "RuntimeError: runtime setup failed"
    );
  });

  it("reports non-zero exits before game detection without a fatal line", () => {
    assert.equal(
      getUmuSetupFailureMessage({
        ...baseInput,
        exitCode: 1,
        failureMessage: "runtime setup failed",
      }),
      "runtime setup failed"
    );
    assert.equal(
      getUmuSetupFailureMessage({ ...baseInput, exitCode: 1 }),
      "umu-run exited with code 1"
    );
    assert.equal(
      getUmuSetupFailureMessage({
        ...baseInput,
        exitCode: null,
        signal: "SIGKILL",
      }),
      "umu-run was terminated by SIGKILL"
    );
  });

  it("stays permissive once the game was detected", () => {
    assert.equal(
      getUmuSetupFailureMessage({
        ...baseInput,
        exitCode: 1,
        failureMessage: "runtime setup failed",
        gameDetected: true,
      }),
      null
    );
    assert.equal(
      getUmuSetupFailureMessage({
        ...baseInput,
        failureMessage: "RuntimeError: boom",
        hasFatalError: true,
        gameDetected: true,
      }),
      null
    );
    assert.equal(
      getUmuSetupFailureMessage({
        ...baseInput,
        exitCode: 1,
        failureMessage: "RuntimeError: boom",
        hasFatalError: true,
        gameDetected: true,
      }),
      "RuntimeError: boom"
    );
  });

  it("treats a clean exit without errors as success", () => {
    assert.equal(getUmuSetupFailureMessage(baseInput), null);
  });
});

describe("umu log tail", () => {
  it("reads appended output in bounded chunks without splitting characters", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "umu-tail-"));
    const logPath = path.join(directory, "umu.log");
    fs.writeFileSync(logPath, "previous launch\n");
    const content = `${"é".repeat(200_000)}\nINFO: Extracting runtime...\n`;

    try {
      const chunks: string[] = [];
      const stop = tailUmuLog(logPath, fs.statSync(logPath).size, (chunk) =>
        chunks.push(chunk)
      );
      fs.appendFileSync(logPath, content);
      stop();

      assert.ok(chunks.length > 1);
      assert.equal(chunks.join(""), content);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

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
    assert.equal(parseUmuOutputLine("Note: shader cache is warm"), null);
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
