import { execFile } from "node:child_process";
import { win32 } from "node:path";
import { promisify } from "node:util";
import type { SystemPowerAction } from "../../types/system-power";

const execFileAsync = promisify(execFile);
type PowerCommandRunner = (
  file: string,
  args: string[],
  options: { windowsHide: boolean }
) => Promise<unknown>;

// Windows Forms enables the shutdown privilege before calling SetSuspendState.
// Suspend is explicit, and wake events remain enabled.
const WINDOWS_SUSPEND_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Windows.Forms",
  "if (-not [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)) { throw 'Windows refused to suspend' }",
].join("; ");

export function getSystemPowerCommand(
  action: unknown,
  platform: NodeJS.Platform,
  windowsDirectory = process.env.SystemRoot || String.raw`C:\Windows`
): { file: string; args: string[] } {
  if (action !== "power-off" && action !== "restart" && action !== "suspend") {
    throw new Error("Invalid system power action");
  }

  if (platform === "win32") {
    if (action === "suspend") {
      return {
        file: win32.join(
          windowsDirectory,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe"
        ),
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          WINDOWS_SUSPEND_SCRIPT,
        ],
      };
    }

    return {
      file: win32.join(windowsDirectory, "System32", "shutdown.exe"),
      // A positive timeout implies /f. Keep applications free to block shutdown.
      args: [action === "power-off" ? "/s" : "/r", "/t", "0"],
    };
  }

  if (platform === "linux") {
    const commands: Record<SystemPowerAction, string> = {
      "power-off": "poweroff",
      restart: "reboot",
      suspend: "suspend",
    };
    return { file: "systemctl", args: [commands[action]] };
  }

  if (platform === "darwin") {
    const commands: Record<SystemPowerAction, string> = {
      "power-off": "shut down",
      restart: "restart",
      suspend: "sleep",
    };
    return {
      file: "/usr/bin/osascript",
      args: ["-e", `tell application "System Events" to ${commands[action]}`],
    };
  }

  throw new Error("System power actions are not supported on this platform");
}

export async function executeSystemPowerAction(
  action: unknown,
  platform: NodeJS.Platform = process.platform,
  runCommand: PowerCommandRunner = execFileAsync
) {
  const { file, args } = getSystemPowerCommand(action, platform);
  await runCommand(file, args, { windowsHide: true });
}
