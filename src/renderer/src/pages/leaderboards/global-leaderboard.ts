import {
  normalizeLeaderboardResponse,
  type Leaderboard,
  type LeaderboardRequestOptions,
  type LeaderboardUser,
} from "../game-details/leaderboard/game-leaderboard.js";
import { buildLeaderboardBoardPath } from "../../../../shared/leaderboard-notifications.js";

export const GLOBAL_LEADERBOARD_TAKE = 100;
export const GLOBAL_LEADERBOARD_PAGE_SIZE = 13;
export const GLOBAL_LEADERBOARD_PAGE_STEP = 10;
export const GLOBAL_LEADERBOARD_PODIUM_SIZE = 3;
export const PLAY_ACTIVITY_WEEKS = 15;
export const BADGES_PAGE_SIZE = 8;
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
export const PLAY_LEVEL_LOW_SECONDS = SECONDS_PER_HOUR;
export const PLAY_LEVEL_HIGH_SECONDS = 3 * SECONDS_PER_HOUR;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const METRIC_VALUE_TYPES = ["duration", "count", "days"] as const;
export const METRIC_SCOPES = ["global", "game"] as const;

export const GLOBAL_LEADERBOARD_PERIODS = ["week", "all"] as const;
export const GLOBAL_LEADERBOARD_SCOPES = ["global", "friends"] as const;
export const LEADERBOARD_PAGE_TABS = ["ranking", "games", "stats"] as const;

export type MetricValueType = (typeof METRIC_VALUE_TYPES)[number];
export type MetricScope = (typeof METRIC_SCOPES)[number];

export interface MetricDefinition {
  id: string;
  valueType: MetricValueType;
  label: string;
}
export type GlobalLeaderboardPeriod =
  (typeof GLOBAL_LEADERBOARD_PERIODS)[number];
export type GlobalLeaderboardScope = (typeof GLOBAL_LEADERBOARD_SCOPES)[number];
export type LeaderboardPageTab = (typeof LEADERBOARD_PAGE_TABS)[number];

export interface GlobalLeaderboardQuery {
  metric: string;
  period: GlobalLeaderboardPeriod;
  scope: GlobalLeaderboardScope;
  isLoggedIn: boolean;
}

export interface LeaderboardReview {
  gameTitle: string;
  shop: string;
  objectId: string;
  coverImageUrl: string | null;
  score: number;
  createdAt: string | null;
  text: string;
}

export interface LeaderboardEntryExtras {
  previousRank: number | null;
  streakActive: boolean | null;
  review: LeaderboardReview | null;
}

export interface GlobalLeaderboard extends Leaderboard {
  periodStart: string | null;
  periodEnd: string | null;
  total: number | null;
  viewerPreviousRank: number | null;
  extras: Record<string, LeaderboardEntryExtras>;
}

export type BoardState =
  | "loading"
  | "error"
  | "ready"
  | "empty"
  | "empty_friends";

export interface WeekRange {
  start: Date;
  end: Date;
}

export interface MyGameRanking {
  shop: string;
  objectId: string;
  title: string;
  coverImageUrl: string | null;
  heroImageUrl: string | null;
  rank: number;
  previousRank: number | null;
  total: number;
  leader: LeaderboardUser | null;
}

export interface PlayActivityDay {
  date: string;
  seconds: number;
  games: string[];
}

export interface PlayActivity {
  currentStreak: number;
  bestStreak: number;
  playedToday: boolean;
  days: PlayActivityDay[];
}

export interface FriendStreak {
  user: LeaderboardUser;
  days: number;
  bestDays: number;
  active: boolean;
  online: boolean;
}

export const BADGE_KINDS = [
  "top_percent",
  "weekly_leader",
  "top_rank",
  "friends_podium",
  "streak_record",
] as const;

export const BADGE_TIERS = ["gold", "silver", "bronze", "streak"] as const;

export type BadgeKind = (typeof BADGE_KINDS)[number];
export type BadgeTier = (typeof BADGE_TIERS)[number];

export interface LeaderboardBadge {
  id: string;
  kind: BadgeKind;
  tier: BadgeTier;
  metric: string | null;
  scope: GlobalLeaderboardScope;
  gameTitle: string | null;
  coverImageUrl: string | null;
  value: number;
  week: number | null;
  currentRank: number | null;
  earnedAt: string | null;
  progress: { current: number; target: number } | null;
}

