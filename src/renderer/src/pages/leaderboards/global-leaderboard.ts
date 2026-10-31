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
export const PLAY_ACTIVITY_WEEKS = 53;
// Board sizes are shown as "10,000+" past this, so a big all-time board does
// not print a huge number next to the rank.
export const BOARD_TOTAL_CAP = 10_000;

export const formatBoardTotal = (
  total: number,
  format: (value: number) => string
) => (total >= BOARD_TOTAL_CAP ? `${format(BOARD_TOTAL_CAP)}+` : format(total));
// Older backends cap play activity at 26 weeks and answer 400 above it.
export const PLAY_ACTIVITY_FALLBACK_WEEKS = 26;
// A month label needs about two columns, so labels closer than this to the
// next one or to the end of the grid are dropped.
const HEATMAP_MONTH_MIN_WEEKS = 3;
const HEATMAP_MONTH_END_WEEKS = 2;
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
  // Same shape as GameReview: translated text by base language ("pt").
  translations: Record<string, string>;
  detectedLanguage: string | null;
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
  // Players on the board; null while the API does not know it.
  total: number | null;
  leader: LeaderboardUser | null;
}

export interface PlayActivityDay {
  date: string;
  seconds: number;
  games: string[];
}

export interface PlayActivity {
  // Weeks the API answered for, which can be fewer than asked for.
  weeks: number;
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

// Locked game badges name the badge they lead to ("Top 10", "Top 5%").
export interface BadgeTarget {
  kind: "top_rank" | "top_percent";
  value: number;
}

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
  target: BadgeTarget | null;
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

const normalizeTranslations = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(
      (pair): pair is [string, string] =>
        typeof pair[1] === "string" && pair[1].length > 0
    )
  );
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
    translations: normalizeTranslations(value.translations),
    detectedLanguage: toStringOrNull(value.detectedLanguage),
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

export type BoardInsight =
  | { type: "leading"; gap: number; target: LeaderboardUser | null }
  | { type: "outside"; gap: number; lastRank: number }
  | { type: "ranked"; rank: number }
  | { type: "unranked" }
  | {
      type: "behind";
      gap: number;
      target: LeaderboardUser;
      targetRank: number;
      next: { goal: "podium" | "lead"; gap: number } | null;
    };

const BOARD_PODIUM_LAST_RANK = 3;

