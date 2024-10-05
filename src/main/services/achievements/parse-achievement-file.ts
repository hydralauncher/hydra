import { Cracker } from "@shared";
import { UnlockedAchievement } from "@types";
import { existsSync, createReadStream, readFileSync } from "node:fs";
import readline from "node:readline";
import { achievementsLogger } from "../logger";

export const parseAchievementFile = async (
  filePath: string,
  type: Cracker
): Promise<UnlockedAchievement[]> => {
  if (!existsSync(filePath)) return [];

  if (type == Cracker.codex) {
    const parsed = await iniParse(filePath);
    return processDefault(parsed);
  }

  if (type == Cracker.rune) {
    const parsed = await iniParse(filePath);
    return processDefault(parsed);
  }

  if (type === Cracker.onlineFix) {
    const parsed = await iniParse(filePath);
    return processOnlineFix(parsed);
  }

  if (type === Cracker.goldberg) {
    const parsed = await jsonParse(filePath);
    return processGoldberg(parsed);
  }

  if (type == Cracker.userstats) {
    const parsed = await iniParse(filePath);
    return processUserStats(parsed);
  }

  if (type == Cracker.rld) {
    const parsed = await iniParse(filePath);
    return processRld(parsed);
  }

  if (type === Cracker.skidrow) {
    const parsed = await iniParse(filePath);
    return processSkidrow(parsed);
  }

  if (type === Cracker._3dm) {
    const parsed = await iniParse(filePath);
    return process3DM(parsed);
  }

  achievementsLogger.log(`${type} achievements found on ${filePath}`);
  return [];
};

const iniParse = async (filePath: string) => {
  try {
    const file = createReadStream(filePath);

    const lines = readline.createInterface({
      input: file,
      crlfDelay: Infinity,
    });

    let objectName = "";
    const object: Record<string, Record<string, string | number>> = {};

    for await (const line of lines) {
      if (line.startsWith("###") || !line.length) continue;

      if (line.startsWith("[") && line.endsWith("]")) {
        objectName = line.slice(1, -1);
        object[objectName] = {};
      } else {
        const [name, ...value] = line.split("=");
        object[objectName][name.trim()] = value.join("=").trim();
      }
    }

    return object;
  } catch {
    return null;
  }
};

const jsonParse = (filePath: string) => {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
};

const processOnlineFix = (unlockedAchievements: any): UnlockedAchievement[] => {
  const parsedUnlockedAchievements: UnlockedAchievement[] = [];

  for (const achievement of Object.keys(unlockedAchievements)) {
    const unlockedAchievement = unlockedAchievements[achievement];

    if (unlockedAchievement?.achieved) {
      parsedUnlockedAchievements.push({
        name: achievement,
        unlockTime: unlockedAchievement.timestamp,
      });
    }
  }

  return parsedUnlockedAchievements;
};

const processSkidrow = (unlockedAchievements: any): UnlockedAchievement[] => {
  const parsedUnlockedAchievements: UnlockedAchievement[] = [];
  const achievements = unlockedAchievements["Achievements"];

  for (const achievement of Object.keys(achievements)) {
    const unlockedAchievement = achievements[achievement].split("@");

    if (unlockedAchievement[0] === "1") {
      parsedUnlockedAchievements.push({
        name: achievement,
        unlockTime: unlockedAchievement[unlockedAchievement.length - 1],
      });
    }
  }

  return parsedUnlockedAchievements;
};

const processGoldberg = (unlockedAchievements: any): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  for (const achievement of Object.keys(unlockedAchievements)) {
    const unlockedAchievement = unlockedAchievements[achievement];

    if (unlockedAchievement?.earned) {
      newUnlockedAchievements.push({
        name: achievement,
        unlockTime: unlockedAchievement.earned_time,
      });
    }
  }
  return newUnlockedAchievements;
};

const process3DM = (unlockedAchievements: any): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  const achievements = unlockedAchievements["State"];
  const times = unlockedAchievements["Time"];

  for (const achievement of Object.keys(achievements)) {
    if (achievements[achievement] == "0101") {
      const time = times[achievement];

      newUnlockedAchievements.push({
        name: achievement,
        unlockTime: new DataView(
          new Uint8Array(Buffer.from(time.toString(), "hex")).buffer
        ).getUint32(0, true),
      });
    }
  }

  return newUnlockedAchievements;
};

const processDefault = (unlockedAchievements: any): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  for (const achievement of Object.keys(unlockedAchievements)) {
    const unlockedAchievement = unlockedAchievements[achievement];

    if (unlockedAchievement?.Achieved) {
      newUnlockedAchievements.push({
        name: achievement,
        unlockTime: unlockedAchievement.UnlockTime,
      });
    }
  }

  return newUnlockedAchievements;
};

const processRld = (unlockedAchievements: any): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  for (const achievement of Object.keys(unlockedAchievements)) {
    if (achievement === "Steam") continue;

    const unlockedAchievement = unlockedAchievements[achievement];

    if (unlockedAchievement?.State) {
      newUnlockedAchievements.push({
        name: achievement,
        unlockTime: new DataView(
          new Uint8Array(
            Buffer.from(unlockedAchievement.Time.toString(), "hex")
          ).buffer
        ).getUint32(0, true),
      });
    }
  }

  return newUnlockedAchievements;
};

const processUserStats = (unlockedAchievements: any): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  const achievements = unlockedAchievements["ACHIEVEMENTS"];

  if (!achievements) return [];

  for (const achievement of Object.keys(achievements)) {
    const unlockedAchievement = achievements[achievement];

    const unlockTime = Number(
      unlockedAchievement.slice(1, -1).replace("unlocked = true, time = ", "")
    );

    if (!isNaN(unlockTime)) {
      newUnlockedAchievements.push({
        name: achievement.replace(/"/g, ``),
        unlockTime: unlockTime,
      });
    }
  }

  return newUnlockedAchievements;
};