export interface LeaderboardBadges {
  earned: number;
  total: number;
  badges: LeaderboardBadge[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toPositiveInteger = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;

const toNonNegativeNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;

const toStringOrNull = (value: unknown) =>
  typeof value === "string" && value ? value : null;

const normalizeUser = (value: unknown): LeaderboardUser | null => {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) {
    return null;
  }

  return {
    id: value.id,
    displayName: typeof value.displayName === "string" ? value.displayName : "",
    profileImageUrl: toStringOrNull(value.profileImageUrl),
    backgroundImageUrl: toStringOrNull(value.backgroundImageUrl),
  };
};

const normalizeReview = (value: unknown): LeaderboardReview | null => {
  if (!isRecord(value) || typeof value.text !== "string") return null;

  return {
    gameTitle: typeof value.gameTitle === "string" ? value.gameTitle : "",
    shop: typeof value.shop === "string" ? value.shop : "",
    objectId: typeof value.objectId === "string" ? value.objectId : "",
    coverImageUrl: toStringOrNull(value.coverImageUrl),
    score: toNonNegativeNumber(value.score),
    createdAt: toStringOrNull(value.createdAt),
    text: value.text,
  };
};

export const buildGlobalLeaderboardRequest = (
  query: GlobalLeaderboardQuery
): { path: string; options: LeaderboardRequestOptions } => {
  const scope = query.isLoggedIn ? query.scope : "global";

  return {
    path: buildLeaderboardBoardPath(query.metric, null),
    options: {
      params: { window: query.period, scope, take: GLOBAL_LEADERBOARD_TAKE },
      needsAuth: query.isLoggedIn,
    },
  };
};

export const normalizeGlobalLeaderboardResponse = (
  response: unknown
): GlobalLeaderboard => {
  if (!isRecord(response)) {
    throw new TypeError("Invalid leaderboard response");
  }

  const rawEntries = response.entries ?? response.users;
  const leaderboard = normalizeLeaderboardResponse({
    entries: rawEntries,
    viewer: response.viewer,
  });

  const extras: Record<string, LeaderboardEntryExtras> = {};
  if (Array.isArray(rawEntries)) {
    rawEntries.forEach((raw) => {
      if (!isRecord(raw)) return;
      const user = normalizeUser(raw.user);
      if (!user) return;

      extras[user.id] = {
        previousRank: toPositiveInteger(raw.previousRank),
        streakActive:
          typeof raw.streakActive === "boolean" ? raw.streakActive : null,
        review: normalizeReview(raw.review),
      };
    });
  }

  return {
    ...leaderboard,
    periodStart: toStringOrNull(response.weekStart ?? response.periodStart),
    periodEnd: toStringOrNull(response.weekEnd ?? response.periodEnd),
    total:
      typeof response.total === "number" && response.total >= 0
        ? response.total
        : null,
    viewerPreviousRank: isRecord(response.viewer)
      ? toPositiveInteger(response.viewer.previousRank)
      : null,
    extras,
  };
};

export const getRowsBelowPodium = <T>(
  rows: T[],
  listedCount: number,
  podiumSize = GLOBAL_LEADERBOARD_PODIUM_SIZE
) => [...rows.slice(podiumSize, listedCount), ...rows.slice(listedCount)];

export const getBoardState = ({
  isLoading,
  hasError,
  leaderboard,
  scope,
  viewerId,
}: {
  isLoading: boolean;
  hasError: boolean;
  leaderboard: Pick<Leaderboard, "entries"> | null;
  scope: GlobalLeaderboardScope;
  viewerId: string | null;
}): BoardState => {
  if (isLoading && !leaderboard) return "loading";
  if (hasError || !leaderboard) return "error";

  const others = leaderboard.entries.filter(
    (entry) => entry.user.id !== viewerId
  );

  if (scope === "friends" && others.length === 0) return "empty_friends";
  if (leaderboard.entries.length === 0) return "empty";

  return "ready";
};

export const buildMetricsRequest = (
  scope: MetricScope
): { path: string; options: LeaderboardRequestOptions } => ({
  path: "/leaderboards/metrics",
  options: { params: { scope }, needsAuth: false },
});

// Merged into "reviews" by the API (hydra-api#858), so it is never listed.
// Transitional: delete once hydralauncher/hydra-api#858 is live.
const EXCLUDED_METRICS = new Set(["review_upvotes"]);

export const normalizeMetricDefinitions = (
  response: unknown
): MetricDefinition[] => {
  const items = isRecord(response) ? response.metrics : response;
  if (!Array.isArray(items)) throw new TypeError("Invalid metrics response");

  const seen = new Set<string>();

  return items.flatMap((item): MetricDefinition[] => {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id) return [];
    if (seen.has(item.id) || EXCLUDED_METRICS.has(item.id)) return [];
    seen.add(item.id);

    return [
      {
        id: item.id,
        valueType: (METRIC_VALUE_TYPES as readonly unknown[]).includes(
          item.valueType
        )
          ? (item.valueType as MetricValueType)
          : "count",
        label:
          typeof item.label === "string" && item.label ? item.label : item.id,
      },
    ];
  });
};

