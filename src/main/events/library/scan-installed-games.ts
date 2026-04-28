import path from "node:path";
import fs from "node:fs";
import { t } from "i18next";
import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import {
  GameExecutables,
  LocalNotificationManager,
  logger,
  WindowManager,
} from "@main/services";
import axios from "axios";

const platform = process.platform;

// ─── Platform-aware common game folders ─────────────────────────────────────

const COMMON_GAME_FOLDERS_WIN = [
  "Games",
  "Hydra Games",
  "GOG Games",
  "Epic Games",
  "EA Games",
  "Origin Games",
  "Ubisoft Game Launcher\\games",
  "SteamLibrary\\steamapps\\common",
  "Steam\\steamapps\\common",
  "Program Files (x86)\\Steam\\steamapps\\common",
  "Program Files\\Steam\\steamapps\\common",
  "Program Files (x86)\\DODI-Repacks",
  "Program Files\\Epic Games",
  "Program Files (x86)\\GOG Galaxy\\Games",
];

const COMMON_GAME_FOLDERS_LINUX = [
  "Games",
  "Hydra Games",
  ".steam/steam/steamapps/common",
  ".local/share/Steam/steamapps/common",
  "snap/steam/common/.local/share/Steam/steamapps/common",
];

const COMMON_GAME_FOLDERS_MAC = [
  "Games",
  "Hydra Games",
  "Library/Application Support/Steam/steamapps/common",
];

const BAD_EXE_PATTERNS = [
  /^unins/i,
  /^setup/i,
  /^install/i,
  /^redist/i,
  /^vcredist/i,
  /^dxsetup/i,
  /^vc_redist/i,
  /^directx/i,
  /^dotnet/i,
  /^uplayinstaller/i,
  /^easyanticheat/i,
  /^battleye/i,
  /^crashreport/i,
  /^bugsplat/i,
  /^cefsharp/i,
];

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface FoundGame {
  title: string;
  executablePath: string;
}

interface ScanResult {
  foundGames: FoundGame[];
  total: number;
}

interface SteamAppDetails {
  success: boolean;
  data?: {
    name: string;
    launch?: Array<{
      executable?: string;
      type?: string;
    }>;
  };
}

// ─── Drive / mount point detection ──────────────────────────────────────────

function getWindowsDriveRoots(): string[] {
  const letters = Array.from({ length: 26 }, (_, i) =>
    String.fromCharCode(65 + i)
  );
  return letters
    .map((l) => `${l}:\\`)
    .filter((root) => fs.existsSync(root));
}

async function getLinuxMountPoints(): Promise<string[]> {
  try {
    const mounts = await fs.promises.readFile("/proc/mounts", "utf8");
    const ignoredFs = new Set([
      "proc", "sysfs", "tmpfs", "devtmpfs", "devpts", "overlay",
      "squashfs", "nsfs", "cgroup", "cgroup2", "pstore", "bpf",
      "tracefs", "securityfs", "configfs", "debugfs", "mqueue",
      "hugetlbfs", "fusectl", "ramfs", "autofs", "binfmt_misc",
    ]);
    const points = new Set<string>();
    for (const line of mounts.split("\n")) {
      const [source, target, fsType] = line.split(" ");
      if (!target || ignoredFs.has(fsType)) continue;
      if (!source?.startsWith("/dev/") && !fsType?.startsWith("fuse.")) continue;
      points.add(target);
    }
    if (points.size === 0) points.add("/");
    return Array.from(points);
  } catch (err) {
    logger.error("[ScanInstalledGames] Failed to read /proc/mounts:", err);
    return ["/"];
  }
}

async function buildScanDirectories(): Promise<string[]> {
  const dirs: string[] = [];

  if (platform === "win32") {
    const roots = getWindowsDriveRoots();
    for (const root of roots) {
      for (const folder of COMMON_GAME_FOLDERS_WIN) {
        dirs.push(path.join(root, folder));
      }
    }
  } else if (platform === "linux") {
    const home = process.env.HOME ?? "/root";
    const mountPoints = await getLinuxMountPoints();
    for (const folder of COMMON_GAME_FOLDERS_LINUX) {
      dirs.push(path.join(home, folder));
      for (const mount of mountPoints) {
        dirs.push(path.join(mount, folder));
      }
    }
  } else if (platform === "darwin") {
    const home = process.env.HOME ?? "/Users/user";
    for (const folder of COMMON_GAME_FOLDERS_MAC) {
      dirs.push(path.join(home, folder));
    }
  }

  return dirs;
}

