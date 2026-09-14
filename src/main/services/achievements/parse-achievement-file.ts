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