export const hasStreakData = (leaderboard: GlobalLeaderboard | null) =>
  Boolean(leaderboard) &&
  Object.values(leaderboard?.extras ?? {}).some(
    (extras) => extras.streakActive !== null
  );

export const hasReviewData = (leaderboard: GlobalLeaderboard | null) =>
  Boolean(leaderboard) &&
  Object.values(leaderboard?.extras ?? {}).some(
    (extras) => extras.review !== null
  );

export const getRankDelta = (
  rank: number,
  previousRank: number | null
): number | null => (previousRank === null ? null : previousRank - rank);

export const getViewerRanking = (
  leaderboard: GlobalLeaderboard | null,
  viewerId: string | null
) => {
  if (!leaderboard || !viewerId) return null;

  const listed = leaderboard.entries.find(
    (entry) => entry.user.id === viewerId
  );
  if (listed) {
    return {
      rank: listed.rank,
      value: listed.value,
      delta: getRankDelta(
        listed.rank,
        leaderboard.extras[viewerId]?.previousRank ?? null
      ),
    };
  }

  if (!leaderboard.viewer) return null;

  return {
    rank: leaderboard.viewer.rank,
    value: leaderboard.viewer.value,
    delta: getRankDelta(
      leaderboard.viewer.rank,
      leaderboard.viewerPreviousRank
    ),
  };
};

export const getUtcWeekRange = (now: number): WeekRange => {
  const date = new Date(now);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  const start = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - daysSinceMonday
  );

  return { start: new Date(start), end: new Date(start + WEEK_MS) };
};

export const resolveWeekRange = (
  leaderboard: Pick<GlobalLeaderboard, "periodStart" | "periodEnd"> | null,
  now: number
): WeekRange => {
  const fallback = getUtcWeekRange(now);
  const start = leaderboard?.periodStart
    ? new Date(leaderboard.periodStart)
    : null;
  const end = leaderboard?.periodEnd ? new Date(leaderboard.periodEnd) : null;

  return {
    start: start && !Number.isNaN(start.getTime()) ? start : fallback.start,
    end: end && !Number.isNaN(end.getTime()) ? end : fallback.end,
  };
};

export const getCountdownParts = (end: Date, now: number) => {
  const totalMinutes = Math.floor(Math.max(0, end.getTime() - now) / 60_000);

  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
  };
};

export const getPlayLevel = (seconds: number) => {
  if (seconds <= 0) return 0;
  if (seconds < PLAY_LEVEL_LOW_SECONDS) return 1;
  if (seconds < PLAY_LEVEL_HIGH_SECONDS) return 2;

  return 3;
};

export interface HeatmapCell {
  date: Date;
  seconds: number;
  games: string[];
  level: number;
  isFuture: boolean;
  isToday: boolean;
  isYesterday: boolean;
}

export const buildHeatmap = (
  days: PlayActivityDay[],
  now: number,
  weeks = PLAY_ACTIVITY_WEEKS
): HeatmapCell[] => {
  const byDate = new Map(days.map((day) => [day.date.slice(0, 10), day]));
  const currentWeek = getUtcWeekRange(now).start.getTime();
  const firstDay = currentWeek - (weeks - 1) * WEEK_MS;
  const today = new Date(now).toISOString().slice(0, 10);
  const yesterday = new Date(now - DAY_MS).toISOString().slice(0, 10);

  return Array.from({ length: weeks * 7 }, (_, index) => {
    const date = new Date(firstDay + index * DAY_MS);
    const key = date.toISOString().slice(0, 10);
    const day = byDate.get(key);
    const seconds = day?.seconds ?? 0;

    return {
      date,
      seconds,
      games: day?.games ?? [],
      level: getPlayLevel(seconds),
      isFuture: key > today,
      isToday: key === today,
      isYesterday: key === yesterday,
    };
  });
};

