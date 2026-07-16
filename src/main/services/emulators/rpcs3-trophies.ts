import fs from "node:fs";
import path from "node:path";

import {
  db,
  gameAchievementsSublevel,
  gamesShopCacheSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import type {
  AchievementNotificationInfo,
  GameAchievement,
  GameShop,
  SteamAchievement,
  UnlockedAchievement,
  UserAchievement,
} from "@types";

import { logger } from "../logger";
import { rpcs3ConfigRoots } from "./emulator-config";

interface Rpcs3TrophyPaths {
  trophyRootDir: string;
  trophyDir: string;
  sfmFilePath: string;
  datFilePath: string;
}

interface Rpcs3TrophyMetadata {
  id: number;
  name: string;
  detail: string;
  hidden: boolean;
  typeLetter: string;
  iconUrl: string;
}

interface Rpcs3TrophyLayout {
  trophyCount: number;
  table6Offset: number;
}

export interface Rpcs3TrophyState {
  achievements: SteamAchievement[];
  unlockedAchievements: UnlockedAchievement[];
  trophyPaths: Rpcs3TrophyPaths;
}

const isPs3Platform = (platform?: string | null): boolean => {
  return /playstation\s*3|\bps3\b/i.test(platform ?? "");
};

export const isLaunchboxRpcs3Game = async (
  shop: GameShop,
  objectId: string
): Promise<boolean> => {
  if (shop !== "launchbox") return false;

  const language = await db
    .get<string, string>(levelKeys.language, {
      valueEncoding: "utf8",
    })
    .then((value) => value || "en")
    .catch(() => "en");

  const shopDetails = await gamesShopCacheSublevel
    .get(levelKeys.gameShopCacheItem(shop, objectId, language))
    .catch(() => null);

  return isPs3Platform(shopDetails?.platform);
};

const parseTitleName = (xmlContent: string): string | null => {
  const match = xmlContent.match(/<title-name>([^<]*)<\/title-name>/i);
  return match?.[1]?.trim() ?? null;
};

const normalizeRpcs3Title = (title: string): string => {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
};

const stripCommonEditionSuffixes = (title: string): string => {
  return title
    .replace(
      /\s*(?:\(|\[)(?:hd|high definition|remaster(?:ed)?|definitive edition|complete edition|game of the year(?: edition)?|goty|deluxe edition|ultimate edition|anniversary edition|special edition|collection)\s*(?:\)|\])\s*$/i,
      ""
    )
    .replace(
      /\s+(?:hd|high definition|remaster(?:ed)?|definitive edition|complete edition|game of the year(?: edition)?|goty|deluxe edition|ultimate edition|anniversary edition|special edition|collection)\s*$/i,
      ""
    )
    .trim();
};

const titlesMatch = (left: string, right: string): boolean => {
  const normalizedLeft = normalizeRpcs3Title(left);
  const normalizedRight = normalizeRpcs3Title(right);

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const strippedLeft = normalizeRpcs3Title(stripCommonEditionSuffixes(left));
  const strippedRight = normalizeRpcs3Title(stripCommonEditionSuffixes(right));

  return strippedLeft === strippedRight;
};

const getTitleMatchScore = (titleName: string, gameTitle: string): number => {
  const normalizedTitleName = normalizeRpcs3Title(titleName);
  const normalizedGameTitle = normalizeRpcs3Title(gameTitle);

  if (normalizedTitleName === normalizedGameTitle) {
    return 2;
  }

  const strippedTitleName = normalizeRpcs3Title(
    stripCommonEditionSuffixes(titleName)
  );
  const strippedGameTitle = normalizeRpcs3Title(
    stripCommonEditionSuffixes(gameTitle)
  );

  if (strippedTitleName === strippedGameTitle) {
    return 1;
  }

  return 0;
};

const getTrophyRootDirs = (executablePath: string | null): string[] => {
  const roots = rpcs3ConfigRoots(executablePath).map((root) =>
    path.join(root, "dev_hdd0", "home", "00000001", "trophy")
  );

  logger.log("RPCS3 trophy root directories", {
    executablePath,
    roots,
  });

  return roots;
};

const parseTrophyMetadata = (
  sfmFilePath: string,
  trophyDir: string
): Rpcs3TrophyMetadata[] => {
  try {
    const xmlContent = fs.readFileSync(sfmFilePath, "utf-8");
    const trophies: Rpcs3TrophyMetadata[] = [];
    const trophyRegex = /<trophy\b([^>]*)>([\s\S]*?)<\/trophy>/gi;
    let trophyMatch: RegExpExecArray | null;

    while ((trophyMatch = trophyRegex.exec(xmlContent))) {
      const attributes = trophyMatch[1];
      const innerContent = trophyMatch[2];

      const idMatch = attributes.match(/\bid="([^"]*)"/i);
      if (!idMatch) continue;

      const id = Number.parseInt(idMatch[1], 10);
      if (!Number.isFinite(id)) continue;

      const typeMatch = attributes.match(/\bttype="([^"]*)"/i);
      const typeLetter = (typeMatch?.[1]?.[0] ?? "B").toUpperCase();

      const hiddenMatch = attributes.match(/\bhidden="([^"]*)"/i);
      const hidden = /^y(es)?$/i.test(hiddenMatch?.[1] ?? "");

      const nameMatch = innerContent.match(/<name>([^<]*)<\/name>/i);
      const detailMatch = innerContent.match(/<detail>([^<]*)<\/detail>/i);
      const paddedId = String(id).padStart(3, "0");
      const iconPath = path.join(trophyDir, `TROP${paddedId}.PNG`);

      trophies.push({
        id,
        name: nameMatch?.[1]?.trim() || `Trophy ${id}`,
        detail: detailMatch?.[1]?.trim() || "",
        hidden,
        typeLetter,
        iconUrl: `local:${iconPath}`,
      });
    }

    return trophies;
  } catch (error) {
    logger.error("Error parsing RPCS3 trophy metadata", error);
    return [];
  }
};

