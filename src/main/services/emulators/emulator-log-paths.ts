import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  duckstationConfigCandidates,
  findExistingConfig,
  pcsx2ConfigCandidates,
} from "./emulator-config.js";

export const duckstationLogPath = () => {
  const configPath = findExistingConfig(duckstationConfigCandidates());

  if (!configPath) return null;

  return path.join(path.dirname(configPath), "duckstation.log");
};

export const pcsx2LogPath = (executablePath: string | null) => {
  const configPath = findExistingConfig(pcsx2ConfigCandidates(executablePath));

  if (!configPath) return null;

  return path.join(
    path.dirname(path.dirname(configPath)),
    "logs",
    "emulog.txt"
  );
};

export const dolphinUserDirectoryCandidates = (
  executablePath: string
): string[] => {
  const platform = process.platform;
  const home = os.homedir();
  const environment = process.env;
  const executableDirectory = path.dirname(executablePath);
  const userDirectories: string[] = [];

  if (fs.existsSync(path.join(executableDirectory, "portable.txt"))) {
    userDirectories.push(
      path.join(executableDirectory, platform === "linux" ? "user" : "User")
    );
  }

  if (platform === "win32") {
    const appData =
      environment.APPDATA ?? path.join(home, "AppData", "Roaming");
    userDirectories.push(path.join(appData, "Dolphin Emulator"));
  } else if (platform === "darwin") {
    userDirectories.push(
      path.join(home, "Library", "Application Support", "Dolphin")
    );
  } else {
    if (environment.DOLPHIN_EMU_USERPATH) {
      userDirectories.push(environment.DOLPHIN_EMU_USERPATH);
    }

    if (executablePath.includes("org.DolphinEmu.dolphin-emu")) {
      userDirectories.push(
        path.join(
          home,
          ".var",
          "app",
          "org.DolphinEmu.dolphin-emu",
          "data",
          "dolphin-emu"
        )
      );
    }

    userDirectories.push(
      path.join(home, ".dolphin-emu"),
      path.join(
        environment.XDG_DATA_HOME ?? path.join(home, ".local", "share"),
        "dolphin-emu"
      )
    );
  }

  return Array.from(new Set(userDirectories));
};

const dolphinLogCandidates = (executablePath: string): string[] => {
  return dolphinUserDirectoryCandidates(executablePath).map((userDirectory) =>
    path.join(userDirectory, "Logs", "dolphin.log")
  );
};

export const dolphinLogPath = (executablePath: string): string | null => {
  const candidates = dolphinLogCandidates(executablePath);

  return (
    candidates.find((candidate) => fs.existsSync(candidate)) ??
    candidates.find((candidate) =>
      fs.existsSync(path.dirname(path.dirname(candidate)))
    ) ??
    candidates[0] ??
    null
  );
};