export const normalizeMyGames = (response: unknown): MyGameRanking[] => {
  const items = isRecord(response) ? response.games : response;
  if (!Array.isArray(items)) throw new TypeError("Invalid games response");

  return items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const rank = toPositiveInteger(item.rank);
    if (
      typeof item.shop !== "string" ||
      typeof item.objectId !== "string" ||
      !rank
    ) {
      return [];
    }

    return [
      {
        shop: item.shop,
        objectId: item.objectId,
        title: typeof item.title === "string" ? item.title : "",
        coverImageUrl: toStringOrNull(item.coverImageUrl),
        heroImageUrl: toStringOrNull(item.heroImageUrl),
        rank,
        previousRank: toPositiveInteger(item.previousRank),
        total: toNonNegativeNumber(item.total, rank),
        leader: normalizeUser(item.leader),
      },
    ];
  });
};

export const normalizePlayActivity = (response: unknown): PlayActivity => {
  if (!isRecord(response) || !Array.isArray(response.days)) {
    throw new TypeError("Invalid play activity response");
  }

  return {
    currentStreak: toNonNegativeNumber(response.currentStreak),
    bestStreak: toNonNegativeNumber(response.bestStreak),
    playedToday: response.playedToday === true,
    days: response.days.flatMap((day) =>
      isRecord(day) && typeof day.date === "string"
        ? [
            {
              date: day.date,
              seconds: toNonNegativeNumber(day.seconds),
              games: Array.isArray(day.games)
                ? day.games.filter(
                    (game): game is string => typeof game === "string"
                  )
                : [],
            },
          ]
        : []
    ),
  };
};

export const normalizeFriendStreaks = (response: unknown): FriendStreak[] => {
  const items = isRecord(response) ? response.friends : response;
  if (!Array.isArray(items)) throw new TypeError("Invalid streaks response");

  return items
    .flatMap((item) => {
      if (!isRecord(item)) return [];
      const user = normalizeUser(item.user);
      if (!user) return [];

      return [
        {
          user,
          days: toNonNegativeNumber(item.days),
          bestDays: toNonNegativeNumber(item.bestDays),
          active: item.active === true,
          online: item.online === true,
        },
      ];
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.days - a.days);
};

export const normalizeBadges = (response: unknown): LeaderboardBadges => {
  if (!isRecord(response) || !Array.isArray(response.badges)) {
    throw new TypeError("Invalid badges response");
  }

  const badges = response.badges.flatMap((item): LeaderboardBadge[] => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    if (!(BADGE_KINDS as readonly unknown[]).includes(item.kind)) return [];

    const progress = isRecord(item.progress)
      ? {
          current: toNonNegativeNumber(item.progress.current),
          target: toNonNegativeNumber(item.progress.target, 1) || 1,
        }
      : null;

    return [
      {
        id: item.id,
        kind: item.kind as BadgeKind,
        tier: (BADGE_TIERS as readonly unknown[]).includes(item.tier)
          ? (item.tier as BadgeTier)
          : "gold",
        metric: toStringOrNull(item.metric),
        scope: item.scope === "friends" ? "friends" : "global",
        gameTitle: toStringOrNull(item.gameTitle),
        coverImageUrl: toStringOrNull(item.coverImageUrl),
        value: toNonNegativeNumber(item.value),
        week: toPositiveInteger(item.week),
        currentRank: toPositiveInteger(item.currentRank),
        earnedAt: toStringOrNull(item.earnedAt),
        progress,
      },
    ];
  });

  return {
    earned: toNonNegativeNumber(
      response.earned,
      badges.filter((badge) => badge.earnedAt).length
    ),
    total: toNonNegativeNumber(response.total, badges.length),
    badges,
  };
};

export const getBadgeProgress = (badge: LeaderboardBadge) => {
  if (!badge.progress) return 0;

  return Math.min(
    100,
    Math.round((badge.progress.current / badge.progress.target) * 100)
  );
};