// What the viewer needs to climb. Without a real amount to show, it still says
// where they stand or how to join. Returns null only when signed out.
export const getBoardInsight = (
  leaderboard: GlobalLeaderboard,
  viewerId: string | null
): BoardInsight | null => {
  if (!viewerId) return null;

  const ranking = getViewerRanking(leaderboard, viewerId);
  if (!ranking) return { type: "unranked" };

  const ranked: BoardInsight = { type: "ranked", rank: ranking.rank };

  const { entries } = leaderboard;
  const gapTo = (value: number) => value - ranking.value;

  if (ranking.rank === 1) {
    const second = entries.find((entry) => entry.user.id !== viewerId) ?? null;
    if (!second) return { type: "leading", gap: 0, target: null };

    const gap = ranking.value - second.value;
    return gap > 0 ? { type: "leading", gap, target: second.user } : ranked;
  }

  const above = entries.findLast((entry) => entry.rank < ranking.rank);
  if (!above) return ranked;

  // Past the listed players, the next one is unknown: the goal is the list.
  if (above.rank !== ranking.rank - 1) {
    const listGap = gapTo(above.value);
    return listGap > 0
      ? { type: "outside", gap: listGap, lastRank: above.rank }
      : ranked;
  }

  const gap = gapTo(above.value);
  if (gap <= 0) return ranked;

  const goalEntry =
    ranking.rank > BOARD_PODIUM_LAST_RANK + 1
      ? entries.find((entry) => entry.rank === BOARD_PODIUM_LAST_RANK)
      : entries.find((entry) => entry.rank === 1);
  const nextGap = ranking.rank > 2 && goalEntry ? gapTo(goalEntry.value) : 0;

  return {
    type: "behind",
    gap,
    target: above.user,
    targetRank: above.rank,
    next:
      nextGap > 0
        ? {
            goal: ranking.rank > BOARD_PODIUM_LAST_RANK + 1 ? "podium" : "lead",
            gap: nextGap,
          }
        : null,
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

export const DAYS_PER_WEEK = 7;

// Keep these in sync with the activity graph in leaderboards.scss.
const HEATMAP_DAY_LABELS_WIDTH = 36;
const HEATMAP_GAP = 6;
const HEATMAP_MIN_CELL_SIZE = 12;
const HEATMAP_MAX_CELL_SIZE = 32;

// The graph fills the card: the cells grow up to a limit, and a card too narrow
// for every week at the smallest size shows fewer weeks.
export const getHeatmapLayout = (width: number | null, totalWeeks: number) => {
  const available = (width ?? 0) - HEATMAP_DAY_LABELS_WIDTH;
  const weeksThatFit = Math.floor(
    (available + HEATMAP_GAP) / (HEATMAP_MIN_CELL_SIZE + HEATMAP_GAP)
  );
  const weeks = Math.max(1, Math.min(totalWeeks, weeksThatFit));
  const cellSize = Math.max(
    HEATMAP_MIN_CELL_SIZE,
    Math.min(
      HEATMAP_MAX_CELL_SIZE,
      Math.floor((available - HEATMAP_GAP * (weeks - 1)) / weeks)
    )
  );

  return {
    weeks,
    cellSize,
    width:
      HEATMAP_DAY_LABELS_WIDTH + weeks * (cellSize + HEATMAP_GAP) - HEATMAP_GAP,
  };
};

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

export interface HeatmapMonth {
  week: number;
  date: Date;
}

// Labels each month on the first week that starts in it, like a contribution
// graph. Cells are week-major, so every seventh cell is a Monday.
export const buildHeatmapMonths = (cells: HeatmapCell[]): HeatmapMonth[] => {
  const weeks = Math.floor(cells.length / 7);
  const months: HeatmapMonth[] = [];

  for (let week = 0; week < weeks; week++) {
    const date = cells[week * 7].date;
    const previous = week > 0 ? cells[(week - 1) * 7].date : null;
    if (previous?.getUTCMonth() === date.getUTCMonth()) continue;
    months.push({ week, date });
  }

  return months.filter(
    (month, index) =>
      weeks - month.week >= HEATMAP_MONTH_END_WEEKS &&
      (month.week > 0 ||
        (months[index + 1]?.week ?? weeks) >= HEATMAP_MONTH_MIN_WEEKS)
  );
};

export const sumHeatmap = (cells: HeatmapCell[]) =>
  cells.reduce(
    (total, cell) => ({
      seconds: total.seconds + cell.seconds,
      days: total.days + (cell.seconds > 0 ? 1 : 0),
    }),
    { seconds: 0, days: 0 }
  );

export type HeatmapTotalDisplay =
  | { unit: "none" }
  | { unit: "minutes" | "hours"; amount: number };

// Under an hour the total is in minutes, so a short session does not read "0 h".
export const getHeatmapTotalDisplay = ({
  seconds,
  days,
}: {
  seconds: number;
  days: number;
}): HeatmapTotalDisplay => {
  if (days === 0) return { unit: "none" };

  const minutes = Math.max(1, Math.round(seconds / SECONDS_PER_MINUTE));
  if (minutes < MINUTES_PER_HOUR) return { unit: "minutes", amount: minutes };

  return { unit: "hours", amount: Math.round(seconds / SECONDS_PER_HOUR) };
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
        // The API sends null until the board size is known; a total below
        // the rank is as good as unknown.
        total:
          typeof item.total === "number" &&
          Number.isFinite(item.total) &&
          item.total >= rank
            ? Math.floor(item.total)
            : null,
        leader: normalizeUser(item.leader),
      },
    ];
  });
};

export const normalizePlayActivity = (
  response: unknown,
  weeks = PLAY_ACTIVITY_WEEKS
): PlayActivity => {
  if (!isRecord(response) || !Array.isArray(response.days)) {
    throw new TypeError("Invalid play activity response");
  }

  return {
    weeks,
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

const isTopBadgeKind = (kind: unknown): kind is BadgeTarget["kind"] =>
  kind === "top_rank" || kind === "top_percent";

// The N of "Top N" / "Top N%". The API sends it as `threshold`; `value` is
// the viewer's value on the board, never the N.
const toBadgeThreshold = (source: Record<string, unknown>) =>
  toNonNegativeNumber(source.threshold);

// Reads `target` when the API sends it and otherwise falls back to the locked
// badge itself, whose kind and threshold already describe the next badge.
const normalizeBadgeTarget = (
  item: Record<string, unknown>
): BadgeTarget | null => {
  if (toStringOrNull(item.earnedAt)) return null;
  const source = isRecord(item.target) ? item.target : item;
  if (!isTopBadgeKind(source.kind)) return null;
  const value = isRecord(item.target)
    ? toNonNegativeNumber(source.value, toBadgeThreshold(source))
    : toBadgeThreshold(source);
  return value ? { kind: source.kind, value } : null;
};

export const normalizeBadges = (response: unknown): LeaderboardBadges => {
  if (!isRecord(response) || !Array.isArray(response.badges)) {
    throw new TypeError("Invalid badges response");
  }

  const badges = response.badges.flatMap((item): LeaderboardBadge[] => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    if (!(BADGE_KINDS as readonly unknown[]).includes(item.kind)) return [];

    const target = normalizeBadgeTarget(item);
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
        value: isTopBadgeKind(item.kind)
          ? toBadgeThreshold(item)
          : toNonNegativeNumber(item.value),
        week: toPositiveInteger(item.week),
        currentRank: toPositiveInteger(item.currentRank),
        earnedAt: toStringOrNull(item.earnedAt),
        progress,
        target,
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
