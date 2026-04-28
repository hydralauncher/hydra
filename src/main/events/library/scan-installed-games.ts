import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { t } from "i18next";
import { registerEvent } from "../register-event";
import { gamesSublevel } from "@main/level";
import {
  GameExecutables,
  LocalNotificationManager,
  logger,
  WindowManager,
} from "@main/services";

// Common root folder names found in game installation paths
const COMMON_GAME_ROOT_FOLDERS = [
  "Games",
  "Game",
  "GOG Games",
  "Epic Games",
  "Battle.net",
  "Origin Games",
  "Ubisoft Games",
  "EA Games",
  "Rockstar Games",
  "Riot Games",
  "Xbox Games",
  "SteamLibrary",
  "DODI-Repacks",
  "FitGirl Repacks",
];

// Common launcher-specific patterns
const LAUNCHER_PATTERNS = [
  "Steam\\steamapps\\common",
  "SteamLibrary\\steamapps\\common",
  "Epic Games",
  "GOG Games",
  "Battle.net\\Games",
  "Origin Games",
  "EA Games",
  "Ubisoft Games",
  "Ubisoft Game Launcher\\games",
  "Rockstar Games",
  "Riot Games",
  "XboxGames",
];

interface FoundGame {
  title: string;
  executablePath: string;
}

interface ScanResult {
  foundGames: FoundGame[];
  total: number;
}

function getAllDrives(): string[] {
  const drives: string[] = [];
  
  if (process.platform === 'win32') {
    // Windows: Check all drive letters A-Z
    for (let i = 65; i <= 90; i++) {
      const driveLetter = String.fromCharCode(i);
      const drivePath = `${driveLetter}:\\`;
      try {
        if (fs.existsSync(drivePath)) {
          drives.push(drivePath);
        }
      } catch {
        // Drive doesn't exist or is inaccessible
      }
    }
  } else if (process.platform === 'linux') {
    // Linux: Add common mount points
    drives.push('/');
    try {
      const mediaPath = '/media';
      const runMediaPath = '/run/media';
      
      if (fs.existsSync(mediaPath)) {
        const userDirs = fs.readdirSync(mediaPath);
        for (const dir of userDirs) {
          drives.push(path.join(mediaPath, dir));
        }
      }
      
      if (fs.existsSync(runMediaPath)) {
        const userDirs = fs.readdirSync(runMediaPath);
        for (const dir of userDirs) {
          drives.push(path.join(runMediaPath, dir));
        }
      }
    } catch {
      // Fallback to root only
    }
    
    // Add /mnt for WSL and traditional mounts
    if (fs.existsSync('/mnt')) {
      try {
        const mntDirs = fs.readdirSync('/mnt');
        for (const dir of mntDirs) {
          drives.push(path.join('/mnt', dir));
        }
      } catch {}
    }
  } else if (process.platform === 'darwin') {
    // macOS
    drives.push('/');
    drives.push('/Applications');
    try {
      const userApplications = path.join(os.homedir(), 'Applications');
      if (fs.existsSync(userApplications)) {
        drives.push(userApplications);
      }
    } catch {}
  }

  return drives;
}

function generateScanPaths(drives: string[]): string[] {
  const scanPaths: string[] = [];

  for (const drive of drives) {
    // 1. Check for root-level game folders
    for (const folder of COMMON_GAME_ROOT_FOLDERS) {
      scanPaths.push(path.join(drive, folder));
    }

    // 2. Check Program Files variants (Windows specific)
    if (process.platform === 'win32') {
      const programFilesPaths = [
        path.join(drive, 'Program Files'),
        path.join(drive, 'Program Files (x86)'),
      ];

      for (const pfPath of programFilesPaths) {
        if (fs.existsSync(pfPath)) {
          // Add game-related subdirectories
          for (const folder of COMMON_GAME_ROOT_FOLDERS) {
            scanPaths.push(path.join(pfPath, folder));
          }
        }
      }
    }

    // 3. Check launcher-specific patterns
    for (const pattern of LAUNCHER_PATTERNS) {
      scanPaths.push(path.join(drive, pattern));
    }
  }

  // Filter to only existing directories for performance
  return scanPaths.filter(dir => {
    try {
      return fs.existsSync(dir);
    } catch {
      return false;
    }
  });
}

async function findGameExecutable(
  gameTitle: string,
  executableNames: Set<string>,
  scanPaths: string[]
): Promise<string | null> {
  const titleLower = gameTitle.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const titleWords = titleLower.split(/\s+/).filter(w => w.length > 2);

  for (const scanPath of scanPaths) {
    try {
      // Check if the directory itself contains the game
      const found = await scanDirectoryForGame(scanPath, executableNames, titleWords);
      if (found) return found;

      // Also check subdirectories one level deep
      const entries = fs.readdirSync(scanPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const fullPath = path.join(scanPath, entry.name);
        const entryLower = entry.name.toLowerCase();
        
        // Quick check: does this folder name match the game title?
        const folderMatch = titleWords.some(word => entryLower.includes(word));
        if (folderMatch) {
          const found = await scanDirectoryForGame(fullPath, executableNames, titleWords);
          if (found) return found;
        }
      }
    } catch (err) {
      // Silently continue to next path
    }
  }

  return null;
}

