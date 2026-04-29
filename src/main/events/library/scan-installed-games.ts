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
  /^unitycrashhhandler/i,
  /^crashreporterclient/i,
  /^unrealcefsubprocess/i,
  /^unrealeditor/i,
  /^shadercompileworker/i,
  /^start_protected_game$/i,
  /^socialclubhelper/i,
  /^rockstarinstaller/i,
  /^bethesdanetlauncher/i,
  /^galaxyclient/i,
  /^epicwebhelper/i,
  /^splashtscreen/i,
  /helper$/i,
  /launcher$/i,
  /updater$/i,
  /patcher$/i,
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

// Represents one .exe found on disk during the upfront scan.
interface ExeEntry {
  filePath: string;
  fileName: string; // lowercase basename e.g. "re4.exe"
  folderName: string; // immediate parent folder name e.g. "Resident Evil 4"
  size: number;
  depth: number;
}

// ─── Drive / mount point detection ──────────────────────────────────────────

function getWindowsDriveRoots(): string[] {
  const letters = Array.from({ length: 26 }, (_, i) =>
    String.fromCharCode(65 + i)
  );
  return letters.map((l) => `${l}:\\`).filter((r) => fs.existsSync(r));
}

async function getLinuxMountPoints(): Promise<string[]> {
  try {
    const mounts = await fs.promises.readFile("/proc/mounts", "utf8");
    const ignoredFs = new Set([
      "proc",
      "sysfs",
      "tmpfs",
      "devtmpfs",
      "devpts",
      "overlay",
      "squashfs",
      "nsfs",
      "cgroup",
      "cgroup2",
      "pstore",
      "bpf",
      "tracefs",
      "securityfs",
      "configfs",
      "debugfs",
      "mqueue",
      "hugetlbfs",
      "fusectl",
      "ramfs",
      "autofs",
      "binfmt_misc",
    ]);
    const points = new Set<string>();
    for (const line of mounts.split("\n")) {
      const [source, target, fsType] = line.split(" ");
      if (!target || ignoredFs.has(fsType)) continue;
      if (!source?.startsWith("/dev/") && !fsType?.startsWith("fuse."))
        continue;
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
    for (const root of getWindowsDriveRoots()) {
      for (const folder of COMMON_GAME_FOLDERS_WIN) {
        dirs.push(path.join(root, folder));
      }
    }
  } else if (platform === "linux") {
    const home = process.env.HOME ?? "/root";
    for (const mount of await getLinuxMountPoints()) {
      for (const folder of COMMON_GAME_FOLDERS_LINUX) {
        dirs.push(path.join(home, folder));
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isBadExe(name: string): boolean {
  const stem = name.replace(/\.[^.]+$/, "");
  return BAD_EXE_PATTERNS.some((p) => p.test(stem));
}

function normalizeTitleForMatch(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function diceSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };
  const am = bigrams(a);
  const bm = bigrams(b);
  let hit = 0;
  for (const [bg, c] of am) hit += Math.min(c, bm.get(bg) ?? 0);
  return (2 * hit) / (a.length - 1 + b.length - 1);
}

function folderMatchesTitle(folderName: string, gameTitle: string): boolean {
  const f = normalizeTitleForMatch(folderName);
  const g = normalizeTitleForMatch(gameTitle);
  if (f === g) return true;
  const [shorter, longer] = f.length <= g.length ? [f, g] : [g, f];
  if (shorter.length / longer.length >= 0.7 && longer.includes(shorter))
    return true;
  return diceSimilarity(f, g) >= 0.75;
}

// Score a candidate exe for a given game title — higher wins.
function scoreExe(entry: ExeEntry, gameTitle: string): number {
  const stem = entry.fileName.replace(/\.[^.]+$/, "");
  const nameSim = diceSimilarity(
    normalizeTitleForMatch(stem),
    normalizeTitleForMatch(gameTitle)
  );
  const nameBonus = nameSim >= 0.5 ? 1_000_000 * nameSim : 0;
  return nameBonus - entry.depth * 100_000 + entry.size;
}

// ─── Upfront filesystem scan ─────────────────────────────────────────────────

interface DiskIndex {
  // lowercase filename → all ExeEntry objects with that name
  byName: Map<string, ExeEntry[]>;
  // normalized folder name → ExeEntry objects inside that immediate folder
  byFolder: Map<string, ExeEntry[]>;
}

async function buildDiskIndex(scanDirs: string[]): Promise<DiskIndex> {
  const exeExt = platform === "darwin" ? ".app" : ".exe";
  const byName = new Map<string, ExeEntry[]>();
  const byFolder = new Map<string, ExeEntry[]>();

  for (const scanDir of scanDirs) {
    if (!fs.existsSync(scanDir)) continue;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(scanDir, {
        withFileTypes: true,
        recursive: true,
      });
    } catch (err) {
      logger.error(`[ScanInstalledGames] Cannot read ${scanDir}:`, err);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(exeExt)) continue;
      if (isBadExe(entry.name)) continue;

      const parentPath =
        "parentPath" in entry
          ? (entry as any).parentPath
          : ((entry as any).path ?? scanDir);

      const filePath = path.join(parentPath, entry.name);
      const fileName = entry.name.toLowerCase();
      const folderName = path.basename(parentPath);

      let size = 0;
      try {
        size = (await fs.promises.stat(filePath)).size;
      } catch {
        continue;
      }

      const depth = filePath.split(path.sep).length;
      const e: ExeEntry = { filePath, fileName, folderName, size, depth };

      // Index by filename
      const nl = byName.get(fileName) ?? [];
      nl.push(e);
      byName.set(fileName, nl);

      // Index by normalized immediate parent folder name
      const normFolder = normalizeTitleForMatch(folderName);
      const fl = byFolder.get(normFolder) ?? [];
      fl.push(e);
      byFolder.set(normFolder, fl);
    }
  }

  logger.info(
    `[ScanInstalledGames] Disk index: ${byName.size} unique exe names found`
  );
  return { byName, byFolder };
}

// ─── In-memory lookup strategies ─────────────────────────────────────────────

function lookupByExeNames(
  exeNames: Set<string>,
  index: DiskIndex,
  gameTitle: string
): string | null {
  const candidates: ExeEntry[] = [];
  for (const name of exeNames) {
    const found = index.byName.get(name);
    if (found) candidates.push(...found);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => scoreExe(b, gameTitle) - scoreExe(a, gameTitle));
  return candidates[0].filePath;
}

function lookupByFuzzyFolder(
  gameTitle: string,
  index: DiskIndex
): string | null {
  const candidates: ExeEntry[] = [];

  for (const [normFolder, entries] of index.byFolder) {
    if (!folderMatchesTitle(normFolder, gameTitle)) continue;
    candidates.push(...entries);
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => scoreExe(b, gameTitle) - scoreExe(a, gameTitle));

  logger.info(
    `[ScanInstalledGames] Fuzzy match: "${gameTitle}" → ${candidates[0].filePath}`
  );
  return candidates[0].filePath;
}

// ─── Steam API ───────────────────────────────────────────────────────────────

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
      const name = path.basename(launch.executable).toLowerCase();
      if (name) exes.add(name);
    }
    if (exes.size === 0) return null;
    logger.info(
      `[ScanInstalledGames] Steam API: ${[...exes].join(", ")} for ${objectId}`
    );
    return exes;
  } catch (err) {
    logger.error(`[ScanInstalledGames] Steam API failed for ${objectId}:`, err);
    return null;
  }
}

