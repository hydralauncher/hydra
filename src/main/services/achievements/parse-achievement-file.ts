import { Cracker } from "@shared";
import { UnlockedAchievement } from "@types";
import { existsSync, readdirSync } from "node:fs";
import { achievementsLogger } from "../logger";
import {
  iniParse,
  jsonParse,
  process3DM,
  processCreamAPI,
  processDefault,
  processGoldberg,
  processOnlineFix,
  processRazor1911,
  processRld,
  processSkidrow,
  processUserStats,
} from "./parse-achievement-formats";
import {
  parseAlanWake2Achievements,
  parseNemirtingasAchievements,
  readStableFile,
  type EpicLocalUnlock,
} from "./epic/epic-achievement-parsers";

const processFltFolder = (filePath: string): UnlockedAchievement[] =>
  readdirSync(filePath).map((achievement) => ({
    name: achievement,
    unlockTime: Date.now(),
  }));

const processSteamCacheAchievement = (
  unlockedAchievements: any[]
): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  const achievementIndex = unlockedAchievements.findIndex(
    (element) => element[0] === "achievements"
  );

  if (achievementIndex === -1) {
    achievementsLogger.info("No achievements found in Steam cache file");
    return [];
  }

  const unlockedAchievementsData =
    unlockedAchievements[achievementIndex][1]["data"]["vecHighlight"];

  for (const achievement of unlockedAchievementsData) {
    if (achievement.bAchieved) {
      newUnlockedAchievements.push({
        name: achievement.strID,
        unlockTime: achievement.rtUnlocked * 1000,
      });
    }
  }

  return newUnlockedAchievements;
};

const EPIC_ACHIEVEMENT_PARSERS: Partial<
  Record<Cracker, (bytes: Uint8Array) => EpicLocalUnlock[] | null>
> = {
  [Cracker.nemirtingas]: parseNemirtingasAchievements,
  [Cracker.alanWake2]: parseAlanWake2Achievements,
};

export const isEpicAchievementFileType = (type: Cracker) =>
  type in EPIC_ACHIEVEMENT_PARSERS;

/**
 * Epic files are rewritten in place, so null tells the caller the file was
 * missing, malformed or caught mid-write and should be read again later.
 * Unlock names are Epic external ids until resolved against the catalogue.
 */
export const parseEpicAchievementFile = (
  filePath: string,
  type: Cracker
): UnlockedAchievement[] | null => {
  const parseAchievements = EPIC_ACHIEVEMENT_PARSERS[type];
  const bytes = parseAchievements ? readStableFile(filePath) : null;
  if (!parseAchievements || !bytes) return null;

  const unlocks = parseAchievements(bytes);
  if (!unlocks) {
    achievementsLogger.warn(`Skipping incomplete ${type} file ${filePath}`);
    return null;
  }

  return unlocks.map(({ externalId, unlockTime }) => ({
    name: externalId,
    unlockTime,
  }));
};

const ACHIEVEMENT_PARSERS: Partial<
  Record<Cracker, (filePath: string) => UnlockedAchievement[]>
> = {
  [Cracker.codex]: (filePath) => processDefault(iniParse(filePath)),
  [Cracker.rune]: (filePath) => processDefault(iniParse(filePath)),
  [Cracker.onlineFix]: (filePath) => processOnlineFix(iniParse(filePath)),
  [Cracker.goldberg]: (filePath) => processGoldberg(jsonParse(filePath)),
  [Cracker.userstats]: (filePath) => processUserStats(iniParse(filePath)),
  [Cracker.rld]: (filePath) => processRld(iniParse(filePath)),
  [Cracker.skidrow]: (filePath) => processSkidrow(iniParse(filePath)),
  [Cracker._3dm]: (filePath) => process3DM(iniParse(filePath)),
  [Cracker.ali213]: (filePath) =>
    processDefault(iniParse(filePath), "HaveAchieved", "HaveAchievedTime"),
  [Cracker.flt]: processFltFolder,
  [Cracker.creamAPI]: (filePath) => processCreamAPI(iniParse(filePath)),
  [Cracker.empress]: (filePath) => processGoldberg(jsonParse(filePath)),
  [Cracker.razor1911]: processRazor1911,
  [Cracker.Steam]: (filePath) =>
    processSteamCacheAchievement(jsonParse(filePath)),
  [Cracker.nemirtingas]: (filePath) =>
    parseEpicAchievementFile(filePath, Cracker.nemirtingas) ?? [],
  [Cracker.alanWake2]: (filePath) =>
    parseEpicAchievementFile(filePath, Cracker.alanWake2) ?? [],
};

export const parseAchievementFile = (
  filePath: string,
  type: Cracker
): UnlockedAchievement[] => {
  if (!existsSync(filePath)) return [];

  const parseAchievements = ACHIEVEMENT_PARSERS[type];

  if (!parseAchievements) {
    achievementsLogger.log(
      `Unprocessed ${type} achievements found on ${filePath}`
    );
    return [];
  }

  try {
    return parseAchievements(filePath).filter((achievement) =>
      Boolean(achievement.name?.trim())
    );
  } catch (err) {
    achievementsLogger.error(`Error parsing ${type} - ${filePath}`, err);
    return [];
  }
};