async function scanDirectoryForGame(
  dirPath: string,
  executableNames: Set<string>,
  titleWords: string[]
): Promise<string | null> {
  try {
    // If we have specific executable names, look for those first
    if (executableNames.size > 0) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.toLowerCase().endsWith('.exe') && !entry.name.toLowerCase().endsWith('.app')) continue;
        
        if (executableNames.has(entry.name.toLowerCase())) {
          return path.join(dirPath, entry.name);
        }
      }
    }

    // Fallback: If no specific executables are known, scan for any likely executable
    // This handles games not in our database
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    // First, try to find executables in the root
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      
      const fileName = entry.name.toLowerCase();
      if (!fileName.endsWith('.exe') && !fileName.endsWith('.app')) continue;
      
      const fileNameNoExt = fileName.replace(/\.(exe|app)$/, '');
      
      // Check if any title word matches the executable name
      if (titleWords.some(word => fileNameNoExt.includes(word))) {
        return path.join(dirPath, entry.name);
      }
    }

    // Then check bin/ subdirectory (common pattern)
    const binPath = path.join(dirPath, 'bin');
    if (fs.existsSync(binPath)) {
      const binEntries = fs.readdirSync(binPath, { withFileTypes: true });
      
      for (const entry of binEntries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.exe')) continue;
        
        const fileNameNoExt = entry.name.toLowerCase().replace('.exe', '');
        if (titleWords.some(word => fileNameNoExt.includes(word))) {
          return path.join(binPath, entry.name);
        }
      }
    }

    // Check Build/ or Binaries/ directories
    for (const subDir of ['Build', 'Binaries', 'Game', 'Release']) {
      const subPath = path.join(dirPath, subDir);
      if (fs.existsSync(subPath)) {
        const subEntries = fs.readdirSync(subPath, { withFileTypes: true });
        
        for (const entry of subEntries) {
          if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.exe')) continue;
          
          const fileNameNoExt = entry.name.toLowerCase().replace('.exe', '');
          if (titleWords.some(word => fileNameNoExt.includes(word))) {
            return path.join(subPath, entry.name);
          }
        }
      }
    }
  } catch {
    // Directory might not be readable
  }

  return null;
}

const scanInstalledGames = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<ScanResult> => {
  logger.info("[ScanInstalledGames] Starting comprehensive game scan...");
  
  // Get all available drives
  const drives = getAllDrives();
  logger.info(`[ScanInstalledGames] Found drives: ${drives.join(', ')}`);
  
  // Generate all possible scan paths
  const scanPaths = generateScanPaths(drives);
  logger.info(`[ScanInstalledGames] Generated ${scanPaths.length} scan paths`);

  // Get all games from database (including those without executables)
  const games = await gamesSublevel
    .iterator()
    .all()
    .then((results) =>
      results
        .filter(
          ([_key, game]) => game.isDeleted === false && game.shop !== "custom"
        )
        .map(([key, game]) => ({ key, game }))
    );

  const foundGames: FoundGame[] = [];
  const gamesToScan = games.filter((g) => !g.game.executablePath);
  
  logger.info(`[ScanInstalledGames] Scanning ${gamesToScan.length} games without executables`);

  let scanned = 0;
  for (const { key, game } of gamesToScan) {
    scanned++;
    
    if (scanned % 10 === 0) {
      logger.info(`[ScanInstalledGames] Progress: ${scanned}/${gamesToScan.length}`);
    }

    const executableNames = GameExecutables.getExecutablesForGame(game.objectId);
    const normalizedNames = new Set(
      (executableNames || []).map((name: string) => name.toLowerCase())
    );

    const foundPath = await findGameExecutable(game.title, normalizedNames, scanPaths);

    if (foundPath) {
      await gamesSublevel.put(key, { ...game, executablePath: foundPath });

      logger.info(
        `[ScanInstalledGames] ✓ Found: ${game.title} -> ${foundPath}`
      );

      foundGames.push({ title: game.title, executablePath: foundPath });
    }
  }

  logger.info(
    `[ScanInstalledGames] Scan complete. Found ${foundGames.length} games out of ${gamesToScan.length}`
  );

  WindowManager.mainWindow?.webContents.send("on-library-batch-complete");
  await publishScanNotification(foundGames.length);

  return { foundGames, total: gamesToScan.length };
};

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

registerEvent("scanInstalledGames", scanInstalledGames);