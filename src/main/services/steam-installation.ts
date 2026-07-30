import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { logger } from "./logger";
import { getSteamLocation } from "./steam";
import {
  isFlatpakSteamInstalled,
  resolveSteamBinaryPath,
} from "./steam-library";
import { SystemPath } from "./system-path";

const FLATPAK_APPLICATION_ID = "com.valvesoftware.Steam";

const FLATPAK_BINARY_NAME = "flatpak";

const FLATPAK_STEAM_ROOT = [
  ".var",
  "app",
  FLATPAK_APPLICATION_ID,
  ".local",
  "share",
  "Steam",
];

const NATIVE_PID_FILE = [".steam", "steam.pid"];

const READY_PROCESS_NAME = "steamwebhelper";

export type SteamInstallationKind = "native" | "flatpak";

export interface SteamInstallation {
  kind: SteamInstallationKind;
  rootPath: string;
  isRunning: () => boolean;
  spawnSteam: (args: string[]) => boolean;
}

const readProcessCommandLines = () => {
  let entries: string[];

  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return [];
  }

  const commandLines: string[] = [];

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;

    try {
      commandLines.push(
        fs.readFileSync(path.join("/proc", entry, "cmdline"), "utf-8")
      );
    } catch {
      continue;
    }
  }

  return commandLines;
};

const isNativeSteamRunning = () => {
  const pidFilePath = path.join(SystemPath.getPath("home"), ...NATIVE_PID_FILE);

  try {
    const pid = Number.parseInt(
      fs.readFileSync(pidFilePath, "utf-8").trim(),
      10
    );

    if (!Number.isInteger(pid) || pid <= 0) return false;

    return fs.existsSync(path.join("/proc", String(pid)));
  } catch {
    return false;
  }
};

const isFlatpakSteamRunning = () =>
  readProcessCommandLines().some(
    (commandLine) =>
      commandLine.includes(FLATPAK_APPLICATION_ID) &&
      commandLine.includes(READY_PROCESS_NAME)
  );

const spawnDetached = (command: string, args: string[]) => {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });

    child.on("error", (error) =>
      logger.error("Failed to run the Steam client", { command, args, error })
    );

    child.unref();

    return true;
  } catch (error) {
    logger.error("Failed to run the Steam client", { command, args, error });
    return false;
  }
};

const resolveFlatpakInstallation = (): SteamInstallation | null => {
  if (!isFlatpakSteamInstalled()) return null;

  return {
    kind: "flatpak",
    rootPath: path.join(SystemPath.getPath("home"), ...FLATPAK_STEAM_ROOT),
    isRunning: isFlatpakSteamRunning,
    spawnSteam: (args) =>
      spawnDetached(FLATPAK_BINARY_NAME, [
        "run",
        FLATPAK_APPLICATION_ID,
        ...args,
      ]),
  };
};

const resolveNativeInstallation =
  async (): Promise<SteamInstallation | null> => {
    const rootPath = await getSteamLocation().catch(() => null);

    if (!rootPath || !fs.existsSync(rootPath)) return null;

    const steamBinaryPath = resolveSteamBinaryPath();

    if (!steamBinaryPath) return null;

    return {
      kind: "native",
      rootPath,
      isRunning: isNativeSteamRunning,
      spawnSteam: (args) => spawnDetached(steamBinaryPath, args),
    };
  };

export const resolveSteamInstallation = async () => {
  const [native, flatpak] = [
    await resolveNativeInstallation(),
    resolveFlatpakInstallation(),
  ];

  const running = [native, flatpak].find(
    (installation) => installation?.isRunning() === true
  );

  const installation = running ?? native ?? flatpak ?? null;

  if (installation) {
    logger.info("Resolved the Steam installation to use", {
      kind: installation.kind,
      rootPath: installation.rootPath,
      alreadyRunning: Boolean(running),
    });
  }

  return installation;
};
