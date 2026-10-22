import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGlobalLeaderboardRequest,
  buildHeatmap,
  createResponseCache,
  getAvailableMetrics,
  getRequestKey,
  getBadgeProgress,
  getBoardState,
  getCountdownParts,
  getIsoWeekNumber,
  getPlayLevel,
  getRankDelta,
  getUtcWeekRange,
  getViewerRanking,
  normalizeBadges,
  normalizeFriendStreaks,
  normalizeGlobalLeaderboardResponse,
  normalizeMyGames,
  normalizePlayActivity,
  resolveWeekRange,
  type GlobalLeaderboardQuery,
} from "./global-leaderboard.js";
import type { LeaderboardGet } from "../game-details/leaderboard/game-leaderboard.js";

const rawUser = (id: string) => ({
  id,
  displayName: id.toUpperCase(),
  profileImageUrl: `https://cdn/${id}.png`,
  backgroundImageUrl: null,
});

const rawEntry = (rank: number, id: string, extra: object = {}) => ({
  rank,
  value: 1000 - rank,
  user: rawUser(id),
  ...extra,
});

const query: GlobalLeaderboardQuery = {
  metric: "playtime",
  period: "week",
  scope: "friends",
  isLoggedIn: true,
};

describe("buildGlobalLeaderboardRequest", () => {
  it("builds the metric path with window, scope and take", () => {
    assert.deepEqual(buildGlobalLeaderboardRequest(query), {
      path: "/leaderboards/playtime",
      options: {
        params: { window: "week", scope: "friends", take: 100 },
        needsAuth: true,
      },
    });
  });

  it("forces the global scope without auth when logged out", () => {
    const { options } = buildGlobalLeaderboardRequest({
      ...query,
      period: "all",
      isLoggedIn: false,
    });

    assert.deepEqual(options, {
      params: { window: "all", scope: "global", take: 100 },
      needsAuth: false,
    });
  });
});

describe("normalizeGlobalLeaderboardResponse", () => {
  it("reads entries, period, total and per entry extras", () => {
    const board = normalizeGlobalLeaderboardResponse({
      entries: [
        rawEntry(1, "a", { previousRank: 3, streakActive: true }),
        rawEntry(2, "b", {
          review: {
            gameTitle: "Brawlhalla",
            shop: "steam",
            objectId: "291550",
            score: 4,
            text: "Great",
          },
        }),
      ],
      viewer: { rank: 40, value: 12, previousRank: 44 },
      weekStart: "2026-10-19T00:00:00.000Z",
      weekEnd: "2026-10-26T00:00:00.000Z",
      total: 12480,
    });

    assert.equal(board.entries.length, 2);
    assert.equal(board.periodStart, "2026-10-19T00:00:00.000Z");
    assert.equal(board.periodEnd, "2026-10-26T00:00:00.000Z");
    assert.equal(board.total, 12480);
    assert.equal(board.viewerPreviousRank, 44);
    assert.deepEqual(board.extras.a, {
      previousRank: 3,
      streakActive: true,
      review: null,
    });
    assert.equal(board.extras.b.review?.gameTitle, "Brawlhalla");
    assert.equal(board.extras.b.review?.coverImageUrl, null);
    assert.equal(board.extras.b.previousRank, null);
  });

  it("accepts the legacy users shape and ignores invalid extras", () => {
    const board = normalizeGlobalLeaderboardResponse({
      users: [rawEntry(1, "a", { previousRank: 0, streakActive: "yes" }), 5],
      periodEnd: "2026-10-26T00:00:00.000Z",
      total: -1,
    });

    assert.equal(board.entries[0].user.id, "a");
    assert.equal(board.total, null);
    assert.equal(board.viewerPreviousRank, null);
    assert.deepEqual(board.extras.a, {
      previousRank: null,
      streakActive: null,
      review: null,
    });
  });

  it("throws on a non object response", () => {
    assert.throws(() => normalizeGlobalLeaderboardResponse(null), TypeError);
    assert.throws(() => normalizeGlobalLeaderboardResponse([]), TypeError);
  });
});

