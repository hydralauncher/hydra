import { app } from "electron";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { logger } from "./logger";

const execFileAsync = promisify(execFile);
const taskName = "Hydra Overlay Input";
let installation: Promise<boolean> | null = null;

const taskContains = async (executable: string) => {
  try {
    const { stdout } = await execFileAsync(
      "schtasks.exe",
      ["/Query", "/TN", taskName, "/XML"],
      { windowsHide: true }
    );
    return stdout.toLowerCase().includes(executable.toLowerCase());
  } catch {
    return false;
  }
};

const runSetup = (executable: string) => {
  const escaped = executable.replaceAll("'", "''");
  const command = [
    `$action = New-ScheduledTaskAction -Execute '${escaped}'`,
    "$trigger = New-ScheduledTaskTrigger -Once -At ([datetime]'2099-01-01T00:00:00')",
    "$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest",
    `Register-ScheduledTask -TaskName '${taskName}' -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null`,
  ].join("; ");
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  return new Promise<boolean>((resolve) => {
    const setup = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`,
      ],
      { windowsHide: true, stdio: "ignore" }
    );
    setup.once("error", () => resolve(false));
    setup.once("exit", (code) => resolve(code === 0));
  });
};

const install = async () => {
  const resources = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const bundled = path.join(
    resources,
    "hydra-native",
    "hydra-overlay-input.exe"
  );
  if (!fs.existsSync(bundled)) return false;
  if (await taskContains(bundled)) return true;

  const stableDirectory = path.join(app.getPath("userData"), "overlay-input");
  const stable = path.join(stableDirectory, "hydra-overlay-input.exe");
  fs.mkdirSync(stableDirectory, { recursive: true });
  const stableTask = await taskContains(stable);
  const current = fs.existsSync(stable) ? fs.readFileSync(stable) : null;
  const bundledBytes = fs.readFileSync(bundled);
  if (!current?.equals(bundledBytes)) {
    try {
      fs.copyFileSync(bundled, stable);
    } catch (error) {
      if (!stableTask) throw error;
    }
  }
  if (stableTask) return true;
  if (!(await runSetup(stable))) return false;
  return taskContains(stable);
};

export const ensureOverlayInputBroker = () => {
  if (process.platform !== "win32") return Promise.resolve(false);
  if (!installation) {
    installation = install()
      .catch((error) => {
        logger.error("Failed to install the Hydra overlay input broker", error);
        return false;
      })
      .finally(() => {
        installation = null;
      });
  }
  return installation;
};
