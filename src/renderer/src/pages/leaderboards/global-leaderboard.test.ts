import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGlobalLeaderboardRequest,
  buildHeatmap,
  buildHeatmapMonths,
  buildMetricsRequest,
  hasReviewData,
  hasStreakData,
  normalizeMetricDefinitions,
  getBadgeProgress,
  getBoardState,
  getCountdownParts,
  getPlayLevel,
  getRankDelta,
  getRowsBelowPodium,
  getUtcWeekRange,
  getViewerRanking,
  normalizeBadges,
  normalizeFriendStreaks,
  normalizeGlobalLeaderboardResponse,
  formatBoardTotal,
  normalizeMyGames,
  normalizePlayActivity,
  resolveWeekRange,
  getBoardInsight,
  getHeatmapLayout,
  getHeatmapTotalDisplay,
  sumHeatmap,
  type GlobalLeaderboardQuery,
} from "./global-leaderboard.js";

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
    assert.deepEqual(board.extras.b.review?.translations, {});
    assert.equal(board.extras.b.review?.detectedLanguage, null);
    assert.equal(board.extras.b.previousRank, null);
  });

  it("keeps the review translations and detected language", () => {
    const board = normalizeGlobalLeaderboardResponse({
      entries: [
        rawEntry(1, "a", {
          review: {
            text: "Great",
            score: 5,
            detectedLanguage: "en",
            translations: { pt: "Ótimo", es: "", fr: 3 },
          },
        }),
      ],
    });

    assert.deepEqual(board.extras.a.review?.translations, { pt: "Ótimo" });
    assert.equal(board.extras.a.review?.detectedLanguage, "en");
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

describe("metric definitions", () => {
  it("builds the metrics request per scope without auth", () => {
    assert.deepEqual(buildMetricsRequest("game"), {
      path: "/leaderboards/metrics",
      options: { params: { scope: "game" }, needsAuth: false },
    });
  });

  it("normalizes definitions, keeping order and dropping invalid items", () => {
    const metrics = normalizeMetricDefinitions({
      metrics: [
        { id: "playtime", valueType: "duration", label: "Playtime" },
        { id: "sessions", valueType: "weird" },
        { id: "review_upvotes", valueType: "count" },
        { id: "playtime", valueType: "count" },
        { id: "" },
        "bad",
      ],
    });

    assert.deepEqual(metrics, [
      { id: "playtime", valueType: "duration", label: "Playtime" },
      { id: "sessions", valueType: "count", label: "sessions" },
    ]);
    assert.throws(() => normalizeMetricDefinitions({}), TypeError);
  });
});

describe("board data detection", () => {
  it("detects streak and review data from the entries", () => {
    const streak = normalizeGlobalLeaderboardResponse({
      entries: [rawEntry(1, "a", { streakActive: false })],
    });
    const review = normalizeGlobalLeaderboardResponse({
      entries: [rawEntry(1, "a", { review: { text: "Nice", score: 5 } })],
    });
    const plain = normalizeGlobalLeaderboardResponse({
      entries: [rawEntry(1, "a")],
    });

    assert.equal(hasStreakData(streak), true);
    assert.equal(hasReviewData(streak), false);
    assert.equal(hasReviewData(review), true);
    assert.equal(hasStreakData(plain), false);
    assert.equal(hasStreakData(null), false);
  });
});

describe("getRowsBelowPodium", () => {
  it("splits by position so tied ranks are never dropped", () => {
    const board = normalizeGlobalLeaderboardResponse({
      entries: [
        rawEntry(1, "a"),
        rawEntry(2, "b"),
        rawEntry(3, "c"),
        rawEntry(3, "d"),
        rawEntry(5, "e"),
      ],
    });
    const ids = board.entries.map((entry) => entry.user.id);

    assert.deepEqual(getRowsBelowPodium(ids, ids.length), ["d", "e"]);
  });

  it("keeps a pinned row after a short list", () => {
    assert.deepEqual(getRowsBelowPodium(["a", "b", "viewer"], 2), ["viewer"]);
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
    assert.equal(getRankDelta(4, null), null);
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

describe("getBoardInsight", () => {
  const viewerUser = (id: string) => ({
    id,
    displayName: id,
    profileImageUrl: null,
    backgroundImageUrl: null,
  });
  const entry = (rank: number, id: string, value: number) => ({
    rank,
    value,
    user: viewerUser(id),
  });
  const board = (
    entries: ReturnType<typeof entry>[],
    viewer: { rank: number; value: number } | null = null
  ) => ({
    entries,
    viewer,
    periodStart: null,
    periodEnd: null,
    total: null,
    viewerPreviousRank: null,
    extras: {},
  });
  const top = [
    entry(1, "a", 100),
    entry(2, "b", 80),
    entry(3, "c", 60),
    entry(4, "d", 40),
    entry(5, "me", 30),
  ];

  it("names the next player and the podium from below it", () => {
    assert.deepEqual(getBoardInsight(board(top), "me"), {
      type: "behind",
      gap: 10,
      target: viewerUser("d"),
      targetRank: 4,
      next: { goal: "podium", gap: 30 },
    });
  });

  it("points to the lead from just below the top", () => {
    const insight = getBoardInsight(board(top), "c");

    assert.equal(insight?.type, "behind");
    assert.deepEqual(insight?.type === "behind" && insight.next, {
      goal: "lead",
      gap: 40,
    });
  });

  it("has no extra goal in second place", () => {
    const insight = getBoardInsight(board(top), "b");

    assert.equal(insight?.type === "behind" && insight.next, null);
  });

  it("shows the lead over the second place", () => {
    assert.deepEqual(getBoardInsight(board(top), "a"), {
      type: "leading",
      gap: 20,
      target: viewerUser("b"),
    });
  });

  it("handles a leader alone on the board", () => {
    assert.deepEqual(getBoardInsight(board([entry(1, "me", 5)]), "me"), {
      type: "leading",
      gap: 0,
      target: null,
    });
  });

  it("aims at the end of the list from outside it", () => {
    assert.deepEqual(
      getBoardInsight(board(top, { rank: 250, value: 3 }), "me2"),
      { type: "outside", gap: 27, lastRank: 5 }
    );
  });

  it("invites a viewer without a position", () => {
    assert.deepEqual(getBoardInsight(board(top), "ghost"), {
      type: "unranked",
    });
  });

  it("stays quiet when signed out", () => {
    assert.equal(getBoardInsight(board(top), null), null);
  });

  it("only states the rank when the difference is not positive", () => {
    assert.deepEqual(
      getBoardInsight(
        board([entry(1, "a", 100), entry(2, "b", 50), entry(3, "me", 60)]),
        "me"
      ),
      { type: "ranked", rank: 3 }
    );
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

  it("builds 53 weeks of cells ending in the current week", () => {
    const now = Date.UTC(2026, 9, 21, 12);
    const cells = buildHeatmap(
      [{ date: "2026-10-21", seconds: 5000, games: ["Brawlhalla"] }],
      now
    );

    assert.equal(cells.length, 371);
    assert.equal(cells[0].date.toISOString(), "2025-10-20T00:00:00.000Z");
    assert.equal(cells.at(-7)?.date.toISOString(), "2026-10-19T00:00:00.000Z");

    const today = cells.find((cell) => cell.isToday);
    assert.equal(today?.level, 2);
    assert.deepEqual(today?.games, ["Brawlhalla"]);
    assert.equal(cells.filter((cell) => cell.isFuture).length, 4);
  });

  it("labels each month on the first week that starts in it", () => {
    const labels = (now: number) =>
      buildHeatmapMonths(buildHeatmap([], now)).map(
        ({ week, date }) => `${week}:${date.toISOString().slice(0, 10)}`
      );

    // The first column (Oct 20) is two weeks from November, so it is dropped.
    assert.deepEqual(labels(Date.UTC(2026, 9, 21, 12)), [
      "2:2025-11-03",
      "6:2025-12-01",
      "11:2026-01-05",
      "15:2026-02-02",
      "19:2026-03-02",
      "24:2026-04-06",
      "28:2026-05-04",
      "32:2026-06-01",
      "37:2026-07-06",
      "41:2026-08-03",
      "46:2026-09-07",
      "50:2026-10-05",
    ]);

    // The first column keeps its label when the next month is far enough,
    // and a month starting in the last column has no room for its label.
    const december = labels(Date.UTC(2026, 10, 30, 12));
    assert.equal(december[0], "0:2025-12-01");
    assert.equal(december.at(-1), "48:2026-11-02");
  });

  it("sums the seconds and played days of the heatmap", () => {
    const cells = buildHeatmap(
      [
        { date: "2026-10-19", seconds: 3600, games: [] },
        { date: "2026-10-21", seconds: 1800, games: [] },
        { date: "2026-01-02", seconds: 0, games: [] },
        { date: "2024-01-01", seconds: 9999, games: [] },
      ],
      Date.UTC(2026, 9, 21, 12)
    );

    assert.deepEqual(sumHeatmap(cells), { seconds: 5400, days: 2 });
    assert.deepEqual(sumHeatmap([]), { seconds: 0, days: 0 });
  });

  it("fits the heatmap to the card without overflowing", () => {
    assert.deepEqual(getHeatmapLayout(1000, 53), {
      weeks: 53,
      cellSize: 12,
      width: 984,
    });
    assert.deepEqual(getHeatmapLayout(360, 53), {
      weeks: 18,
      cellSize: 12,
      width: 354,
    });
    assert.equal(getHeatmapLayout(4000, 53).cellSize, 32);
  });

  it("shows the heatmap total as nothing, minutes or hours", () => {
    assert.deepEqual(getHeatmapTotalDisplay({ seconds: 0, days: 0 }), {
      unit: "none",
    });
    assert.deepEqual(getHeatmapTotalDisplay({ seconds: 20, days: 1 }), {
      unit: "minutes",
      amount: 1,
    });
    assert.deepEqual(getHeatmapTotalDisplay({ seconds: 300, days: 1 }), {
      unit: "minutes",
      amount: 5,
    });
    assert.deepEqual(getHeatmapTotalDisplay({ seconds: 3580, days: 1 }), {
      unit: "hours",
      amount: 1,
    });
    assert.deepEqual(getHeatmapTotalDisplay({ seconds: 460800, days: 74 }), {
      unit: "hours",
      amount: 128,
    });
  });

  it("flags today and yesterday by UTC day", () => {
    const flagged = (now: number) => {
      const cells = buildHeatmap([], now);
      return {
        today: cells.find((cell) => cell.isToday)?.date.toISOString(),
        yesterday: cells.find((cell) => cell.isYesterday)?.date.toISOString(),
      };
    };

    assert.deepEqual(flagged(Date.UTC(2026, 9, 21, 12)), {
      today: "2026-10-21T00:00:00.000Z",
      yesterday: "2026-10-20T00:00:00.000Z",
    });
    // 22:00 on Oct 26 in UTC-3 is already Oct 27 in UTC.
    assert.deepEqual(flagged(Date.parse("2026-10-27T01:00:00Z")), {
      today: "2026-10-27T00:00:00.000Z",
      yesterday: "2026-10-26T00:00:00.000Z",
    });
  });

  it("normalizes the activity response", () => {
    const activity = normalizePlayActivity({
      currentStreak: 5,
      bestStreak: 12,
      playedToday: true,
      days: [{ date: "2026-10-21", seconds: 60, games: ["A", 3] }, null],
    });

    assert.equal(activity.currentStreak, 5);
    assert.equal(activity.weeks, 53);
    assert.deepEqual(activity.days, [
      { date: "2026-10-21", seconds: 60, games: ["A"] },
    ]);
    assert.throws(() => normalizePlayActivity({}), TypeError);
  });

  it("sizes the heatmap from the weeks the API answered for", () => {
    const now = Date.UTC(2026, 9, 21, 12);
    const activity = normalizePlayActivity(
      { days: [{ date: "2026-10-20", seconds: 7200, games: [] }] },
      26
    );
    const cells = buildHeatmap(activity.days, now, activity.weeks);

    assert.equal(activity.weeks, 26);
    assert.equal(cells.length, 182);
    assert.equal(cells[0].date.toISOString(), "2026-04-27T00:00:00.000Z");
    assert.deepEqual(sumHeatmap(cells), { seconds: 7200, days: 1 });
    assert.deepEqual(
      buildHeatmapMonths(cells).map(({ week }) => week),
      [1, 5, 10, 14, 19, 23]
    );
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
        { shop: "steam", objectId: "2", rank: 36, total: null },
        { shop: "steam", objectId: "3", rank: 36, total: 10 },
        { shop: "steam", objectId: "1", rank: 0 },
        "bad",
      ],
    });

    assert.equal(games.length, 3);
    assert.equal(games[0].leader?.id, "a");
    assert.equal(games[0].coverImageUrl, null);
    assert.equal(games[0].total, 12480);
    // An unknown or impossible total stays unknown, never the rank.
    assert.equal(games[1].total, null);
    assert.equal(games[2].total, null);
    assert.throws(() => normalizeMyGames({}), TypeError);
  });

  it("caps shown board sizes at 10,000+", () => {
    const format = (value: number) => String(value);
    assert.equal(formatBoardTotal(9999, format), "9999");
    assert.equal(formatBoardTotal(10000, format), "10000+");
    assert.equal(formatBoardTotal(123456, format), "10000+");
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
          threshold: 1,
          value: 765120,
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
    // Top N% reads the threshold, never the viewer's value on the board.
    assert.equal(badges.badges[0].value, 1);
    assert.equal(badges.badges[1].value, 1);
    assert.equal(getBadgeProgress(badges.badges[1]), 55);
    assert.equal(getBadgeProgress(badges.badges[0]), 0);
    assert.throws(() => normalizeBadges({}), TypeError);
  });

  it("reads the target of locked game badges", () => {
    const { badges } = normalizeBadges({
      badges: [
        {
          id: "a",
          kind: "top_rank",
          tier: "bronze",
          threshold: 10,
          value: 765120,
        },
        {
          id: "b",
          kind: "top_rank",
          threshold: 10,
          value: 765120,
          target: { kind: "top_percent", value: 5 },
        },
        {
          id: "c",
          kind: "top_rank",
          threshold: 1,
          value: 765120,
          earnedAt: "2026-09-03T00:00:00.000Z",
        },
        { id: "d", kind: "weekly_leader", value: 1 },
        { id: "e", kind: "top_rank", target: { kind: "nope", value: 3 } },
      ],
    });

    assert.deepEqual(
      badges.map((badge) => badge.target),
      [
        { kind: "top_rank", value: 10 },
        { kind: "top_percent", value: 5 },
        null,
        null,
        null,
      ]
    );
  });
});
