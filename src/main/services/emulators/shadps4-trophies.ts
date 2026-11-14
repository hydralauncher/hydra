import { promises as fs } from "node:fs";
import path from "node:path";

import type { UnlockedAchievement } from "@types";

import { parseParamSfo } from "./param-sfo.js";
import {
  readShadps4ConfiguredDirectory,
  resolveShadps4UserDir,
} from "./shadps4-files.js";
import { normalize } from "./sku-normalize.js";

const NP_COMM_ID_RE = /NPWR\d{5}_\d{2}/;
const USER_ID_DIRECTORY_RE = /^\d+$/;
const TROPHY_TAG_RE = /<trophy\s[^>]*>/g;
const TROPHY_ID_RE = /\sid="(\d+)"/;
const TROPHY_UNLOCKED_RE = /\sunlockstate="true"/;
const TROPHY_TIMESTAMP_RE = /\stimestamp="(\d+)"/;
const TROPHY_FILE_END = "</trophyconf>";
const LOG_DIRECTORY = "log";
const SHARED_LOG_FILE = "shad_log.txt";
const LOG_GAME_ID_RE = /\bGame id: (\S+)/;
const LOG_TROPHY_UNLOCK_RE = /\[Lib\.NpTrophy\].*\bUnlocking trophy id (\d+)/;

export interface Shadps4LogScan {
  offset: number;
  pending: string;
  matchesGame: boolean;
}

export const readNpCommId = async (
  discPath: string
): Promise<string | null> => {
  const data = await fs
    .readFile(path.join(discPath, "sce_sys", "npbind.dat"))
    .catch(() => null);
  if (!data) return null;
  return NP_COMM_ID_RE.exec(data.toString("latin1"))?.[0] ?? null;
};

export const readShadps4TitleId = async (
  discPath: string
): Promise<string | null> => {
  const data = await fs
    .readFile(path.join(discPath, "sce_sys", "param.sfo"))
    .catch(() => null);
  return data ? parseParamSfo(data) : null;
};

export const resolveShadps4TrophyFiles = async (
  executablePath: string,
  discPath: string
): Promise<string[]> => {
  const npCommId = await readNpCommId(discPath);
  if (!npCommId) return [];

  const homeDir =
    (await readShadps4ConfiguredDirectory(executablePath, "home_dir")) ??
    path.join(resolveShadps4UserDir(executablePath), "home");
  const entries = await fs
    .readdir(homeDir, { withFileTypes: true })
    .catch(() => []);

  return entries
    .filter(
      (entry) => entry.isDirectory() && USER_ID_DIRECTORY_RE.test(entry.name)
    )
    .map((entry) =>
      path.join(homeDir, entry.name, "trophy", `${npCommId}.xml`)
    );
};

export const parseUnlockedTrophies = (
  xml: string
): UnlockedAchievement[] | null => {
  if (!xml.includes(TROPHY_FILE_END)) return null;

  const unlockedTrophies: UnlockedAchievement[] = [];
  for (const [tag] of xml.matchAll(TROPHY_TAG_RE)) {
    if (!TROPHY_UNLOCKED_RE.test(tag)) continue;

    const id = TROPHY_ID_RE.exec(tag)?.[1];
    const timestamp = Number(TROPHY_TIMESTAMP_RE.exec(tag)?.[1]);
    if (id === undefined || !timestamp) continue;

    unlockedTrophies.push({
      name: String(Number(id)),
      unlockTime: timestamp * 1000,
    });
  }

  return unlockedTrophies;
};

export const mergeTrophyUnlocks = (
  unlockLists: UnlockedAchievement[][]
): UnlockedAchievement[] => {
  const earliestByName = new Map<string, UnlockedAchievement>();
  for (const unlock of unlockLists.flat()) {
    const known = earliestByName.get(unlock.name);
    if (!known || unlock.unlockTime < known.unlockTime) {
      earliestByName.set(unlock.name, unlock);
    }
  }
  return [...earliestByName.values()];
};

export const resolveShadps4LogFiles = (
  executablePath: string,
  titleId: string
): string[] => {
  const logDir = path.join(
    resolveShadps4UserDir(executablePath),
    LOG_DIRECTORY
  );
  return [
    path.join(logDir, `${titleId.replaceAll("-", "")}.log`),
    path.join(logDir, SHARED_LOG_FILE),
  ];
};

export const createShadps4LogScan = (): Shadps4LogScan => ({
  offset: 0,
  pending: "",
  matchesGame: false,
});

export const scanShadps4LogText = (
  scan: Shadps4LogScan,
  text: string,
  titleId: string
): string[] => {
  const lines = (scan.pending + text).split("\n");
  scan.pending = lines.pop() ?? "";

  const unlockedIds: string[] = [];
  for (const line of lines) {
    const gameId = LOG_GAME_ID_RE.exec(line)?.[1];
    if (gameId) {
      scan.matchesGame = normalize(gameId) === titleId;
      continue;
    }

    const trophyId = scan.matchesGame
      ? LOG_TROPHY_UNLOCK_RE.exec(line)?.[1]
      : undefined;
    if (trophyId !== undefined) unlockedIds.push(String(Number(trophyId)));
  }
  return unlockedIds;
};

export const readNewShadps4LogUnlocks = async (
  scan: Shadps4LogScan,
  logFile: string,
  titleId: string,
  sessionStartedAt: number
): Promise<string[]> => {
  const stats = await fs.stat(logFile).catch(() => null);
  if (!stats || stats.mtimeMs < sessionStartedAt) return [];
  if (stats.size < scan.offset) Object.assign(scan, createShadps4LogScan());
  if (stats.size === scan.offset) return [];

  const handle = await fs.open(logFile, "r");
  try {
    const buffer = Buffer.alloc(stats.size - scan.offset);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      buffer.length,
      scan.offset
    );
    scan.offset += bytesRead;
    return scanShadps4LogText(
      scan,
      buffer.subarray(0, bytesRead).toString("utf8"),
      titleId
    );
  } finally {
    await handle.close();
  }
};