// ─── Exe lookup: Hydra DB ────────────────────────────────────────────────────

function getExesFromHydraDB(objectId: string): Set<string> | null {
  const names = GameExecutables.getExecutablesForGame(objectId);
  if (!names || names.length === 0) return null;
  logger.info(
    `[ScanInstalledGames] Hydra DB: found ${names.length} exe(s) for ${objectId}`
  );
  return new Set(names.map((n) => n.toLowerCase()));
}

// ─── Exe lookup: Steam API ───────────────────────────────────────────────────

async function getExesFromSteam(objectId: string): Promise<Set<string> | null> {
  try {
    logger.info(`[ScanInstalledGames] Steam API: querying for ${objectId}`);
    const res = await axios.get<{ [appid: string]: SteamAppDetails }>(
      `https://store.steampowered.com/api/appdetails?appids=${objectId}`,
      { timeout: 5000 }
    );

    const appData = res.data?.[objectId];
    if (!appData?.success || !appData.data?.launch) {
      logger.warn(
        `[ScanInstalledGames] Steam API: no launch data for ${objectId}`
      );
      return null;
    }

    const exes = new Set<string>();
    for (const launch of appData.data.launch) {
      if (!launch.executable) continue;
      const exeName = path.basename(launch.executable).toLowerCase();
      if (exeName) exes.add(exeName);
    }

    if (exes.size === 0) {
      logger.warn(
        `[ScanInstalledGames] Steam API: empty exe list for ${objectId}`
      );
      return null;
    }

    logger.info(
      `[ScanInstalledGames] Steam API: found exe(s) for ${objectId}: ${[...exes].join(", ")}`
    );
    return exes;
  } catch (err) {
    logger.error(
      `[ScanInstalledGames] Steam API: request failed for ${objectId}:`,
      err
    );
    return null;
  }
}

// ─── Exe lookup: fuzzy folder match ─────────────────────────────────────────

function normalizeTitleForMatch(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function folderMatchesTitle(folderName: string, gameTitle: string): boolean {
  const normalFolder = normalizeTitleForMatch(folderName);
  const normalTitle = normalizeTitleForMatch(gameTitle);

  if (normalFolder === normalTitle) return true;
  if (
    normalFolder.includes(normalTitle) ||
    normalTitle.includes(normalFolder)
  )
    return true;

  const longer = Math.max(normalFolder.length, normalTitle.length);
  if (longer === 0) return false;
  const diff = Math.abs(normalFolder.length - normalTitle.length);
  return diff / longer <= 0.2;
}

function isBadExe(exeName: string): boolean {
  return BAD_EXE_PATTERNS.some((pattern) => pattern.test(exeName));
}

async function findBestExeInFolder(
  folderPath: string
): Promise<string | null> {
  try {
    const exeExtension = platform === "darwin" ? ".app" : ".exe";
    const entries = await fs.promises.readdir(folderPath, {
      withFileTypes: true,
      recursive: true,
    });

    const candidates: { filePath: string; depth: number; size: number }[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(exeExtension)) continue;
      if (isBadExe(entry.name)) continue;

      const parentPath =
        "parentPath" in entry ? entry.parentPath : folderPath;
      const filePath = path.join(parentPath, entry.name);
      const depth = filePath.split(path.sep).length;

      try {
        const stat = await fs.promises.stat(filePath);
        candidates.push({ filePath, depth, size: stat.size });
      } catch {
        // skip unreadable files
      }
    }

    if (candidates.length === 0) return null;

    // Prefer shallowest depth, then largest size
    candidates.sort((a, b) => a.depth - b.depth || b.size - a.size);
    return candidates[0].filePath;
  } catch (err) {
    logger.error(
      `[ScanInstalledGames] Error scanning folder ${folderPath}:`,
      err
    );
    return null;
  }
}

async function findExeByFuzzyMatch(
  gameTitle: string,
  scanDirs: string[]
): Promise<string | null> {
  logger.info(
    `[ScanInstalledGames] Fuzzy match: searching for "${gameTitle}"`
  );

  for (const scanDir of scanDirs) {
    if (!fs.existsSync(scanDir)) continue;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(scanDir, { withFileTypes: true });
    } catch (err) {
      logger.error(
        `[ScanInstalledGames] Fuzzy match: cannot read dir ${scanDir}:`,
        err
      );
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!folderMatchesTitle(entry.name, gameTitle)) continue;

      const gameFolder = path.join(scanDir, entry.name);
      logger.info(
        `[ScanInstalledGames] Fuzzy match: "${entry.name}" matched "${gameTitle}"`
      );

      const exePath = await findBestExeInFolder(gameFolder);
      if (exePath) return exePath;
    }
  }

  return null;
}