const parseUnlockedTrophyIds = (datFilePath: string): Map<number, number> => {
  try {
    if (!fs.existsSync(datFilePath)) {
      return new Map();
    }

    const buffer = fs.readFileSync(datFilePath);

    if (buffer.length < 0x50 || buffer.readUInt32BE(0) !== 0x818f54ad) {
      return new Map();
    }

    const tableCount = buffer.readUInt32BE(0x08);
    const layout = getRpcs3TrophyLayout(buffer, tableCount);
    if (!layout) {
      return new Map();
    }

    const { trophyCount, table6Offset } = layout;
    const blockSize = 0x70;
    const unlocked = new Map<number, number>();

    for (let index = 0; index < trophyCount; index++) {
      const currentOffset = table6Offset + index * blockSize;
      if (currentOffset + 32 > buffer.length) break;

      if (buffer.readUInt32BE(currentOffset) !== 6) continue;

      const trophyId = buffer.readUInt32BE(currentOffset + 8);
      const isUnlocked = buffer.readUInt32BE(currentOffset + 20);
      const unlockTime = Number(buffer.readBigUInt64BE(currentOffset + 40));

      if (isUnlocked === 1) {
        unlocked.set(trophyId, Number.isFinite(unlockTime) ? unlockTime : 0);
      }
    }

    return unlocked;
  } catch (error) {
    logger.error("Error reading RPCS3 trophy progress", error);
    return new Map();
  }
};

const getRpcs3TrophyLayout = (
  buffer: Buffer,
  tableCount: number
): Rpcs3TrophyLayout | null => {
  const tableHeaderOffset = 0x30;
  const tableHeaderSize = 0x20;

  if (!Number.isInteger(tableCount) || tableCount < 2) {
    return null;
  }

  for (let index = 0; index < tableCount; index++) {
    const currentOffset = tableHeaderOffset + index * tableHeaderSize;
    if (currentOffset + tableHeaderSize > buffer.length) {
      return null;
    }

    const type = buffer.readUInt32BE(currentOffset);
    if (type !== 6) {
      continue;
    }

    const trophyCount = buffer.readUInt32BE(currentOffset + 0x0c);
    const table6Offset = Number(buffer.readBigUInt64BE(currentOffset + 0x10));

    if (
      !Number.isFinite(trophyCount) ||
      trophyCount <= 0 ||
      !Number.isSafeInteger(table6Offset) ||
      table6Offset < 0x70 ||
      table6Offset >= buffer.length
    ) {
      return null;
    }

    return { trophyCount, table6Offset };
  }

  return null;
};