describe("createResponseCache", () => {
  const response = { entries: [rawEntry(1, "a")] };
  const { path, options } = buildGlobalLeaderboardRequest(query);

  it("builds a stable key regardless of param order", () => {
    assert.equal(
      getRequestKey("/x", { params: { b: 2, a: 1 }, needsAuth: true }),
      getRequestKey("/x", { params: { a: 1, b: 2 }, needsAuth: true })
    );
    assert.notEqual(
      getRequestKey("/x", { params: { a: 1 }, needsAuth: true }),
      getRequestKey("/x", { params: { a: 1 }, needsAuth: false })
    );
  });

  it("caches by request, dedupes in flight requests and expires", async () => {
    let calls = 0;
    let clock = 0;
    const get: LeaderboardGet = async () => {
      calls += 1;
      return response;
    };
    const cache = createResponseCache(get, () => clock, 1000);

    assert.equal(cache.peek(path, options), undefined);
    await Promise.all([cache.get(path, options), cache.get(path, options)]);
    assert.equal(calls, 1);
    assert.deepEqual(cache.peek(path, options), response);

    await cache.get(path, options);
    assert.equal(calls, 1);

    const games = buildGlobalLeaderboardRequest({ ...query, metric: "games" });
    await cache.get(games.path, games.options);
    assert.equal(calls, 2);

    clock = 1001;
    assert.equal(cache.peek(path, options), undefined);
    await cache.get(path, options);
    assert.equal(calls, 3);
  });

  it("does not cache failures and can be cleared", async () => {
    let calls = 0;
    const get: LeaderboardGet = async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return response;
    };
    const cache = createResponseCache(get);

    await assert.rejects(cache.get(path, options));
    await cache.get(path, options);
    assert.equal(calls, 2);

    cache.clear();
    assert.equal(cache.peek(path, options), undefined);
    await cache.get(path, options);
    assert.equal(calls, 3);
  });
});

