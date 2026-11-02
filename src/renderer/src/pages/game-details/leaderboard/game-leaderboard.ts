import type { GameShop } from "@types";

export const LEADERBOARD_TAKE = 100;
export const LEADERBOARD_CARD_SIZE = 5;
export const LEADERBOARD_MIN_PROGRESS = 4;
const FRACTIONAL_HOURS_LIMIT = 10;

export const LEADERBOARD_PERIODS = ["week", "all"] as const;
export const LEADERBOARD_SCOPES = ["global", "friends"] as const;
export const LEADERBOARD_METRICS = [
  "playtime",
  "sessions",
  "souvenirs",
  "streak",
] as const;

export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];
export type LeaderboardScope = (typeof LEADERBOARD_SCOPES)[number];
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];

export type LeaderboardShop = Extract<GameShop, "steam" | "epic" | "launchbox">;

export const parseLeaderboardPeriod = (
  value: string | null
): LeaderboardPeriod =>
  (LEADERBOARD_PERIODS as readonly (string | null)[]).includes(value)
    ? (value as LeaderboardPeriod)
    : "week";

export const parseLeaderboardScope = (
  value: string | null
): LeaderboardScope =>
  (LEADERBOARD_SCOPES as readonly (string | null)[]).includes(value)
    ? (value as LeaderboardScope)
    : "global";

export const getServedMetrics = (
  servedIds: readonly string[] | null
): LeaderboardMetric[] => {
  const served = LEADERBOARD_METRICS.filter((metric) =>
    servedIds?.includes(metric)
  );
  return served.length > 0 ? served : ["playtime"];
};

export interface LeaderboardUser {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  value: number;
  user: LeaderboardUser;
}

export interface LeaderboardRankTarget {
  rank: number;
  value: number;
}

export interface LeaderboardViewer {
  rank: number;
  value: number;
  toTop?: LeaderboardRankTarget | null;
}

export interface Leaderboard {
  entries: LeaderboardEntry[];
  viewer: LeaderboardViewer | null;
}

export interface LeaderboardQuery {
  shop: GameShop;
  objectId: string;
  period: LeaderboardPeriod;
  scope: LeaderboardScope;
  metric: LeaderboardMetric;
  isLoggedIn: boolean;
  viewerId: string | null;
}

export interface LeaderboardRequestOptions {
  params: Record<string, string | number>;
  needsAuth: boolean;
}

export type LeaderboardGet = (
  path: string,
  options: LeaderboardRequestOptions
) => Promise<unknown>;

export interface LeaderboardRow {
  entry: LeaderboardEntry;
  isViewer: boolean;
  gapBefore: boolean;
  progress: number;
}

export type LeaderboardNudge =
  | { type: "leading" }
  | {
      type: "behind";
      gap: number;
      target: LeaderboardUser;
      targetRank: number;
    }
  | { type: "to_top"; gap: number; rank: number };

export type LeaderboardState =
  | "hidden"
  | "loading"
  | "error"
  | "ready"
  | "empty_week"
  | "empty_all"
  | "empty_friends"
  | "solo";

export interface LoadedLeaderboard {
  boardKey: string;
  leaderboard: Leaderboard;
  period: LeaderboardPeriod;
  scope: LeaderboardScope;
  metric: LeaderboardMetric;
}

export const getLeaderboardBoardKey = (
  shop: GameShop,
  objectId: string,
  viewerId: string | null
) => `${shop}:${objectId}:${viewerId ?? "anonymous"}`;

export const selectLoadedLeaderboard = (
  loaded: LoadedLeaderboard | null,
  boardKey: string,
  fallback: Pick<LoadedLeaderboard, "period" | "scope" | "metric">
) => {
  if (loaded?.boardKey !== boardKey) {
    return { leaderboard: null, ...fallback };
  }

  return {
    leaderboard: loaded.leaderboard,
    period: loaded.period,
    scope: loaded.scope,
    metric: loaded.metric,
  };
};

export const isLeaderboardShop = (shop: GameShop): shop is LeaderboardShop =>
  shop === "steam" || shop === "epic" || shop === "launchbox";

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const normalizeUser = (value: unknown): LeaderboardUser | null => {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !candidate.id) return null;

  return {
    id: candidate.id,
    displayName:
      typeof candidate.displayName === "string" ? candidate.displayName : "",
    profileImageUrl:
      typeof candidate.profileImageUrl === "string"
        ? candidate.profileImageUrl
        : null,
    backgroundImageUrl:
      typeof candidate.backgroundImageUrl === "string" &&
      candidate.backgroundImageUrl
        ? candidate.backgroundImageUrl
        : null,
  };
};

