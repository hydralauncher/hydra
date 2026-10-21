import type { GameShop } from "@types";

export const LEADERBOARD_TAKE = 100;
export const LEADERBOARD_CARD_SIZE = 5;
export const LEADERBOARD_CACHE_TTL_MS = 60_000;
export const LEADERBOARD_MIN_PROGRESS = 4;

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

export interface LeaderboardViewer {
  rank: number;
  value: number;
}

export interface Leaderboard {
  entries: LeaderboardEntry[];
  viewer: LeaderboardViewer | null;
  periodEnd: string | null;
}

export interface LeaderboardQuery {
  shop: GameShop;
  objectId: string;
  period: LeaderboardPeriod;
  scope: LeaderboardScope;
  metric: LeaderboardMetric;
  isExtended: boolean;
  isLoggedIn: boolean;
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
  | { type: "behind"; gap: number; target: LeaderboardUser };

export type LeaderboardState =
  | "hidden"
  | "loading"
  | "error"
  | "ready"
  | "empty_week"
  | "empty_all"
  | "empty_friends";

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

const readValue = (candidate: Record<string, unknown>) => {
  if (isNonNegativeNumber(candidate.value)) return candidate.value;
  if (isNonNegativeNumber(candidate.playTimeInSeconds))
    return candidate.playTimeInSeconds;

  return null;
};

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

  return { rank: candidate.rank, value: viewerValue };
};

export const normalizeLeaderboardResponse = (
  response: unknown
): Leaderboard => {
  if (!response || typeof response !== "object") {
    throw new TypeError("Invalid leaderboard response");
  }

  const candidate = response as Record<string, unknown>;
  if (!Array.isArray(candidate.users)) {
    throw new TypeError("Invalid leaderboard response");
  }

  const seen = new Set<string>();
  const entries = candidate.users
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
    periodEnd:
      typeof candidate.periodEnd === "string" ? candidate.periodEnd : null,
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

  const toRow = (entry: LeaderboardEntry, gapBefore = false) => ({
    entry,
    isViewer: entry.user.id === viewerUser?.id,
    gapBefore,
    progress: getProgress(entry.value, topValue),
  });

  const rows = leaderboard.entries.slice(0, size).map((entry) => toRow(entry));

  if (viewerEntry && !rows.some((row) => row.isViewer)) {
    const lastRank = rows.at(-1)?.entry.rank ?? 0;
    rows.push(toRow(viewerEntry, viewerEntry.rank > lastRank + 1));
  }

  return rows;
};

export const getLeaderboardNudge = (
  leaderboard: Pick<Leaderboard, "entries" | "viewer">,
  viewerUser: LeaderboardUser | null
): LeaderboardNudge | null => {
  const viewerEntry = findViewerEntry(leaderboard, viewerUser);
  if (!viewerEntry) return null;
  if (viewerEntry.rank === 1) return { type: "leading" };

  const above = leaderboard.entries.find(
    (entry) => entry.rank === viewerEntry.rank - 1
  );
  if (!above) return null;

  const gap = above.value - viewerEntry.value;
  if (gap <= 0) return null;

  return { type: "behind", gap, target: above.user };
};

export const getLeaderboardState = ({
  isEligible,
  isLoading,
  hasError,
  leaderboard,
  period,
  scope,
  viewerId,
}: {
  isEligible: boolean;
  isLoading: boolean;
  hasError: boolean;
  leaderboard: Pick<Leaderboard, "entries"> | null;
  period: LeaderboardPeriod;
  scope: LeaderboardScope;
  viewerId: string | null;
}): LeaderboardState => {
  if (!isEligible) return "hidden";
  if (isLoading && !leaderboard) return "loading";
  if (hasError || !leaderboard) return "error";

  const others = leaderboard.entries.filter(
    (entry) => entry.user.id !== viewerId
  );

  if (scope === "friends" && others.length === 0) return "empty_friends";
  if (leaderboard.entries.length > 0) return "ready";

  return period === "week" ? "empty_week" : "empty_all";
};

export const buildLeaderboardRequest = (
  query: LeaderboardQuery
): { path: string; options: LeaderboardRequestOptions } => {
  const params: Record<string, string | number> = {
    take: LEADERBOARD_TAKE,
    range: query.period,
  };

  if (query.isExtended) {
    params.metric = query.metric;
    params.scope = query.scope;
  }

  return {
    path: `/games/${query.shop}/${encodeURIComponent(query.objectId)}/top-users`,
    options: { params, needsAuth: query.isLoggedIn },
  };
};

export const getLeaderboardCacheKey = (query: LeaderboardQuery) => {
  const { path, options } = buildLeaderboardRequest(query);
  const params = Object.entries(options.params)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("&");

  return `${path}?${params}|auth=${options.needsAuth}`;
};

export const createLeaderboardFetcher = (
  get: LeaderboardGet,
  now: () => number = Date.now,
  ttl = LEADERBOARD_CACHE_TTL_MS
) => {
  const cache = new Map<string, { at: number; leaderboard: Leaderboard }>();
  const inFlight = new Map<string, Promise<Leaderboard>>();

  return (query: LeaderboardQuery): Promise<Leaderboard> => {
    if (!isLeaderboardShop(query.shop) || !query.objectId) {
      return Promise.resolve({ entries: [], viewer: null, periodEnd: null });
    }

    const key = getLeaderboardCacheKey(query);
    const cached = cache.get(key);
    if (cached && now() - cached.at < ttl) {
      return Promise.resolve(cached.leaderboard);
    }

    const pending = inFlight.get(key);
    if (pending) return pending;

    const { path, options } = buildLeaderboardRequest(query);
    const request = get(path, options)
      .then((response) => {
        const leaderboard = normalizeLeaderboardResponse(response);
        cache.set(key, { at: now(), leaderboard });
        return leaderboard;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, request);
    return request;
  };
};

export const filterLeaderboardEntries = (
  entries: LeaderboardEntry[],
  search: string
) => {
  const term = search.trim().toLocaleLowerCase();
  if (!term) return entries;

  return entries.filter((entry) =>
    entry.user.displayName.toLocaleLowerCase().includes(term)
  );
};
