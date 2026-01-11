import { Cracker } from "@shared";
import { UnlockedAchievement } from "@types";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { achievementsLogger } from "../logger";

export const parseAchievementFile = (
  filePath: string,
  type: Cracker
): UnlockedAchievement[] => {
  if (!existsSync(filePath)) return [];

  try {
    if (type == Cracker.codex) {
      const parsed = iniParse(filePath);
      return processDefault(parsed);
    }

    if (type == Cracker.rune) {
      const parsed = iniParse(filePath);
      return processDefault(parsed);
    }

    if (type === Cracker.onlineFix) {
      const parsed = iniParse(filePath);
      return processOnlineFix(parsed);
    }

    if (type === Cracker.goldberg) {
      const parsed = jsonParse(filePath);
      return processGoldberg(parsed);
    }

    if (type == Cracker.userstats) {
      const parsed = iniParse(filePath);
      return processUserStats(parsed);
    }

    if (type == Cracker.rld) {
      const parsed = iniParse(filePath);
      return processRld(parsed);
    }

    if (type === Cracker.skidrow) {
      const parsed = iniParse(filePath);
      return processSkidrow(parsed);
    }

    if (type === Cracker._3dm) {
      const parsed = iniParse(filePath);
      return process3DM(parsed);
    }

    if (type === Cracker.flt) {
      const achievements = readdirSync(filePath);

      return achievements.map((achievement) => {
        return {
          name: achievement,
          unlockTime: Date.now(),
        };
      });
    }

    if (type === Cracker.creamAPI) {
      const parsed = iniParse(filePath);
      return processCreamAPI(parsed);
    }

    if (type === Cracker.empress) {
      const parsed = jsonParse(filePath);
      return processGoldberg(parsed);
    }

    if (type === Cracker.razor1911) {
      return processRazor1911(filePath);
    }

    if (type === Cracker.Steam) {
      const parsed = jsonParse(filePath);
      return processSteamCacheAchievement(parsed);
    }

    achievementsLogger.log(
      `Unprocessed ${type} achievements found on ${filePath}`
    );
    return [];
  } catch (err) {
    achievementsLogger.error(`Error parsing ${type} - ${filePath}`, err);
    return [];
  }
};

const iniParse = (filePath: string) => {
  const fileContent = readFileSync(filePath, "utf-8");

  const lines =
    fileContent.charCodeAt(0) === 0xfeff
      ? fileContent.slice(1).split(/[\r\n]+/)
      : fileContent.split(/[\r\n]+/);

  let objectName = "";
  const object: Record<string, Record<string, string | number>> = {};

  for (const line of lines) {
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
};

const jsonParse = (filePath: string) => {
  return JSON.parse(readFileSync(filePath, "utf-8"));
};

const processRazor1911 = (filePath: string): UnlockedAchievement[] => {
  const fileContent = readFileSync(filePath, "utf-8");

  const lines =
    fileContent.charCodeAt(0) === 0xfeff
      ? fileContent.slice(1).split(/[\r\n]+/)
      : fileContent.split(/[\r\n]+/);

  const achievements: UnlockedAchievement[] = [];
  for (const line of lines) {
    if (!line.length) continue;

    const [name, unlocked, unlockTime] = line.split(" ");
    if (unlocked === "1") {
      achievements.push({
        name,
        unlockTime: Number(unlockTime) * 1000,
      });
    }
  }

  return achievements;
};

const processOnlineFix = (
  unlockedAchievements: Record<string, unknown>
): UnlockedAchievement[] => {
  const parsedUnlockedAchievements: UnlockedAchievement[] = [];

  for (const achievement of Object.keys(unlockedAchievements)) {
    const unlockedAchievement = unlockedAchievements[achievement] as Record<
      string,
      unknown
    >;

    if (unlockedAchievement?.achieved == "true") {
      parsedUnlockedAchievements.push({
        name: achievement,
        unlockTime: (unlockedAchievement.timestamp as number) * 1000,
      });
    } else if (unlockedAchievement?.Achieved == "true") {
      const unlockTime = unlockedAchievement.TimeUnlocked as string;

      parsedUnlockedAchievements.push({
        name: achievement,
        unlockTime:
          unlockTime.length === 7
            ? Number(unlockTime) * 1000 * 1000
            : Number(unlockTime) * 1000,
      });
    }
  }

  return parsedUnlockedAchievements;
};

const processCreamAPI = (
  unlockedAchievements: Record<string, unknown>
): UnlockedAchievement[] => {
  const parsedUnlockedAchievements: UnlockedAchievement[] = [];

  for (const achievement of Object.keys(unlockedAchievements)) {
    const unlockedAchievement = unlockedAchievements[achievement] as Record<
      string,
      unknown
    >;

    if (unlockedAchievement?.achieved == "true") {
      const unlockTime = unlockedAchievement.unlocktime as string;
      parsedUnlockedAchievements.push({
        name: achievement,
        unlockTime:
          unlockTime.length === 7
            ? Number(unlockTime) * 1000 * 1000
            : Number(unlockTime) * 1000,
      });
    }
  }

  return parsedUnlockedAchievements;
};

const processSkidrow = (
  unlockedAchievements: Record<string, unknown>
): UnlockedAchievement[] => {
  const parsedUnlockedAchievements: UnlockedAchievement[] = [];
  const achievements = unlockedAchievements["Achievements"] as Record<
    string,
    string
  >;

  for (const achievement of Object.keys(achievements)) {
    const unlockedAchievement = achievements[achievement].split("@");

    if (unlockedAchievement[0] === "1") {
      parsedUnlockedAchievements.push({
        name: achievement,
        unlockTime:
          Number(unlockedAchievement[unlockedAchievement.length - 1]) * 1000,
      });
    }
  }

  return parsedUnlockedAchievements;
};

const processGoldberg = (
  unlockedAchievements: unknown
): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  if (Array.isArray(unlockedAchievements)) {
    for (const achievement of unlockedAchievements as Record<
      string,
      unknown
    >[]) {
      if (achievement?.earned) {
        newUnlockedAchievements.push({
          name: achievement.name as string,
          unlockTime: (achievement.earned_time as number) * 1000,
        });
      }
    }

    return newUnlockedAchievements;
  }

  const achievements = unlockedAchievements as Record<
    string,
    Record<string, unknown>
  >;

  for (const achievement of Object.keys(achievements)) {
    const unlockedAchievement = achievements[achievement];

    if (unlockedAchievement?.earned) {
      newUnlockedAchievements.push({
        name: achievement,
        unlockTime: (unlockedAchievement.earned_time as number) * 1000,
      });
    }
  }
  return newUnlockedAchievements;
};

