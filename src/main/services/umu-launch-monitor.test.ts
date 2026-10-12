import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  UmuEarlyExitError,
  observeUmuLaunch,
  type UmuStatus,
} from "./umu-launch-monitor.js";

const QUICK_EXIT_THRESHOLD_MS = 150;

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

let directory: string;
let logPath: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "umu-launch-"));
  logPath = path.join(directory, "umu.log");
  fs.writeFileSync(logPath, "previous launch output\n");
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

const launchFakeUmu = (
  script: string,
  options: { wasGameDetected?: () => boolean } = {}
) => {
  const statuses: UmuStatus[] = [];
  const logStartOffset = fs.statSync(logPath).size;
  const descriptor = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, ["-e", script], {
    stdio: ["ignore", descriptor, descriptor],
  });
  fs.closeSync(descriptor);
  const exited = once(child, "exit");
  const launched = observeUmuLaunch({
    child,
    umuLogPath: logPath,
    logStartOffset,
    quickExitThresholdMs: QUICK_EXIT_THRESHOLD_MS,
    onStatus: (status) => statuses.push(status),
    wasGameDetected: options.wasGameDetected,
  });
  return { child, statuses, exited, launched };
};

describe("umu launch monitor", () => {
  it("reports a delayed non-zero exit without a recognized fatal line", async () => {
    const { statuses, exited, launched } = launchFakeUmu(`
      console.log("INFO: umu-launcher version 1.4.4");
      setTimeout(() => {
        console.log("ERROR: runtime setup failed");
        process.exit(1);
      }, 400);
    `);

    await launched;
    await exited;

    assert.deepEqual(statuses, [
      { type: "progress", message: null },
      { type: "failed", message: "runtime setup failed" },
    ]);
  });

  it("reports a delayed non-zero exit with unparseable output", async () => {
    const { statuses, exited, launched } = launchFakeUmu(`
      setTimeout(() => {
        console.log("something went wrong");
        process.exit(3);
      }, 400);
    `);

    await launched;
    await exited;

    assert.deepEqual(statuses.at(-1), {
      type: "failed",
      message: "umu-run exited with code 3",
    });
  });

  it("reports a delayed fatal exception that exits with code 0", async () => {
    const { statuses, exited, launched } = launchFakeUmu(`
      setTimeout(() => {
        console.log("Traceback (most recent call last):");
        console.log("RuntimeError: runtime setup failed");
        process.exit(0);
      }, 400);
    `);

    await launched;
    await exited;

    assert.deepEqual(statuses.at(-1), {
      type: "failed",
      message: "RuntimeError: runtime setup failed",
    });
  });

  it("sends preparing before umu prints its first progress line", async () => {
    const { statuses, exited, launched } = launchFakeUmu(`
      console.log("INFO: umu-launcher version 1.4.4");
      setTimeout(() => {
        console.log("INFO: Downloading steamrt3 (3.0.20260928.262393), please wait...");
      }, 900);
      setTimeout(() => process.exit(0), 1300);
    `);

    await launched;
    await delay(300);
    assert.deepEqual(statuses, [{ type: "progress", message: null }]);

    await exited;
    assert.deepEqual(statuses, [
      { type: "progress", message: null },
      {
        type: "progress",
        message: "Downloading steamrt3 (3.0.20260928.262393)",
      },
      { type: "ready" },
    ]);
  });

  it("stays permissive after the game was detected", async () => {
    const { statuses, exited, launched } = launchFakeUmu(
      `
      setTimeout(() => {
        console.log("ERROR: wine reported something");
        process.exit(1);
      }, 400);
    `,
      { wasGameDetected: () => true }
    );

    await launched;
    await exited;

    assert.deepEqual(statuses, [
      { type: "progress", message: null },
      { type: "ready" },
    ]);
  });

  it("rejects early exits with the umu failure detail", async () => {
    const { exited, launched } = launchFakeUmu(`
      console.log("ERROR: runtime setup failed");
      process.exit(2);
    `);

    await assert.rejects(launched, (error: unknown) => {
      assert.ok(error instanceof UmuEarlyExitError);
      assert.match(error.message, /code=2/);
      assert.match(error.message, /runtime setup failed/);
      return true;
    });
    await exited;
  });
});