describe("createResponseCache isolation", () => {
  const { path, options } = buildGlobalLeaderboardRequest(query);

  it("keeps each account's responses apart", async () => {
    let calls = 0;
    const get: LeaderboardGet = async () => {
      calls += 1;
      return { entries: [rawEntry(1, `user-${calls}`)] };
    };
    const cache = createResponseCache(get);

    await cache.get(path, options, "account-a");
    assert.equal(cache.peek(path, options, "account-b"), undefined);
    await cache.get(path, options, "account-b");
    assert.equal(calls, 2);
    assert.notEqual(
      getRequestKey(path, options, "account-a"),
      getRequestKey(path, options, "account-b")
    );
  });

  it("ignores responses from before a clear", async () => {
    let resolveOld: (value: unknown) => void = () => undefined;
    let calls = 0;
    const get: LeaderboardGet = () => {
      calls += 1;
      if (calls === 1) {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve("fresh");
    };
    const cache = createResponseCache(get);

    const old = cache.get(path, options);
    cache.clear();
    assert.equal(await cache.get(path, options), "fresh");

    resolveOld("stale");
    await old;
    assert.equal(cache.peek(path, options), "fresh");
  });
});

describe("getAvailableMetrics", () => {
  const ok = { leaderboard: {}, hasError: false };
  const loading = { leaderboard: null, hasError: false };
  const failed = { leaderboard: null, hasError: true };
  const all = {
    playtime: ok,
    games: ok,
    friends: loading,
    achievements: ok,
    souvenirs: ok,
    streak: failed,
    reviews: failed,
  };

  it("hides metrics whose board failed", () => {
    assert.deepEqual(getAvailableMetrics(all), [
      "playtime",
      "games",
      "friends",
      "achievements",
      "souvenirs",
    ]);
  });

  it("keeps every metric when all of them failed", () => {
    const allFailed = {
      playtime: failed,
      games: failed,
      friends: failed,
      achievements: failed,
      souvenirs: failed,
      streak: failed,
      reviews: failed,
    };

    assert.equal(getAvailableMetrics(allFailed).length, 7);
  });
});

describe("getBoardState", () => {
  const board = normalizeGlobalLeaderboardResponse({
    entries: [rawEntry(1, "me"), rawEntry(2, "b")],
  });
  const onlyViewer = normalizeGlobalLeaderboardResponse({
    entries: [rawEntry(1, "me")],
  });
  const empty = normalizeGlobalLeaderboardResponse({ entries: [] });
  const base = {
    isLoading: false,
    hasError: false,
    scope: "global" as const,
    viewerId: "me",
  };

  it("covers every state", () => {
    assert.equal(
      getBoardState({ ...base, isLoading: true, leaderboard: null }),
      "loading"
    );
    assert.equal(getBoardState({ ...base, leaderboard: null }), "error");
    assert.equal(
      getBoardState({ ...base, hasError: true, leaderboard: board }),
      "error"
    );
    assert.equal(getBoardState({ ...base, leaderboard: empty }), "empty");
    assert.equal(getBoardState({ ...base, leaderboard: board }), "ready");
    assert.equal(
      getBoardState({ ...base, scope: "friends", leaderboard: onlyViewer }),
      "empty_friends"
    );
    assert.equal(
      getBoardState({ ...base, isLoading: true, leaderboard: board }),
      "ready"
    );
  });
});

describe("rank deltas and viewer ranking", () => {
  it("computes the delta from the previous rank", () => {
    assert.equal(getRankDelta(3, 5), 2);
    assert.equal(getRankDelta(5, 3), -2);
    assert.equal(getRankDelta(4, null), 0);
  });

  it("reads the viewer from the list or from the viewer field", () => {
    const listed = normalizeGlobalLeaderboardResponse({
      entries: [rawEntry(1, "a"), rawEntry(2, "me", { previousRank: 4 })],
    });
    assert.deepEqual(getViewerRanking(listed, "me"), {
      rank: 2,
      value: 998,
      delta: 2,
    });

    const outside = normalizeGlobalLeaderboardResponse({
      entries: [rawEntry(1, "a")],
      viewer: { rank: 50, value: 3, previousRank: 45 },
    });
    assert.deepEqual(getViewerRanking(outside, "me"), {
      rank: 50,
      value: 3,
      delta: -5,
    });

    const missing = normalizeGlobalLeaderboardResponse({
      entries: [rawEntry(1, "a")],
    });
    assert.equal(getViewerRanking(missing, "me"), null);
    assert.equal(getViewerRanking(null, "me"), null);
    assert.equal(getViewerRanking(listed, null), null);
  });
});

describe("week helpers", () => {
  it("starts the week on Monday 00:00 UTC", () => {
    const sunday = Date.UTC(2026, 9, 25, 23, 59);
    const monday = Date.UTC(2026, 9, 26, 0, 0);

    assert.equal(
      getUtcWeekRange(sunday).start.toISOString(),
      "2026-10-19T00:00:00.000Z"
    );
    assert.equal(
      getUtcWeekRange(monday).start.toISOString(),
      "2026-10-26T00:00:00.000Z"
    );
    assert.equal(
      getUtcWeekRange(monday).end.toISOString(),
      "2026-11-02T00:00:00.000Z"
    );
  });

  it("prefers the period from the response and falls back to the clock", () => {
    const now = Date.UTC(2026, 9, 21);
    const fromResponse = resolveWeekRange(
      {
        periodStart: "2026-10-12T00:00:00.000Z",
        periodEnd: "2026-10-19T00:00:00.000Z",
      },
      now
    );
    assert.equal(fromResponse.end.toISOString(), "2026-10-19T00:00:00.000Z");

    const fallback = resolveWeekRange(
      { periodStart: "nope", periodEnd: null },
      now
    );
    assert.equal(fallback.start.toISOString(), "2026-10-19T00:00:00.000Z");
    assert.equal(
      resolveWeekRange(null, now).end.toISOString(),
      "2026-10-26T00:00:00.000Z"
    );
  });

  it("returns the ISO week number", () => {
    assert.equal(getIsoWeekNumber(new Date(Date.UTC(2026, 9, 21))), 43);
    assert.equal(getIsoWeekNumber(new Date(Date.UTC(2026, 0, 1))), 1);
    assert.equal(getIsoWeekNumber(new Date(Date.UTC(2021, 0, 3))), 53);
    assert.equal(getIsoWeekNumber(new Date(Date.UTC(2020, 11, 31))), 53);
  });

  it("splits the countdown and never goes negative", () => {
    const end = new Date(Date.UTC(2026, 9, 26));
    const now = end.getTime() - ((3 * 24 + 14) * 60 + 5) * 60_000;

    assert.deepEqual(getCountdownParts(end, now), {
      days: 3,
      hours: 14,
      minutes: 5,
    });
    assert.deepEqual(getCountdownParts(end, end.getTime() + 1), {
      days: 0,
      hours: 0,
      minutes: 0,
    });
  });
});

describe("play activity", () => {
  it("maps seconds to heat levels", () => {
    assert.equal(getPlayLevel(0), 0);
    assert.equal(getPlayLevel(1800), 1);
    assert.equal(getPlayLevel(7200), 2);
    assert.equal(getPlayLevel(4 * 3600), 3);
  });

  it("builds 15 weeks of cells ending in the current week", () => {
    const now = Date.UTC(2026, 9, 21, 12);
    const cells = buildHeatmap(
      [{ date: "2026-10-21", seconds: 5000, games: ["Brawlhalla"] }],
      now
    );

    assert.equal(cells.length, 105);
    assert.equal(cells[0].date.toISOString(), "2026-07-13T00:00:00.000Z");

    const today = cells.find((cell) => cell.isToday);
    assert.equal(today?.level, 2);
    assert.deepEqual(today?.games, ["Brawlhalla"]);
    assert.equal(cells.filter((cell) => cell.isFuture).length, 4);
  });

  it("normalizes the activity response", () => {
    const activity = normalizePlayActivity({
      currentStreak: 5,
      bestStreak: 12,
      playedToday: true,
      days: [{ date: "2026-10-21", seconds: 60, games: ["A", 3] }, null],
    });

    assert.equal(activity.currentStreak, 5);
    assert.deepEqual(activity.days, [
      { date: "2026-10-21", seconds: 60, games: ["A"] },
    ]);
    assert.throws(() => normalizePlayActivity({}), TypeError);
  });
});

describe("profile normalizers", () => {
  it("normalizes my games and drops invalid items", () => {
    const games = normalizeMyGames({
      games: [
        {
          shop: "steam",
          objectId: "291550",
          title: "Brawlhalla",
          rank: 6,
          previousRank: 8,
          total: 12480,
          leader: rawUser("a"),
        },
        { shop: "steam", objectId: "1", rank: 0 },
        "bad",
      ],
    });

    assert.equal(games.length, 1);
    assert.equal(games[0].leader?.id, "a");
    assert.equal(games[0].coverImageUrl, null);
    assert.throws(() => normalizeMyGames({}), TypeError);
  });

  it("sorts friend streaks by active first, then by days", () => {
    const friends = normalizeFriendStreaks({
      friends: [
        { user: rawUser("ended"), days: 15, active: false },
        { user: rawUser("short"), days: 2, active: true },
        { user: rawUser("long"), days: 9, active: true, online: true },
        { user: null },
      ],
    });

    assert.deepEqual(
      friends.map((item) => item.user.id),
      ["long", "short", "ended"]
    );
    assert.equal(friends[0].online, true);
    assert.throws(() => normalizeFriendStreaks(null), TypeError);
  });

  it("normalizes badges, counts and progress", () => {
    const badges = normalizeBadges({
      badges: [
        {
          id: "a",
          kind: "top_percent",
          tier: "gold",
          value: 1,
          earnedAt: "2026-09-03T00:00:00.000Z",
        },
        {
          id: "b",
          kind: "weekly_leader",
          tier: "unknown",
          scope: "friends",
          value: 1,
          progress: { current: 11, target: 20 },
        },
        { id: "c", kind: "nope" },
      ],
    });

    assert.equal(badges.badges.length, 2);
    assert.equal(badges.earned, 1);
    assert.equal(badges.total, 2);
    assert.equal(badges.badges[1].tier, "gold");
    assert.equal(badges.badges[1].scope, "friends");
    assert.equal(getBadgeProgress(badges.badges[1]), 55);
    assert.equal(getBadgeProgress(badges.badges[0]), 0);
    assert.throws(() => normalizeBadges({}), TypeError);
  });
});
