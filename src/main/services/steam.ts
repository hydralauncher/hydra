import axios from "axios";
import path from "node:path";
import fs from "node:fs";
import { crc32 } from "crc";
import WinReg from "winreg";
import { parseBuffer, writeBuffer } from "steam-shortcut-editor";

import type { SteamAppDetails, SteamShortcut } from "@types";

import { logger } from "./logger";
import { SystemPath } from "./system-path";

export interface SteamAppDetailsResponse {
  [key: string]: {
    success: boolean;
    data: SteamAppDetails;
  };
}

export const getSteamLocation = async (): Promise<string> => {
  if (process.platform === "linux") {
    return path.join(SystemPath.getPath("home"), ".local", "share", "Steam");
  }

  if (process.platform === "darwin") {
    return path.join(
      SystemPath.getPath("home"),
      "Library",
      "Application Support",
      "Steam"
    );
  }

  const regKey = new WinReg({
    hive: WinReg.HKCU,
    key: "\\Software\\Valve\\Steam",
  });

  return new Promise((resolve, reject) => {
    regKey.get("SteamPath", (err, value) => {
      if (err) {
        reject(err);
      }

      resolve(value.value);
    });
  });
};

export const getSteamAppDetails = async (
  objectId: string,
  language: string
) => {
  const searchParams = new URLSearchParams({
    appids: objectId,
    l: language,
  });

  return axios
    .get<SteamAppDetailsResponse>(
      `http://store.steampowered.com/api/appdetails?${searchParams.toString()}`
    )
    .then((response) => {
      if (response.data[objectId].success) {
        const data = response.data[objectId].data;
        return {
          ...data,
          objectId,
        };
      }

      return null;
    })
    .catch((err) => {
      logger.error(err, { method: "getSteamAppDetails" });
      return null;
    });
};

export const getSteamUsersIds = async () => {
  const userDataPath = await getSteamLocation();

  const userIds = fs.readdirSync(path.join(userDataPath, "userdata"), {
    withFileTypes: true,
  });

  return userIds
    .filter((dir) => dir.isDirectory())
    .map((dir) => Number(dir.name));
};

export const getSteamShortcuts = async (steamUserId: number) => {
  const shortcutsPath = path.join(
    await getSteamLocation(),
    "userdata",
    steamUserId.toString(),
    "config",
    "shortcuts.vdf"
  );

  if (!fs.existsSync(shortcutsPath)) {
    return [];
  }

  const shortcuts = parseBuffer(fs.readFileSync(shortcutsPath));

  return shortcuts.shortcuts as SteamShortcut[];
};

export const generateSteamShortcutAppId = (
  exePath: string,
  gameName: string
) => {
  const input = exePath + gameName;
  const crcValue = crc32(input) >>> 0;
  const steamAppId = (crcValue | 0x80000000) >>> 0;
  return steamAppId;
};

export const composeSteamShortcut = (
  title: string,
  executablePath: string,
  iconPath: string | null
): SteamShortcut => {
  return {
    appid: generateSteamShortcutAppId(executablePath, title),
    appname: title,
    Exe: `"${executablePath}"`,
    StartDir: `"${path.dirname(executablePath)}"`,
    icon: iconPath ?? "",
    ShortcutPath: "",
    LaunchOptions: "",
    IsHidden: false,
    AllowDesktopConfig: true,
    AllowOverlay: true,
    OpenVR: false,
    Devkit: false,
    DevkitGameID: "",
    DevkitOverrideAppID: false,
    LastPlayTime: false,
    FlatpakAppID: "",
  };
};

export const writeSteamShortcuts = async (
  steamUserId: number,
  shortcuts: SteamShortcut[]
) => {
  const buffer = writeBuffer({ shortcuts });

  fs.writeFileSync(
    path.join(
      await getSteamLocation(),
      "userdata",
      steamUserId.toString(),
      "config",
      "shortcuts.vdf"
    ),
    buffer
  );
};
