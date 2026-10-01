import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executeSystemPowerAction,
  getSystemPowerCommand,
} from "./system-power.ts";

describe("system power actions", () => {
  it("rejects invalid actions before running any command", async () => {
    let called = false;
    const run = async () => {
      called = true;
      return { stdout: "", stderr: "" };
    };

    for (const action of [
      null,
      undefined,
      {},
      "poweroff",
      "restart; echo bad",
    ]) {
      await assert.rejects(executeSystemPowerAction(action, "linux", run), {
        message: "Invalid system power action",
      });
    }
    assert.equal(called, false);
  });

  it("rejects unsupported platforms", () => {
    assert.throws(() => getSystemPowerCommand("restart", "freebsd"), {
      message: "System power actions are not supported on this platform",
    });
  });

  it("lets applications block Windows shutdown and restart", () => {
    for (const [action, flag] of [
      ["power-off", "/s"],
      ["restart", "/r"],
    ]) {
      assert.deepEqual(getSystemPowerCommand(action, "win32", "C:\\Windows"), {
        file: "C:\\Windows\\System32\\shutdown.exe",
        args: [flag, "/t", "0"],
      });
    }
  });

  it("requests Windows sleep with wake events enabled and reports refusal", () => {
    const command = getSystemPowerCommand("suspend", "win32", "D:\\Windows");
    assert.equal(
      command.file,
      "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
    );
    assert.deepEqual(command.args.slice(0, 3), [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
    ]);
    assert.match(command.args[3], /PowerState\]::Suspend, \$false, \$false/);
    assert.match(
      command.args[3],
      /if \(-not .*throw 'Windows refused to suspend'/
    );
  });

  it("uses normal systemd requests without bypassing inhibitors", () => {
    for (const [action, command] of [
      ["power-off", "poweroff"],
      ["restart", "reboot"],
      ["suspend", "suspend"],
    ]) {
      assert.deepEqual(getSystemPowerCommand(action, "linux"), {
        file: "systemctl",
        args: [command],
      });
    }
  });

  it("asks macOS System Events to perform each action", () => {
    for (const [action, command] of [
      ["power-off", "shut down"],
      ["restart", "restart"],
      ["suspend", "sleep"],
    ]) {
      assert.deepEqual(getSystemPowerCommand(action, "darwin"), {
        file: "/usr/bin/osascript",
        args: ["-e", `tell application "System Events" to ${command}`],
      });
    }
  });

  it("runs one fixed executable with arguments and surfaces permission failures", async () => {
    let calls = 0;
    await assert.rejects(
      executeSystemPowerAction(
        "power-off",
        "linux",
        async (file, args, opts) => {
          calls++;
          assert.equal(file, "systemctl");
          assert.deepEqual(args, ["poweroff"]);
          assert.deepEqual(opts, { windowsHide: true });
          throw new Error("Access denied");
        }
      ),
      { message: "Access denied" }
    );
    assert.equal(calls, 1);
  });
});