// ─── Notification ────────────────────────────────────────────────────────────

async function publishScanNotification(foundCount: number): Promise<void> {
  const has = foundCount > 0;
  await LocalNotificationManager.createNotification(
    "SCAN_GAMES_COMPLETE",
    t(has ? "scan_games_complete_title" : "scan_games_no_results_title", {
      ns: "notifications",
    }),
    t(
      has
        ? "scan_games_complete_description"
        : "scan_games_no_results_description",
      {
        ns: "notifications",
        count: foundCount,
      }
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

  // ── 1. Single filesystem walk — builds the entire exe index upfront ──────
  const diskIndex = await buildDiskIndex(scanDirs);

  // ── 2. Load games that still need an executable path ────────────────────
  const games = await gamesSublevel
    .iterator()
    .all()
    .then((results) =>
      results
        .filter(([_k, g]) => g.isDeleted === false)
        .map(([key, game]) => ({ key, game }))
    );

  const gamesToScan = games.filter((g) => !g.game.executablePath);
  logger.info(
    `[ScanInstalledGames] ${gamesToScan.length} games without executable path`
  );

  const foundGames: FoundGame[] = [];
  const assignedPaths = new Set<string>();

  // ── 3. Match each game against the in-memory index (no more disk I/O) ───
  for (const { key, game } of gamesToScan) {
    logger.info(
      `[ScanInstalledGames] Processing: "${game.title}" (${game.objectId}, shop: ${game.shop})`
    );

    let foundPath: string | null = null;
    let hydraHadData = false;

    // 3a. Hydra DB → in-memory filename lookup
    const hydraNames = GameExecutables.getExecutablesForGame(game.objectId);
    if (hydraNames && hydraNames.length > 0) {
      hydraHadData = true;
      logger.info(
        `[ScanInstalledGames] Hydra DB: ${hydraNames.length} exe(s) for ${game.objectId}`
      );
      const hydraExes = new Set(hydraNames.map((n) => n.toLowerCase()));
      foundPath = lookupByExeNames(hydraExes, diskIndex, game.title);
      if (foundPath)
        logger.info(
          `[ScanInstalledGames] "${game.title}" → Hydra DB: ${foundPath}`
        );
    }

    // 3b. Steam API → only when Hydra had no entry at all, to avoid redundant
    //     network calls. Result checked against the already-built disk index.
    if (!foundPath && !hydraHadData && game.shop === "steam") {
      const steamExes = await getExesFromSteam(game.objectId);
      if (steamExes) {
        foundPath = lookupByExeNames(steamExes, diskIndex, game.title);
        if (foundPath)
          logger.info(
            `[ScanInstalledGames] "${game.title}" → Steam API: ${foundPath}`
          );
      }
    }

    // 3c. Fuzzy folder match — always runs as last resort if no path found yet.
    //     Handles wrong/outdated Hydra DB entries, custom repacks with different
    //     exe names, and games with no DB entry at all.
    //     The 0.75 Dice threshold keeps false positives low (e.g. "Resident Evil 4"
    //     won't match "Resident Evil Requiem" which only scores 0.733).
    if (!foundPath) {
      foundPath = lookupByFuzzyFolder(game.title, diskIndex);
    }

    // Reject duplicate assignments (one exe can't belong to two games)
    if (foundPath && assignedPaths.has(foundPath)) {
      logger.warn(
        `[ScanInstalledGames] "${game.title}" — exe already claimed, skipping: ${foundPath}`
      );
      foundPath = null;
    }

    if (foundPath) {
      assignedPaths.add(foundPath);
      await gamesSublevel.put(key, { ...game, executablePath: foundPath });
      foundGames.push({ title: game.title, executablePath: foundPath });
    } else {
      logger.warn(`[ScanInstalledGames] Not found: "${game.title}"`);
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