// ─── Directory search with known exe names ───────────────────────────────────

async function searchInDirectories(
  executableNames: Set<string>,
  scanDirs: string[]
): Promise<string | null> {
  for (const scanDir of scanDirs) {
    if (!fs.existsSync(scanDir)) continue;
    const foundPath = await findExecutableInFolder(scanDir, executableNames);
    if (foundPath) return foundPath;
  }
  return null;
}

async function findExecutableInFolder(
  folderPath: string,
  executableNames: Set<string>
): Promise<string | null> {
  try {
    const entries = await fs.promises.readdir(folderPath, {
      withFileTypes: true,
      recursive: true,
    });

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fileName = entry.name.toLowerCase();
      if (executableNames.has(fileName)) {
        const parentPath =
          "parentPath" in entry ? entry.parentPath : folderPath;
        return path.join(parentPath, entry.name);
      }
    }
  } catch (err) {
    logger.error(
      `[ScanInstalledGames] Error reading folder ${folderPath}:`,
      err
    );
  }

  return null;
}

// ─── Notification ────────────────────────────────────────────────────────────

async function publishScanNotification(foundCount: number): Promise<void> {
  const hasFoundGames = foundCount > 0;
  await LocalNotificationManager.createNotification(
    "SCAN_GAMES_COMPLETE",
    t(
      hasFoundGames
        ? "scan_games_complete_title"
        : "scan_games_no_results_title",
      { ns: "notifications" }
    ),
    t(
      hasFoundGames
        ? "scan_games_complete_description"
        : "scan_games_no_results_description",
      { ns: "notifications", count: foundCount }
    ),
    { url: "/library?openScanModal=true" }
  );
}

// ─── Main scan ───────────────────────────────────────────────────────────────

const scanInstalledGames = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<ScanResult> => {
  logger.info(`[ScanInstalledGames] Starting on platform: ${platform}`);

  const scanDirs = await buildScanDirectories();
  logger.info(
    `[ScanInstalledGames] Scanning ${scanDirs.length} potential directories`
  );

  const games = await gamesSublevel
    .iterator()
    .all()
    .then((results) =>
      results
        .filter(([_key, game]) => game.isDeleted === false)
        .map(([key, game]) => ({ key, game }))
    );

  const foundGames: FoundGame[] = [];
  const gamesToScan = games.filter((g) => !g.game.executablePath);

  logger.info(
    `[ScanInstalledGames] ${gamesToScan.length} games without executable path`
  );

  for (const { key, game } of gamesToScan) {
    logger.info(
      `[ScanInstalledGames] Processing: "${game.title}" (${game.objectId}, shop: ${game.shop})`
    );

    let foundPath: string | null = null;

    // Step 1: Hydra exe DB
    const hydraExes = getExesFromHydraDB(game.objectId);
    if (hydraExes) {
      foundPath = await searchInDirectories(hydraExes, scanDirs);
      if (foundPath)
        logger.info(
          `[ScanInstalledGames] "${game.title}" found via Hydra DB: ${foundPath}`
        );
    }

    // Step 2: Steam API
    if (!foundPath && game.shop === "steam") {
      const steamExes = await getExesFromSteam(game.objectId);
      if (steamExes) {
        foundPath = await searchInDirectories(steamExes, scanDirs);
        if (foundPath)
          logger.info(
            `[ScanInstalledGames] "${game.title}" found via Steam API: ${foundPath}`
          );
      }
    }

    // Step 3: Fuzzy fallback
    if (!foundPath) {
      foundPath = await findExeByFuzzyMatch(game.title, scanDirs);
      if (foundPath)
        logger.info(
          `[ScanInstalledGames] "${game.title}" found via fuzzy match: ${foundPath}`
        );
    }

    if (foundPath) {
      await gamesSublevel.put(key, { ...game, executablePath: foundPath });
      foundGames.push({ title: game.title, executablePath: foundPath });
    } else {
      logger.warn(
        `[ScanInstalledGames] Could not find executable for: "${game.title}"`
      );
    }
  }

  logger.info(
    `[ScanInstalledGames] Done. Found ${foundGames.length}/${gamesToScan.length}`
  );

  WindowManager.mainWindow?.webContents.send("on-library-batch-complete");
  await publishScanNotification(foundGames.length);

  return { foundGames, total: gamesToScan.length };
};

registerEvent("scanInstalledGames", scanInstalledGames);