const readValue = (candidate: Record<string, unknown>) =>
  isNonNegativeNumber(candidate.value) ? candidate.value : null;

const normalizeEntry = (value: unknown): LeaderboardEntry | null => {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  const user = normalizeUser(candidate.user);
  const entryValue = readValue(candidate);

  if (!isPositiveInteger(candidate.rank) || !user || entryValue === null)
    return null;

  return { rank: candidate.rank, value: entryValue, user };
};

const normalizeViewer = (value: unknown): LeaderboardViewer | null => {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  const viewerValue = readValue(candidate);

  if (!isPositiveInteger(candidate.rank) || viewerValue === null) return null;

  const viewer: LeaderboardViewer = {
    rank: candidate.rank,
    value: viewerValue,
  };
  if ("toTop" in candidate) viewer.toTop = normalizeRankTarget(candidate.toTop);
  return viewer;
};

const normalizeRankTarget = (value: unknown): LeaderboardRankTarget | null => {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Record<string, unknown>;
  const targetValue = readValue(candidate);

  if (!isPositiveInteger(candidate.rank) || targetValue === null) return null;

  return { rank: candidate.rank, value: targetValue };
};

export const normalizeLeaderboardResponse = (
  response: unknown
): Leaderboard => {
  if (!response || typeof response !== "object") {
    throw new TypeError("Invalid leaderboard response");
  }

  const candidate = response as Record<string, unknown>;
  const items = candidate.entries;
  if (!Array.isArray(items)) {
    throw new TypeError("Invalid leaderboard response");
  }

  const seen = new Set<string>();
  const entries = items
    .flatMap((value) => {
      const entry = normalizeEntry(value);
      return entry ? [entry] : [];
    })
    .sort((a, b) => a.rank - b.rank)
    .filter((entry) => {
      if (seen.has(entry.user.id)) return false;
      seen.add(entry.user.id);
      return true;
    });

  return {
    entries,
    viewer: normalizeViewer(candidate.viewer),
  };
};

export const findViewerEntry = (
  leaderboard: Pick<Leaderboard, "entries" | "viewer">,
  viewerUser: LeaderboardUser | null
): LeaderboardEntry | null => {
  if (!viewerUser) return null;

  const listed = leaderboard.entries.find(
    (entry) => entry.user.id === viewerUser.id
  );
  if (listed) return listed;

  if (!leaderboard.viewer) return null;

  return { ...leaderboard.viewer, user: viewerUser };
};

const getProgress = (value: number, topValue: number) => {
  if (topValue <= 0) return LEADERBOARD_MIN_PROGRESS;

  return Math.min(
    100,
    Math.max(LEADERBOARD_MIN_PROGRESS, Math.round((value / topValue) * 100))
  );
};

export const buildLeaderboardRows = (
  leaderboard: Pick<Leaderboard, "entries" | "viewer">,
  viewerUser: LeaderboardUser | null,
  size: number
): LeaderboardRow[] => {
  const topValue = leaderboard.entries[0]?.value ?? 0;
  const viewerEntry = findViewerEntry(leaderboard, viewerUser);

  const toRow = (
    entry: LeaderboardEntry,
    gapBefore = false
  ): LeaderboardRow => ({
    entry,
    isViewer: entry.user.id === viewerUser?.id,
    gapBefore,
    progress: getProgress(entry.value, topValue),
  });

  const rows = leaderboard.entries.slice(0, size).map((entry) => toRow(entry));
  if (!viewerEntry || rows.some((row) => row.isViewer)) return rows;

  const lastRank = rows.at(-1)?.entry.rank ?? 0;
  rows.push(toRow(viewerEntry, viewerEntry.rank > lastRank + 1));

  return rows;
};