const toSteamAchievement = (
  trophy: Rpcs3TrophyMetadata,
  trophyDir: string
): SteamAchievement => {
  const paddedId = String(trophy.id).padStart(3, "0");
  const iconPath = path.join(trophyDir, `TROP${paddedId}.PNG`);
  const iconUrl = `local:${iconPath}`;

  return {
    name: String(trophy.id),
    displayName: trophy.name,
    description: trophy.detail || undefined,
    icon: iconUrl,
    icongray: iconUrl,
    hidden: trophy.hidden,
  };
};

export const findRpcs3TrophyPaths = async (
  executablePath: string | null,
  gameTitle: string
): Promise<Rpcs3TrophyPaths | null> => {
  const normalizedTitle = gameTitle.trim();
  if (!normalizedTitle) {
    logger.log("Skipping RPCS3 trophy discovery because title was empty", {
      executablePath,
      gameTitle,
    });

    return null;
  }

  const trophyRootDirs = getTrophyRootDirs(executablePath);
  logger.log("Scanning RPCS3 trophy roots", trophyRootDirs, gameTitle);

  const candidates: Array<Rpcs3TrophyPaths & { score: number }> = [];

  for (const trophyRootDir of trophyRootDirs) {
    if (!fs.existsSync(trophyRootDir)) {
      logger.log("RPCS3 trophy root not found", trophyRootDir);
      continue;
    }

    const folders = fs.readdirSync(trophyRootDir);
    logger.log("Found RPCS3 trophy folders", trophyRootDir, folders);
    for (const folder of folders) {
      const trophyDir = path.join(trophyRootDir, folder);
      if (!fs.statSync(trophyDir).isDirectory()) continue;

      const sfmFilePath = path.join(trophyDir, "TROPCONF.SFM");
      const datFilePath = path.join(trophyDir, "TROPUSR.DAT");

      if (!fs.existsSync(sfmFilePath)) continue;

      if (!fs.existsSync(datFilePath)) {
        logger.log(
          "RPCS3 trophy DAT missing, using discovered trophy folder anyway",
          {
            trophyRootDir,
            trophyDir,
            datFilePath,
          }
        );
      }

      const titleName = parseTitleName(fs.readFileSync(sfmFilePath, "utf-8"));
      if (!titleName || !titlesMatch(titleName, normalizedTitle)) continue;

      const score = getTitleMatchScore(titleName, normalizedTitle);
      if (score === 0) continue;

      logger.log("Matched RPCS3 trophy folder", {
        trophyRootDir,
        trophyDir,
        titleName,
        gameTitle,
        score,
      });

      candidates.push({
        trophyRootDir,
        trophyDir,
        sfmFilePath,
        datFilePath,
        score,
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => right.score - left.score);
  const topScore = candidates[0].score;
  const topCandidates = candidates.filter(
    (candidate) => candidate.score === topScore
  );

  if (topCandidates.length > 1) {
    logger.warn("Ambiguous RPCS3 trophy folder match", {
      gameTitle,
      candidates: topCandidates.map(({ ...candidate }) => candidate),
    });
    return null;
  }

  const { score: _score, ...resolvedCandidate } = topCandidates[0];
  return resolvedCandidate;
};

export const readRpcs3TrophyState = async (
  executablePath: string | null,
  gameTitle: string
): Promise<Rpcs3TrophyState | null> => {
  logger.log("readRpcs3TrophyState called", {
    executablePath,
    gameTitle,
  });

  const trophyPaths = await findRpcs3TrophyPaths(executablePath, gameTitle);
  if (!trophyPaths) {
    logger.log("readRpcs3TrophyState found no RPCS3 trophy paths", {
      executablePath,
      gameTitle,
    });

    return null;
  }

  logger.log("readRpcs3TrophyState resolved RPCS3 trophy paths", trophyPaths);

  const metadata = parseTrophyMetadata(
    trophyPaths.sfmFilePath,
    trophyPaths.trophyDir
  );
  const unlockedTimes = parseUnlockedTrophyIds(trophyPaths.datFilePath);

  logger.log(metadata.length, "RPCS3 trophies found for", gameTitle);

  return {
    achievements: metadata.map((trophy) =>
      toSteamAchievement(trophy, trophyPaths.trophyDir)
    ),
    unlockedAchievements: metadata
      .filter((trophy) => unlockedTimes.has(trophy.id))
      .map((trophy) => ({
        name: String(trophy.id),
        unlockTime: unlockedTimes.get(trophy.id) ?? 0,
      })),
    trophyPaths,
  };
};

export const buildRpcs3UserAchievements = (
  state: Rpcs3TrophyState,
  showHiddenAchievementsDescription: boolean
): UserAchievement[] => {
  const unlockedByName = new Map(
    state.unlockedAchievements.map((achievement) => {
      return [achievement.name.toUpperCase(), achievement] as const;
    })
  );

  return state.achievements
    .map((achievement) => {
      const unlockedAchievement = unlockedByName.get(
        achievement.name.toUpperCase()
      );

      return {
        ...achievement,
        unlocked: Boolean(unlockedAchievement),
        unlockTime: unlockedAchievement?.unlockTime ?? null,
        description:
          !achievement.hidden || showHiddenAchievementsDescription
            ? achievement.description
            : undefined,
      };
    })
    .sort((a, b) => {
      if (a.unlocked && !b.unlocked) return -1;
      if (!a.unlocked && b.unlocked) return 1;
      if (a.unlocked && b.unlocked) {
        return b.unlockTime! - a.unlockTime!;
      }

      return Number(a.hidden) - Number(b.hidden);
    });
};

export const getRpcs3NotificationInfo = (
  title: string,
  description: string | undefined,
  iconUrl: string,
  hidden: boolean,
  typeLetter: string
): AchievementNotificationInfo => {
  return {
    title,
    description,
    iconUrl,
    isHidden: hidden,
    isRare: typeLetter !== "B",
    isPlatinum: typeLetter === "P",
  };
};

export const saveRpcs3TrophyState = async (
  gameKey: string,
  state: Rpcs3TrophyState
): Promise<void> => {
  await gameAchievementsSublevel.put(gameKey, {
    achievements: state.achievements,
    unlockedAchievements: state.unlockedAchievements,
    updatedAt: Date.now(),
    language: "rpcs3",
    catalogueValidator: state.trophyPaths.trophyDir,
  } satisfies GameAchievement);

  const game = await gamesSublevel.get(gameKey).catch(() => null);
  if (!game || game.isDeleted) return;

  await gamesSublevel.put(gameKey, {
    ...game,
    achievementCount: state.achievements.length,
    unlockedAchievementCount: state.unlockedAchievements.length,
  });
};

export const clearRpcs3TrophyProgress = async (
  executablePath: string | null,
  gameTitle: string
): Promise<boolean> => {
  const trophyPaths = await findRpcs3TrophyPaths(executablePath, gameTitle);
  if (!trophyPaths) return false;

  try {
    if (!fs.existsSync(trophyPaths.datFilePath)) {
      return true;
    }

    const buffer = await fs.promises.readFile(trophyPaths.datFilePath);
    if (buffer.length < 0x50 || buffer.readUInt32BE(0) !== 0x818f54ad) {
      return true;
    }

    const tableCount = buffer.readUInt32BE(0x08);
    const layout = getRpcs3TrophyLayout(buffer, tableCount);
    if (!layout) {
      return true;
    }

    const { trophyCount, table6Offset } = layout;
    const blockSize = 0x70;

    for (let index = 0; index < trophyCount; index++) {
      const currentOffset = table6Offset + index * blockSize;
      if (currentOffset + 24 > buffer.length) break;

      if (buffer.readUInt32BE(currentOffset) !== 6) continue;

      buffer.writeUInt32BE(0, currentOffset + 20);
    }

    await fs.promises.writeFile(trophyPaths.datFilePath, buffer);
    return true;
  } catch (error) {
    logger.error("Failed to clear RPCS3 trophy DAT file", error);
    return false;
  }
};

export const getRpcs3UnlockedTrophyIds = (
  datFilePath: string
): Map<number, number> => {
  return parseUnlockedTrophyIds(datFilePath);
};