const processSteamCacheAchievement = (
  unlockedAchievements: unknown[][]
): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  const achievementIndex = unlockedAchievements.findIndex(
    (element) => element[0] === "achievements"
  );

  if (achievementIndex === -1) {
    achievementsLogger.info("No achievements found in Steam cache file");
    return [];
  }

  const unlockedAchievementsData = (
    (unlockedAchievements[achievementIndex][1] as Record<string, unknown>)[
      "data"
    ] as Record<string, unknown>
  )["vecHighlight"] as Record<string, unknown>[];

  for (const achievement of unlockedAchievementsData) {
    if (achievement.bAchieved) {
      newUnlockedAchievements.push({
        name: achievement.strID as string,
        unlockTime: (achievement.rtUnlocked as number) * 1000,
      });
    }
  }

  return newUnlockedAchievements;
};

const process3DM = (
  unlockedAchievements: Record<string, unknown>
): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  const achievements = unlockedAchievements["State"] as Record<string, string>;
  const times = unlockedAchievements["Time"] as Record<string, string>;

  for (const achievement of Object.keys(achievements)) {
    if (achievements[achievement] == "0101") {
      const time = times[achievement];

      newUnlockedAchievements.push({
        name: achievement,
        unlockTime:
          new DataView(
            new Uint8Array(Buffer.from(time.toString(), "hex")).buffer
          ).getUint32(0, true) * 1000,
      });
    }
  }

  return newUnlockedAchievements;
};

const processDefault = (
  unlockedAchievements: Record<string, unknown>
): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  for (const achievement of Object.keys(unlockedAchievements)) {
    const unlockedAchievement = unlockedAchievements[achievement] as Record<
      string,
      unknown
    >;

    if (unlockedAchievement?.Achieved == "1") {
      newUnlockedAchievements.push({
        name: achievement,
        unlockTime: (unlockedAchievement.UnlockTime as number) * 1000,
      });
    }
  }

  return newUnlockedAchievements;
};

const processRld = (
  unlockedAchievements: Record<string, unknown>
): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  for (const achievement of Object.keys(unlockedAchievements)) {
    if (achievement === "Steam") continue;

    const unlockedAchievement = unlockedAchievements[achievement] as Record<
      string,
      unknown
    >;

    if (unlockedAchievement?.State) {
      const unlocked = new DataView(
        new Uint8Array(
          Buffer.from((unlockedAchievement.State as string).toString(), "hex")
        ).buffer
      ).getUint32(0, true);

      if (unlocked === 1) {
        newUnlockedAchievements.push({
          name: achievement,
          unlockTime:
            new DataView(
              new Uint8Array(
                Buffer.from(
                  (unlockedAchievement.Time as string).toString(),
                  "hex"
                )
              ).buffer
            ).getUint32(0, true) * 1000,
        });
      }
    }
  }

  return newUnlockedAchievements;
};

const processUserStats = (
  unlockedAchievements: Record<string, unknown>
): UnlockedAchievement[] => {
  const newUnlockedAchievements: UnlockedAchievement[] = [];

  const achievements = unlockedAchievements["ACHIEVEMENTS"] as Record<
    string,
    string
  >;

  if (!achievements) return [];

  for (const achievement of Object.keys(achievements)) {
    const unlockedAchievement = achievements[achievement];

    const unlockTime = Number(
      unlockedAchievement.slice(1, -1).replace("unlocked = true, time = ", "")
    );

    if (!isNaN(unlockTime)) {
      newUnlockedAchievements.push({
        name: achievement.replace(/"/g, ``),
        unlockTime: unlockTime * 1000,
      });
    }
  }

  return newUnlockedAchievements;
};