export const getLeaderboardNudge = (
  leaderboard: Pick<Leaderboard, "entries" | "viewer">,
  viewerUser: LeaderboardUser | null,
  scope: LeaderboardScope = "global"
): LeaderboardNudge | null => {
  const viewerEntry = findViewerEntry(leaderboard, viewerUser);
  if (!viewerEntry) return null;
  if (viewerEntry.rank === 1) return { type: "leading" };

  const ahead = leaderboard.entries.filter(
    (entry) =>
      entry.rank < viewerEntry.rank && entry.user.id !== viewerEntry.user.id
  );
  if (ahead.length === 0 || ahead.length < viewerEntry.rank - 1) {
    const toTop = scope === "global" ? leaderboard.viewer?.toTop : null;
    if (!toTop || toTop.rank >= viewerEntry.rank) return null;
    const gap = toTop.value - viewerEntry.value;
    return gap > 0 ? { type: "to_top", gap, rank: toTop.rank } : null;
  }

  const above = ahead[ahead.length - 1];

  const gap = above.value - viewerEntry.value;
  if (gap <= 0) return null;

  return { type: "behind", gap, target: above.user, targetRank: above.rank };
};

export const getLeaderboardState = ({
  isEligible,
  hasError,
  leaderboard,
  period,
  scope,
  viewerId,
}: {
  isEligible: boolean;
  hasError: boolean;
  leaderboard: Pick<Leaderboard, "entries"> | null;
  period: LeaderboardPeriod;
  scope: LeaderboardScope;
  viewerId: string | null;
}): LeaderboardState => {
  if (!isEligible) return "hidden";
  if (hasError) return "error";
  if (!leaderboard) return "loading";

  const others = leaderboard.entries.filter(
    (entry) => entry.user.id !== viewerId
  );

  if (scope === "friends" && others.length === 0) return "empty_friends";
  if (leaderboard.entries.length > 0) {
    return viewerId && others.length === 0 ? "solo" : "ready";
  }

  return period === "week" ? "empty_week" : "empty_all";
};

export const buildLeaderboardRequest = (
  query: LeaderboardQuery
): { path: string; options: LeaderboardRequestOptions } => {
  return {
    path: `/games/${query.shop}/${encodeURIComponent(query.objectId)}/leaderboards/${encodeURIComponent(query.metric)}`,
    options: {
      params: {
        take: LEADERBOARD_TAKE,
        range: query.period,
        scope: query.scope,
      },
      needsAuth: query.isLoggedIn,
    },
  };
};

const SIGNED_OUT_ERROR_NAME = "UserNotLoggedInError";
const SIGNED_OUT_ERROR_MESSAGE = "user not logged in";

export const isSignedOutError = (error: unknown) =>
  error instanceof Error &&
  (error.name === SIGNED_OUT_ERROR_NAME ||
    error.message.includes(SIGNED_OUT_ERROR_MESSAGE));

export const fetchGameLeaderboard = async (
  get: LeaderboardGet,
  query: LeaderboardQuery
): Promise<Leaderboard> => {
  if (!isLeaderboardShop(query.shop) || !query.objectId) {
    return { entries: [], viewer: null };
  }

  const { path, options } = buildLeaderboardRequest(query);
  const response = await get(path, options).catch((error: unknown) => {
    if (!options.needsAuth || !isSignedOutError(error)) throw error;
    return get(path, { ...options, needsAuth: false });
  });

  return normalizeLeaderboardResponse(response);
};

export const getDurationParts = (
  seconds: number,
  maxMinutes: number
): { unit: "minutes" | "hours"; amount: number } => {
  const minutes = seconds / 60;

  if (minutes < maxMinutes) {
    return {
      unit: "minutes",
      amount: seconds > 0 ? Math.max(1, Math.round(minutes)) : 0,
    };
  }

  const hours = minutes / 60;

  return {
    unit: "hours",
    amount:
      hours < FRACTIONAL_HOURS_LIMIT
        ? Math.round(hours * 10) / 10
        : Math.round(hours),
  };
};

const durationFormatters = new Map<string, Intl.NumberFormat>();

const getDurationFormatter = (language: string) => {
  let formatter = durationFormatters.get(language);
  if (!formatter) {
    formatter = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
    durationFormatters.set(language, formatter);
  }

  return formatter;
};

export const formatDurationParts = (
  seconds: number,
  maxMinutes: number,
  language: string
): { unit: "minutes" | "hours"; amount: string } => {
  const { unit, amount } = getDurationParts(seconds, maxMinutes);
  return { unit, amount: getDurationFormatter(language).format(amount) };
};

export const buildGameLeaderboardPath = (
  shop: GameShop,
  objectId: string,
  {
    period,
    scope,
    metric,
  }: {
    period: LeaderboardPeriod;
    scope: LeaderboardScope;
    metric: LeaderboardMetric;
  }
) => {
  const params = new URLSearchParams({
    tab: "games",
    shop,
    objectId,
    period,
    scope,
    metric,
  });
  return `/leaderboards?${params.toString()}`;
};
