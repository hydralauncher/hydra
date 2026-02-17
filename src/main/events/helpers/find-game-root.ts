import path from "node:path";
import fs from "node:fs";

const NESTED_EXECUTABLE_DIRS = new Set([
  "bin",
  "bin32",
  "bin64",
  "binaries",
  "win32",
  "win64",
  "x64",
  "x86",
  "game",
  "runtime",
  "engine",
]);

const GAME_ROOT_INDICATORS = new Set([
  "data",
  "assets",
  "content",
  "paks",
  "pak",
  "resources",
  "localization",
  "languages",
  "saves",
  "mods",
  "dlc",
  "music",
  "sound",
  "sounds",
  "audio",
  "videos",
  "movies",
  "cinematics",
  "textures",
  "shaders",
  "configs",
  "config",
  "settings",
  "plugins",
  "native",
  "managed",
  "mono",
  "dotnet",
  "engine",
  "launcher",
]);

const UNITY_DATA_SUFFIX = "_data";

const GAME_DATA_EXTENSIONS = new Set([
  ".pak",
  ".dat",
  ".bundle",
  ".assets",
  ".forge",
  ".arc",
  ".pck",
  ".vpk",
  ".wad",
  ".bsa",
  ".ba2",
  ".big",
  ".cpk",
  ".fsb",
  ".bank",
]);

const MAX_UPWARD_LEVELS = 3;

const UNSAFE_ROOTS = new Set([
  "program files",
  "program files (x86)",
  "users",
  "windows",
  "system32",
  "appdata",
  "programdata",
  "steamapps",
  "common",
  "desktop",
  "documents",
  "downloads",
]);

interface DirectoryScore {
  path: string;
  score: number;
  hasExecutable: boolean;
}

const isNestedExeDir = (dirName: string): boolean => {
  return NESTED_EXECUTABLE_DIRS.has(dirName.toLowerCase());
};

const isUnsafePath = (dirPath: string): boolean => {
  const normalized = dirPath.toLowerCase();
  const parts = normalized.split(path.sep);
  const lastPart = parts.at(-1) ?? "";

  if (UNSAFE_ROOTS.has(lastPart)) {
    return true;
  }

  const parsed = path.parse(dirPath);
  return parsed.dir === parsed.root || dirPath === parsed.root;
};

const GAME_ROOT_FILES = new Set([
  "steam_api.dll",
  "steam_api64.dll",
  "version.txt",
  "readme.txt",
  "eula.txt",
  "unins000.exe",
  "uninstall.exe",
]);

const scoreEntry = (
  entry: fs.Dirent
): { score: number; hasExecutable: boolean } => {
  const nameLower = entry.name.toLowerCase();
  let score = 0;
  let hasExecutable = false;

  if (entry.isDirectory()) {
    if (GAME_ROOT_INDICATORS.has(nameLower)) score += 2;
    if (nameLower.endsWith(UNITY_DATA_SUFFIX)) score += 3;
    if (nameLower === "binaries" || nameLower === "content") score += 2;
  } else if (entry.isFile()) {
    if (nameLower.endsWith(".exe")) {
      hasExecutable = true;
      score += 1;
    }
    if (GAME_DATA_EXTENSIONS.has(path.extname(nameLower))) score += 2;
    if (GAME_ROOT_FILES.has(nameLower)) score += 1;
  }

  return { score, hasExecutable };
};

const scoreDirectory = async (dirPath: string): Promise<DirectoryScore> => {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    let totalScore = 0;
    let hasExecutable = false;

    for (const entry of entries) {
      const result = scoreEntry(entry);
      totalScore += result.score;
      hasExecutable = hasExecutable || result.hasExecutable;
    }

    return { path: dirPath, score: totalScore, hasExecutable };
  } catch {
    return { path: dirPath, score: 0, hasExecutable: false };
  }
};

const collectCandidates = async (exeDir: string): Promise<DirectoryScore[]> => {
  const candidates: DirectoryScore[] = [];
  let currentDir = exeDir;
  let levelsUp = 0;

  while (levelsUp <= MAX_UPWARD_LEVELS) {
    if (isUnsafePath(currentDir)) break;

    const score = await scoreDirectory(currentDir);
    candidates.push(score);

    const dirName = path.basename(currentDir);

    if (levelsUp === 0 && isNestedExeDir(dirName)) {
      levelsUp++;
      currentDir = path.dirname(currentDir);
      continue;
    }

    if (score.score >= 3 && score.hasExecutable) break;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;

    currentDir = parentDir;
    levelsUp++;
  }

  return candidates;
};

const selectBestCandidate = (candidates: DirectoryScore[]): DirectoryScore => {
  let best = candidates[0];

  for (const candidate of candidates) {
    const isBetterWithExe =
      candidate.score >= 3 &&
      candidate.hasExecutable &&
      (!best.hasExecutable || candidate.score > best.score);

    const isBetterWithoutExe =
      !best.hasExecutable && candidate.score > best.score;

    if (isBetterWithExe || isBetterWithoutExe) {
      best = candidate;
    }
  }

  return best;
};

const getFallbackPath = (exeDir: string): string => {
  const exeDirName = path.basename(exeDir);

  if (isNestedExeDir(exeDirName)) {
    const parentDir = path.dirname(exeDir);
    if (!isUnsafePath(parentDir)) return parentDir;
  }

  return exeDir;
};

export const findGameRootFromExe = async (
  exePath: string
): Promise<string | null> => {
  try {
    const exeDir = path.dirname(exePath);

    if (isUnsafePath(exeDir)) return null;

    const candidates = await collectCandidates(exeDir);

    if (candidates.length === 0) return exeDir;

    const bestCandidate = selectBestCandidate(candidates);

    if (bestCandidate.score < 2) {
      return getFallbackPath(exeDir);
    }

    return bestCandidate.path;
  } catch {
    return null;
  }
};
