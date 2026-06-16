import axios from "axios";
import type { RetroachievementsGameListItem } from "@main/level";
import {
  retroachievementsGameListsSublevel,
  retroachievementsGameProgressSublevel,
  levelKeys,
} from "@main/level";
import { achievementsLogger } from "../logger";

export interface RetroachievementAchievement {
  id: number;
  title: string;
  description: string;
  points: number;
  badgeId: number;
  displayOrder: number;
  badgeUnlockedUrl: string;
  badgeLockedUrl: string;
  dateEarned?: string | null;
  unlocksHardcore?: number;
  unlocksTotal?: number;
}

export interface RetroachievementGameData {
  id: number;
  title: string;
  pointsTotal: number;
  badgeUrl: string | null;
  imageBoxArtUrl: string | null;
  achievements: RetroachievementAchievement[];
}

export interface ResolveRetroachievementsGameIdParams {
  title: string;
  platform?: string | null;
  apiKey: string;
  username: string;
  cachedGameId?: number | null;
  cachedGameTitle?: string | null;
  cachedGamePlatform?: string | null;
}

const RETROACHIEVEMENTS_BASE_URL = "https://retroachievements.org";
const REQUEST_TIMEOUT_MS = 10_000;
const GAME_LIST_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const GAME_PROGRESS_CACHE_TTL_MS = 1000 * 60 * 5;

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, " ").trim();

const normalizeTitle = (value: string): string =>
  normalizeText(
    value.replace(/[([{][^)\]}]*[)\]}]/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ")
  );

const normalizePlatform = (value: string): string => normalizeText(value);

const getRetroachievementsSystemId = (
  platform?: string | null
): number | null => {
  const normalizedPlatform = platform ? normalizePlatform(platform) : "";

  if (/(playstation 1|ps1|psx)/i.test(normalizedPlatform)) {
    return 12;
  }

  if (/(playstation 2|ps2)/i.test(normalizedPlatform)) {
    return 21;
  }

  return null;
};

interface RetroachievementsGameUserProgressAchievement {
  ID: number;
  Title: string;
  Description: string;
  Points: number;
  BadgeName: string;
  DisplayOrder?: number;
  NumAwarded?: number;
  NumAwardedHardcore?: number;
  TrueRatio?: number;
  DateEarned?: string | null;
}

interface RetroachievementsGameUserProgressResponse {
  ID: number;
  Title: string;
  ConsoleID?: number;
  ConsoleId?: number;
  ConsoleName?: string;
  ImageBoxArt?: string;
  ImageIcon?: string;
  ImageTitle?: string;
  Publisher?: string;
  Developer?: string;
  Genre?: string;
  NumAchievements?: number;
  Achievements?: Record<string, RetroachievementsGameUserProgressAchievement>;
  NumAwardedToUser?: number;
  NumAwardedToUserHardcore?: number;
  UserCompletion?: string;
  UserCompletionHardcore?: string;
}

interface RetroachievementsGameListCacheEntry {
  updatedAt: number;
  games: RetroachievementsGameListItem[];
}

const fetchRetroachievementsGameList = async (
  systemId: number,
  apiKey: string,
  username: string
): Promise<RetroachievementsGameListItem[]> => {
  const cacheKey = levelKeys.retroachievementsGameList(systemId);
  const cached = await retroachievementsGameListsSublevel
    .get(cacheKey)
    .catch(() => null);

  if (cached && cached.updatedAt + GAME_LIST_CACHE_TTL_MS > Date.now()) {
    return cached.games;
  }

  const response = await axios.get<RetroachievementsGameListItem[]>(
    `${RETROACHIEVEMENTS_BASE_URL}/API/API_GetGameList.php`,
    {
      timeout: REQUEST_TIMEOUT_MS,
      params: {
        z: username,
        y: apiKey,
        i: systemId,
        f: 1,
      },
      headers: {
        Accept: "application/json",
      },
    }
  );

  const games = response.data ?? [];
  const cacheEntry: RetroachievementsGameListCacheEntry = {
    updatedAt: Date.now(),
    games,
  };

  await retroachievementsGameListsSublevel.put(cacheKey, cacheEntry);

  return games;
};

