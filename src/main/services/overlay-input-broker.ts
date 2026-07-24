import { app } from "electron";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import { logger } from "./logger";
import { NativeAddon } from "./native-addon";

const execFileAsync = promisify(execFile);
const taskName = "Hydra Overlay Input";
const brokerPipe = String.raw`\\.\pipe\HydraOverlayInputBroker`;
const systemRoot = process.env.SystemRoot ?? String.raw`C:\Windows`;
const taskScheduler = path.join(systemRoot, "System32", "schtasks.exe");
const powershell = path.join(
  systemRoot,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe"
);
let installation: Promise<boolean> | null = null;

export const getOverlayInputDirectory = () =>
  app.isPackaged
    ? path.join(app.getPath("userData"), "overlay-input")
    : path.join(app.getAppPath(), "hydra-native");

const filesMatch = (left: string, right: string) => {
  if (!fs.existsSync(left) || !fs.existsSync(right)) return false;
  return fs.readFileSync(left).equals(fs.readFileSync(right));
};

const taskContains = async (executable: string) => {
  try {
    const { stdout } = await execFileAsync(
      taskScheduler,
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
  const escapedPowershell = powershell.replaceAll("'", "''");
  return new Promise<boolean>((resolve) => {
    const setup = spawn(
      powershell,
      [
        "-NoProfile",
        "-Command",
        `Start-Process '${escapedPowershell}' -Verb RunAs -Wait -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`,
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
  const bundledPresentMon = path.join(
    resources,
    "presentmon",
    "PresentMon.exe"
  );
  if (!fs.existsSync(bundled) || !fs.existsSync(bundledPresentMon)) {
    return false;
  }
  if (await taskContains(bundled)) {
    const developmentPresentMon = path.join(
      path.dirname(bundled),
      "PresentMon.exe"
    );
    if (!filesMatch(bundledPresentMon, developmentPresentMon)) {
      fs.copyFileSync(bundledPresentMon, developmentPresentMon);
    }
    return true;
  }

  const stableDirectory = getOverlayInputDirectory();
  const stable = path.join(stableDirectory, "hydra-overlay-input.exe");
  const stablePresentMon = path.join(stableDirectory, "PresentMon.exe");
  fs.mkdirSync(stableDirectory, { recursive: true });
  const stableTask = await taskContains(stable);
  const needsUpdate =
    !filesMatch(bundled, stable) ||
    !filesMatch(bundledPresentMon, stablePresentMon);
  if (needsUpdate && stableTask) {
    await execFileAsync(taskScheduler, ["/End", "/TN", taskName], {
      windowsHide: true,
    }).catch(() => undefined);
  }
  if (needsUpdate) {
    fs.copyFileSync(bundled, stable);
    fs.copyFileSync(bundledPresentMon, stablePresentMon);
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

export const requestElevatedProcessTermination = async (pids: number[]) => {
  if (process.platform !== "win32" || !pids.length) return false;
  if (!(await ensureOverlayInputBroker())) return false;
  if (!NativeAddon.startOverlayInputBroker()) return false;

  const validPids = Array.from(
    new Set(pids.filter((pid) => pid > 0 && pid !== process.pid))
  );
  if (!validPids.length) return false;

  return new Promise<boolean>((resolve) => {
    let socket: net.Socket | null = null;
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket?.destroy();
      resolve(result);
    };
    const timeout = setTimeout(() => finish(false), 5_000);
    const connect = () => {
      if (settled) return;
      let response = "";
      socket = net.createConnection(brokerPipe);
      socket.setEncoding("utf8");
      socket.once("connect", () => socket?.write(validPids.join(" ")));
      socket.on("data", (chunk) => {
        response += chunk;
      });
      socket.once("end", () => finish(Number(response.trim()) > 0));
      socket.once("error", () => {
        if (Number(response.trim()) > 0) {
          finish(true);
          return;
        }
        socket?.destroy();
        if (!settled) setTimeout(connect, 100);
      });
    };
    connect();
  });
};
