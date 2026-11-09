import { promises as fs } from "node:fs";
import path from "node:path";

import type { UnlockedAchievement } from "@types";

import {
  readShadps4ConfiguredDirectory,
  resolveShadps4UserDir,
} from "./shadps4-files.js";

const DEFAULT_USER_ID = 1000;
const PRIMARY_PLAYER_INDEX = 1;
const NP_COMM_ID_RE = /NPWR\d{5}_\d{2}/;
const TROPHY_TAG_RE = /<trophy\s[^>]*>/g;
const TROPHY_ID_RE = /\sid="(\d+)"/;
const TROPHY_UNLOCKED_RE = /\sunlockstate="true"/;
const TROPHY_TIMESTAMP_RE = /\stimestamp="(\d+)"/;
const TROPHY_FILE_END = "</trophyconf>";

interface Shadps4UsersFile {
  Users?: {
    user?: Array<{ player_index?: number; user_id?: number }>;
  };
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

const readPrimaryUserId = async (userDir: string): Promise<number> => {
  try {
    const users = JSON.parse(
      await fs.readFile(path.join(userDir, "users.json"), "utf8")
    ) as Shadps4UsersFile;
    const primaryUser = users.Users?.user?.find(
      ({ player_index }) => player_index === PRIMARY_PLAYER_INDEX
    );
    return primaryUser?.user_id ?? DEFAULT_USER_ID;
  } catch {
    return DEFAULT_USER_ID;
  }
};

export const resolveShadps4TrophyFile = async (
  executablePath: string,
  discPath: string
): Promise<string | null> => {
  const npCommId = await readNpCommId(discPath);
  if (!npCommId) return null;

  const userDir = resolveShadps4UserDir(executablePath);
  const homeDir =
    (await readShadps4ConfiguredDirectory(executablePath, "home_dir")) ??
    path.join(userDir, "home");
  const userId = await readPrimaryUserId(userDir);

  return path.join(homeDir, String(userId), "trophy", `${npCommId}.xml`);
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