export const resolveRetroachievementsGameId = async ({
  title,
  platform,
  apiKey,
  username,
  cachedGameId,
  cachedGameTitle: _cachedGameTitle,
  cachedGamePlatform: _cachedGamePlatform,
}: ResolveRetroachievementsGameIdParams): Promise<number | null> => {
  if (cachedGameId) {
    return cachedGameId;
  }

  const normalizedTitle = normalizeTitle(title);

  const systemId = getRetroachievementsSystemId(platform);
  if (!systemId) {
    return null;
  }

  try {
    const games = await fetchRetroachievementsGameList(
      systemId,
      apiKey,
      username
    );
    const exactMatch = games.find(
      (game) => normalizeTitle(game.Title) === normalizedTitle
    );

    return exactMatch?.ID ?? null;
  } catch (error) {
    achievementsLogger.error(
      `Failed to resolve RetroAchievements game id for ${title}`,
      error
    );
    return null;
  }
};

export const fetchRetroachievementsGame = async (
  gameId: number,
  apiKey: string,
  username?: string
): Promise<RetroachievementGameData | null> => {
  try {
    if (!apiKey) {
      achievementsLogger.warn(
        `RetroAchievements API key not configured for game ${gameId}`
      );
      return null;
    }

    const progressCacheKey = levelKeys.retroachievementsGameProgressItem(
      gameId,
      username
    );
    const cachedProgress = await retroachievementsGameProgressSublevel
      .get(progressCacheKey)
      .catch(() => null);

    if (
      cachedProgress &&
      cachedProgress.updatedAt + GAME_PROGRESS_CACHE_TTL_MS > Date.now()
    ) {
      achievementsLogger.debug(
        `Using cached RetroAchievements progress for game ${gameId}`
      );
      return cachedProgress.data;
    }

    const params: Record<string, unknown> = {
      y: apiKey,
      g: gameId,
    };
    if (username) params.u = username;

    const response = await axios.get<RetroachievementsGameUserProgressResponse>(
      `${RETROACHIEVEMENTS_BASE_URL}/API/API_GetGameInfoAndUserProgress.php`,
      {
        timeout: REQUEST_TIMEOUT_MS,
        params,
        headers: {
          Accept: "application/json",
        },
      }
    );

    const data = response.data;

    const achievementsObj = (data.Achievements ?? {}) as Record<
      string,
      RetroachievementsGameUserProgressAchievement
    >;
    const achievements = Object.values(achievementsObj)
      .sort((a, b) => (a.DisplayOrder ?? 0) - (b.DisplayOrder ?? 0))
      .flatMap((achievement) => {
        const badgeId = Number.parseInt(achievement.BadgeName, 10);
        if (!Number.isFinite(badgeId)) return [];

        return [
          {
            id: achievement.ID,
            title: achievement.Title,
            description: achievement.Description,
            points: achievement.Points,
            badgeId,
            displayOrder: achievement.DisplayOrder ?? 0,
            badgeUnlockedUrl: `${RETROACHIEVEMENTS_BASE_URL}/Badge/${achievement.BadgeName}.png`,
            badgeLockedUrl: `${RETROACHIEVEMENTS_BASE_URL}/Badge/${achievement.BadgeName}_lock.png`,
            dateEarned: achievement.DateEarned ?? null,
            unlocksHardcore: achievement.NumAwardedHardcore,
            unlocksTotal: achievement.NumAwarded,
          },
        ];
      });

    const gameData: RetroachievementGameData = {
      id: data.ID,
      title: data.Title,
      achievements,
      pointsTotal: achievements.reduce(
        (total, achievement) => total + achievement.points,
        0
      ),
      badgeUrl: data.ImageBoxArt
        ? `${RETROACHIEVEMENTS_BASE_URL}${data.ImageBoxArt}`
        : null,
      imageBoxArtUrl: data.ImageBoxArt
        ? `${RETROACHIEVEMENTS_BASE_URL}${data.ImageBoxArt}`
        : null,
    };

    await retroachievementsGameProgressSublevel.put(progressCacheKey, {
      updatedAt: Date.now(),
      data: gameData,
    });

    achievementsLogger.debug(
      `Fetched ${achievements.length} achievements for game ${gameId}`
    );

    return gameData;
  } catch (error) {
    achievementsLogger.error(
      `Failed to fetch retroachievements game ${gameId}:`,
      error
    );
    return null;
  }
};
