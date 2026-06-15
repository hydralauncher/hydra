import axios from "axios";
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
  unlockPercentage?: number;
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

const RETROACHIEVEMENTS_BASE_URL = "https://retroachievements.org";
const REQUEST_TIMEOUT_MS = 10_000;

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, " ").trim();

interface RetroachievementsSearchResult {
  id: number;
  title: string;
  system?: {
    id?: number;
    name?: string;
    nameShort?: string;
  };
}

interface RetroachievementsSearchResponse {
  results?: {
    games?: RetroachievementsSearchResult[];
  };
}

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

export const resolveRetroachievementsGameId = async (
  title: string,
  platform?: string | null
): Promise<number | null> => {
  const normalizedTitle = normalizeText(title);
  const normalizedPlatform = platform ? normalizeText(platform) : "";

  try {
    const response = await axios.get<RetroachievementsSearchResponse>(
      `${RETROACHIEVEMENTS_BASE_URL}/internal-api/search`,
      {
        timeout: REQUEST_TIMEOUT_MS,
        params: {
          q: title,
          scope: "games",
        },
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
      }
    );

    const games = response.data.results?.games ?? [];
    const exactMatch = games.find((game) => {
      const normalizedGameTitle = normalizeText(game.title);
      const normalizedSystemName = normalizeText(game.system?.name ?? "");
      const normalizedSystemShort = normalizeText(game.system?.nameShort ?? "");

      return (
        normalizedGameTitle === normalizedTitle &&
        (normalizedPlatform === normalizedSystemName ||
          normalizedPlatform === normalizedSystemShort ||
          normalizedPlatform.includes(normalizedSystemShort) ||
          normalizedSystemShort.includes(normalizedPlatform))
      );
    });

    if (exactMatch) {
      return exactMatch.id;
    }

    const titleMatch = games.find(
      (game) => normalizeText(game.title) === normalizedTitle
    );
    if (titleMatch) {
      return titleMatch.id;
    }

    return games[0]?.id ?? null;
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
            unlockPercentage:
              achievement.NumAwardedHardcore && data.NumAchievements
                ? achievement.NumAwardedHardcore / data.NumAchievements
                : undefined,
            unlocksHardcore: achievement.NumAwardedHardcore,
            unlocksTotal: achievement.NumAwarded,
          },
        ];
      });

    return {
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
  } catch (error) {
    achievementsLogger.error(
      `Failed to fetch retroachievements game ${gameId}:`,
      error
    );
    return null;
  }
};
