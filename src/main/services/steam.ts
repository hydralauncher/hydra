import axios from "axios";
import path from "node:path";
import fs from "node:fs";
import { crc32 } from "crc";
import WinReg from "winreg";
import { parseBuffer, writeBuffer } from "steam-shortcut-editor";

import type { SteamAppDetails, SteamShortcut } from "@types";

import { logger } from "./logger";
import { SystemPath } from "./system-path";

interface VdfNode {
  [key: string]: string | VdfNode;
}

const parseVdf = (text: string): VdfNode => {
  const root: VdfNode = {};
  const stack: VdfNode[] = [root];
  const lines = text.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "{" || line === "" || line.startsWith("//")) continue;
    if (line === "}") {
      stack.pop();
      continue;
    }

    const tokens: string[] = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        const end = line.indexOf('"', i + 1);
        if (end === -1) break;
        tokens.push(line.slice(i + 1, end));
        i = end + 1;
      } else {
        i++;
      }
    }

    const current = stack[stack.length - 1];
    if (tokens.length === 2) {
      current[tokens[0]] = tokens[1];
    } else if (tokens.length === 1) {
      const child: VdfNode = {};
      current[tokens[0]] = child;
      stack.push(child);
    }
  }

  return root;
};

export interface InstalledSteamGame {
  appId: string;
  name: string;
  installDir: string;
  libraryPath: string;
}

export const getInstalledSteamGames = async (): Promise<
  InstalledSteamGame[]
> => {
  const steamPath = await getSteamLocation();
  const libraryFoldersPath = path.join(
    steamPath,
    "steamapps",
    "libraryfolders.vdf"
  );

  if (!fs.existsSync(libraryFoldersPath)) {
    logger.info("libraryfolders.vdf not found", { libraryFoldersPath });
    return [];
  }

  const vdfContent = fs.readFileSync(libraryFoldersPath, "utf-8");
  const parsed = parseVdf(vdfContent);
  const libraryFolders =
    (parsed["libraryfolders"] as VdfNode) ||
    (parsed["LibraryFolders"] as VdfNode);

  if (!libraryFolders) {
    logger.info("No library folders found in VDF");
    return [];
  }

  const libraryPaths: string[] = [];
  for (const key of Object.keys(libraryFolders)) {
    const entry = libraryFolders[key];
    if (typeof entry === "object" && typeof entry["path"] === "string") {
      libraryPaths.push(entry["path"]);
    }
  }

  const games: InstalledSteamGame[] = [];

  for (const libPath of libraryPaths) {
    const steamappsDir = path.join(libPath, "steamapps");

    let files: string[];
    try {
      files = fs.readdirSync(steamappsDir);
    } catch (err) {
      logger.error("Failed to read steamapps directory", {
        steamappsDir,
        error: String(err),
      });
      continue;
    }

    const manifests = files.filter(
      (f) => f.startsWith("appmanifest_") && f.endsWith(".acf")
    );

    for (const manifest of manifests) {
      try {
        const acfContent = fs.readFileSync(
          path.join(steamappsDir, manifest),
          "utf-8"
        );
        const acf = parseVdf(acfContent);
        const appState =
          (acf["AppState"] as VdfNode) || (acf["appstate"] as VdfNode);

        if (!appState) continue;

        const appId = appState["appid"] as string;
        const name = appState["name"] as string;
        const installDir = appState["installdir"] as string;

        if (appId && name && installDir) {
          games.push({
            appId,
            name,
            installDir,
            libraryPath: libPath,
          });
        }
      } catch (err) {
        logger.error("Failed to parse ACF manifest", {
          manifest,
          error: String(err),
        });
      }
    }
  }

  return games;
};

const IGNORED_EXE_PATTERNS = [
  /unins/i,
  /setup/i,
  /install/i,
  /redist/i,
  /vcredist/i,
  /dxsetup/i,
  /dotnet/i,
  /ue4prereq/i,
  /crash/i,
  /report/i,
  /update/i,
  /launch/i,
];

export const findSteamGameExecutable = async (
  installDir: string
): Promise<string | null> => {
  try {
    const entries = await fs.promises.readdir(installDir, {
      withFileTypes: true,
    });

    const exeFiles: string[] = [];

    for (const entry of entries) {
      if (
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(".exe") &&
        !IGNORED_EXE_PATTERNS.some((p) => p.test(entry.name))
      ) {
        exeFiles.push(path.join(installDir, entry.name));
      }
    }

    if (exeFiles.length === 1) {
      return exeFiles[0];
    }

    if (exeFiles.length > 1) {
      return exeFiles[0];
    }
  } catch {
    // Directory may not exist or be inaccessible
  }

  return null;
};

export interface SteamAppDetailsResponse {
  [key: string]: {
    success: boolean;
    data: SteamAppDetails;
  };
}

export const getSteamLocation = async () => {
  if (process.platform === "linux") {
    const possiblePaths = [
      path.join(SystemPath.getPath("home"), ".steam", "steam"),
      path.join(SystemPath.getPath("home"), ".local", "share", "Steam"),
    ];

    return possiblePaths.find((p) => fs.existsSync(p)) || possiblePaths[0];
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

  return new Promise<string>((resolve, reject) => {
    regKey.get("SteamPath", (err, value) => {
      if (err) {
        reject(err);
      }

      if (!value) {
        reject(new Error("SteamPath not found in registry"));
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
      logger.error("Error on getSteamAppDetails", {
        message: err?.message,
        code: err?.code,
        name: err?.name,
      });
      return null;
    });
};

export const getSteamUsersIds = async () => {
  const steamLocation = await getSteamLocation().catch(() => null);

  if (!steamLocation) {
    return [];
  }

  const userDataPath = path.join(steamLocation, "userdata");

  if (!fs.existsSync(userDataPath)) {
    return [];
  }

  const userIds = fs.readdirSync(userDataPath, {
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
    LastPlayTime: 0,
    FlatpakAppID: "",
  };
};

export const writeSteamShortcuts = async (
  steamUserId: number,
  shortcuts: SteamShortcut[]
) => {
  const buffer = writeBuffer({ shortcuts });

  return fs.promises.writeFile(
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
