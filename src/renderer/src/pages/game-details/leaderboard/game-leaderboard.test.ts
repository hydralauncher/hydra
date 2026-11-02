import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLeaderboardRequest,
  buildLeaderboardRows,
  parseLeaderboardPeriod,
  parseLeaderboardScope,
  fetchGameLeaderboard,
  formatDurationParts,
  getDurationParts,
  buildGameLeaderboardPath,
  getLeaderboardNudge,
  getLeaderboardState,
  getServedMetrics,
  isSignedOutError,
  getLeaderboardBoardKey,
  normalizeLeaderboardResponse,
  selectLoadedLeaderboard,
  type LeaderboardEntry,
  type LeaderboardGet,
  type LeaderboardQuery,
  type LeaderboardUser,
} from "./game-leaderboard.js";

const user = (id: string, displayName = id): LeaderboardUser => ({
  id,
  displayName,
  profileImageUrl: null,
  backgroundImageUrl: null,
});

const entry = (rank: number, id: string, value: number): LeaderboardEntry => ({
  rank,
  value,
  user: user(id),
});

const board = (...entries: LeaderboardEntry[]) => ({ entries, viewer: null });

const query = (
  overrides: Partial<LeaderboardQuery> = {}
): LeaderboardQuery => ({
  shop: "steam",
  objectId: "123",
  period: "all",
  scope: "global",
  metric: "playtime",
  isLoggedIn: false,
  viewerId: null,
  ...overrides,
});

describe("normalizeLeaderboardResponse", () => {
  it("reads the profile banner when the API sends one", () => {
    const result = normalizeLeaderboardResponse({
      entries: [
        {
          rank: 1,
          value: 1,
          user: { id: "a", displayName: "A", backgroundImageUrl: "bg.png" },
        },
        {
          rank: 2,
          value: 1,
          user: { id: "b", displayName: "B", backgroundImageUrl: "" },
        },
      ],
    });

    assert.equal(result.entries[0].user.backgroundImageUrl, "bg.png");
    assert.equal(result.entries[1].user.backgroundImageUrl, null);
  });

  it("reads the entries shape of the game leaderboard route", () => {
    const result = normalizeLeaderboardResponse({
      entries: [{ rank: 1, value: 5, user: user("a") }],
      viewer: { rank: 2, value: 1 },
      generatedAt: "2026-10-22T00:00:00.000Z",
    });

    assert.deepEqual(result, {
      entries: [{ rank: 1, value: 5, user: user("a") }],
      viewer: { rank: 2, value: 1 },
    });
  });

  it("drops invalid and duplicate entries and sorts by rank", () => {
    const result = normalizeLeaderboardResponse({
      entries: [
        { rank: 2, value: 5, user: user("b") },
        { rank: 1, value: 9, user: user("a") },
        { rank: 3, value: 4, user: user("a") },
        { rank: 0, value: 1, user: user("c") },
        { rank: 4, value: -1, user: user("d") },
        { rank: 5, value: 1, user: { displayName: "no id" } },
        { rank: 6, user: user("e") },
        null,
        "garbage",
      ],
      viewer: { rank: "1", value: 2 },
    });

    assert.deepEqual(
      result.entries.map((item) => item.user.id),
      ["a", "b"]
    );
    assert.equal(result.viewer, null);
  });

  it("rejects responses without an entries list", () => {
    assert.throws(() => normalizeLeaderboardResponse(null), TypeError);
    assert.throws(() => normalizeLeaderboardResponse({}), TypeError);
    assert.throws(
      () => normalizeLeaderboardResponse({ entries: "nope" }),
      TypeError
    );
    assert.throws(
      () =>
        normalizeLeaderboardResponse({
          users: [{ rank: 1, playTimeInSeconds: 60, user: user("a") }],
        }),
      TypeError
    );
  });
});

describe("saved leaderboard filters", () => {
  it("keeps a valid saved value", () => {
    assert.equal(parseLeaderboardPeriod("all"), "all");
    assert.equal(parseLeaderboardScope("friends"), "friends");
  });

  it("falls back to the defaults for an invalid or missing value", () => {
    assert.equal(parseLeaderboardPeriod("month"), "week");
    assert.equal(parseLeaderboardPeriod(null), "week");
    assert.equal(parseLeaderboardScope("everyone"), "global");
    assert.equal(parseLeaderboardScope(null), "global");
  });
});

describe("buildLeaderboardRows", () => {
  const top = board(
    entry(1, "a", 100),
    entry(2, "b", 50),
    entry(3, "c", 25),
    entry(4, "d", 10),
    entry(5, "e", 2),
    entry(6, "f", 1),
    entry(9, "me", 1)
  );

  it("shows the top rows with progress relative to the leader", () => {
    const rows = buildLeaderboardRows(top, null, 3);

    assert.deepEqual(
      rows.map((row) => [row.entry.user.id, row.progress, row.isViewer]),
      [
        ["a", 100, false],
        ["b", 50, false],
        ["c", 25, false],
      ]
    );
  });

  it("keeps a minimum progress for small values", () => {
    const rows = buildLeaderboardRows(top, null, 5);
    assert.equal(rows[4].progress, 4);
  });

  it("marks the viewer inside the top without duplicating it", () => {
    const rows = buildLeaderboardRows(top, user("b"), 5);

    assert.equal(rows.length, 5);
    assert.equal(rows[1].isViewer, true);
    assert.equal(
      rows.some((row) => row.gapBefore),
      false
    );
  });

  it("appends the viewer after a gap when outside the top", () => {
    const rows = buildLeaderboardRows(top, user("me"), 5);
    const last = rows.at(-1);

    assert.equal(rows.length, 6);
    assert.equal(last?.entry.rank, 9);
    assert.equal(last?.isViewer, true);
    assert.equal(last?.gapBefore, true);
  });

  it("appends the next rank without a gap", () => {
    const rows = buildLeaderboardRows(top, user("f"), 5);

    assert.equal(rows.at(-1)?.entry.rank, 6);
    assert.equal(rows.at(-1)?.gapBefore, false);
  });

  it("uses the API viewer when the viewer is not listed", () => {
    const rows = buildLeaderboardRows(
      { entries: [entry(1, "a", 10)], viewer: { rank: 250, value: 3 } },
      user("me", "Me"),
      5
    );

    assert.equal(rows.length, 2);
    assert.deepEqual(rows[1].entry, {
      rank: 250,
      value: 3,
      user: user("me", "Me"),
    });
    assert.equal(rows[1].progress, 30);
  });

  it("adds no row for a viewer without a rank", () => {
    const rows = buildLeaderboardRows(top, user("ghost"), 5);

    assert.equal(rows.length, 5);
    assert.equal(
      rows.some((row) => row.isViewer),
      false
    );
  });

  it("returns no rows for an empty board", () => {
    assert.deepEqual(buildLeaderboardRows(board(), user("me"), 5), []);
  });
});

describe("getLeaderboardNudge", () => {
  const top = board(entry(1, "a", 100), entry(2, "b", 40), entry(3, "me", 25));

  it("tells the viewer how far the next position is", () => {
    assert.deepEqual(getLeaderboardNudge(top, user("me")), {
      type: "behind",
      gap: 15,
      target: user("b"),
      targetRank: 2,
    });
  });

  it("uses the player right above with tied ranks", () => {
    assert.deepEqual(
      getLeaderboardNudge(
        board(entry(1, "a", 100), entry(1, "b", 100), entry(3, "me", 60)),
        user("me")
      ),
      { type: "behind", gap: 40, target: user("b"), targetRank: 1 }
    );
  });

  it("congratulates the leader", () => {
    assert.deepEqual(getLeaderboardNudge(top, user("a")), { type: "leading" });
  });

  it("stays quiet without enough data", () => {
    assert.equal(getLeaderboardNudge(top, null), null);
    assert.equal(getLeaderboardNudge(top, user("ghost")), null);
    assert.equal(
      getLeaderboardNudge(
        { entries: [entry(1, "a", 10)], viewer: { rank: 7, value: 2 } },
        user("me")
      ),
      null
    );
    assert.equal(
      getLeaderboardNudge(
        board(entry(1, "a", 5), entry(2, "me", 5)),
        user("me")
      ),
      null
    );
  });
});

describe("getLeaderboardState", () => {
  const base = {
    isEligible: true,
    hasError: false,
    leaderboard: board(entry(1, "a", 1)),
    period: "all" as const,
    scope: "global" as const,
    viewerId: null,
  };

  it("covers hidden, loading, error and ready", () => {
    assert.equal(getLeaderboardState({ ...base, isEligible: false }), "hidden");
    assert.equal(getLeaderboardState({ ...base, hasError: true }), "error");
    assert.equal(
      getLeaderboardState({ ...base, leaderboard: null }),
      "loading"
    );
    assert.equal(
      getLeaderboardState({ ...base, hasError: true, leaderboard: null }),
      "error"
    );
    assert.equal(getLeaderboardState(base), "ready");
  });

  it("reports a solo board when the viewer is the only entry", () => {
    assert.equal(getLeaderboardState({ ...base, viewerId: "a" }), "solo");
    assert.equal(
      getLeaderboardState({
        ...base,
        leaderboard: board(entry(1, "a", 2), entry(2, "b", 1)),
        viewerId: "a",
      }),
      "ready"
    );
  });

  it("distinguishes empty week and all-time boards", () => {
    assert.equal(
      getLeaderboardState({ ...base, leaderboard: board(), period: "week" }),
      "empty_week"
    );
    assert.equal(
      getLeaderboardState({ ...base, leaderboard: board() }),
      "empty_all"
    );
  });

  it("reports an empty friends board when only the viewer is on it", () => {
    assert.equal(
      getLeaderboardState({
        ...base,
        scope: "friends",
        viewerId: "me",
        leaderboard: board(entry(1, "me", 3)),
      }),
      "empty_friends"
    );
    assert.equal(
      getLeaderboardState({
        ...base,
        scope: "friends",
        viewerId: "me",
        leaderboard: board(entry(1, "me", 3), entry(2, "a", 1)),
      }),
      "ready"
    );
  });
});

describe("buildLeaderboardRequest", () => {
  it("only authenticates signed-in requests", () => {
    assert.equal(buildLeaderboardRequest(query()).options.needsAuth, false);
    assert.equal(
      buildLeaderboardRequest(query({ isLoggedIn: true, viewerId: "a" }))
        .options.needsAuth,
      true
    );
  });

  it("uses the global playtime board for the default query", () => {
    assert.deepEqual(buildLeaderboardRequest(query({ period: "week" })), {
      path: "/games/steam/123/leaderboards/playtime",
      options: {
        params: { take: 100, range: "week", scope: "global" },
        needsAuth: false,
      },
    });
  });

  it("uses the requested metric and scope", () => {
    assert.deepEqual(
      buildLeaderboardRequest(
        query({
          scope: "friends",
          metric: "souvenirs",
          isLoggedIn: true,
          objectId: "a/b",
        })
      ),
      {
        path: "/games/steam/a%2Fb/leaderboards/souvenirs",
        options: {
          params: { take: 100, range: "all", scope: "friends" },
          needsAuth: true,
        },
      }
    );
  });
});

describe("getServedMetrics", () => {
  it("keeps the launcher order of the metrics the API serves", () => {
    assert.deepEqual(getServedMetrics(["souvenirs", "playtime", "badges"]), [
      "playtime",
      "souvenirs",
    ]);
  });

  it("falls back to playtime until the catalogue loads", () => {
    assert.deepEqual(getServedMetrics(null), ["playtime"]);
    assert.deepEqual(getServedMetrics([]), ["playtime"]);
  });
});

describe("fetchGameLeaderboard", () => {
  const response = {
    entries: [{ rank: 1, value: 60, user: user("a") }],
  };

  it("requests the board and normalizes the response", async () => {
    const calls: string[] = [];
    const leaderboard = await fetchGameLeaderboard(async (path) => {
      calls.push(path);
      return response;
    }, query());

    assert.equal(calls.length, 1);
    assert.equal(leaderboard.entries[0].value, 60);
  });

  it("does not call the API for unsupported games", async () => {
    let calls = 0;
    const get: LeaderboardGet = async () => {
      calls += 1;
      return response;
    };

    const custom = await fetchGameLeaderboard(get, query({ shop: "custom" }));
    const missing = await fetchGameLeaderboard(get, query({ objectId: "" }));

    assert.equal(calls, 0);
    assert.deepEqual(custom.entries, []);
    assert.deepEqual(missing.entries, []);
  });

  it("retries without auth when the session is stale", async () => {
    const auth: boolean[] = [];
    const result = await fetchGameLeaderboard(
      async (_path, options) => {
        auth.push(options.needsAuth);
        if (options.needsAuth) {
          throw new Error(
            "Error invoking remote method: UserNotLoggedInError: user not logged in"
          );
        }
        return response;
      },
      query({ isLoggedIn: true, viewerId: "a" })
    );

    assert.deepEqual(auth, [true, false]);
    assert.equal(result.entries.length, 1);
  });

  it("does not retry other errors", async () => {
    let calls = 0;
    await assert.rejects(
      fetchGameLeaderboard(
        async () => {
          calls += 1;
          throw new Error("boom");
        },
        query({ isLoggedIn: true, viewerId: "a" })
      ),
      /boom/
    );
    assert.equal(calls, 1);
  });

  it("propagates request failures", async () => {
    await assert.rejects(
      fetchGameLeaderboard(async () => {
        throw new Error("boom");
      }, query()),
      /boom/
    );
  });
});

describe("getDurationParts", () => {
  it("shows minutes below the limit with a one minute floor", () => {
    assert.deepEqual(getDurationParts(20, 120), { unit: "minutes", amount: 1 });
    assert.deepEqual(getDurationParts(0, 120), { unit: "minutes", amount: 0 });
    assert.deepEqual(getDurationParts(3000, 120), {
      unit: "minutes",
      amount: 50,
    });
  });

  it("switches to hours at the limit", () => {
    assert.deepEqual(getDurationParts(7200, 120), { unit: "hours", amount: 2 });
  });

  it("keeps one decimal for hours", () => {
    assert.deepEqual(getDurationParts(9060, 120), {
      unit: "hours",
      amount: 2.5,
    });
    assert.deepEqual(getDurationParts(12540, 120), {
      unit: "hours",
      amount: 3.5,
    });
  });

  it("rounds to whole hours from ten hours up", () => {
    assert.deepEqual(getDurationParts(37800, 120), {
      unit: "hours",
      amount: 11,
    });
  });
});

describe("formatDurationParts", () => {
  it("renders one decimal for hours and none for minutes", () => {
    assert.deepEqual(formatDurationParts(9060, 120, "en"), {
      unit: "hours",
      amount: "2.5",
    });
    assert.deepEqual(formatDurationParts(9060, 120, "pt-BR"), {
      unit: "hours",
      amount: "2,5",
    });
    assert.deepEqual(formatDurationParts(7200, 120, "en"), {
      unit: "hours",
      amount: "2",
    });
    assert.deepEqual(formatDurationParts(3000, 120, "en"), {
      unit: "minutes",
      amount: "50",
    });
  });
});

describe("selectLoadedLeaderboard", () => {
  const fallback = {
    period: "week" as const,
    scope: "friends" as const,
    metric: "streak" as const,
  };
  const loaded = {
    boardKey: "steam:1:anonymous",
    leaderboard: { entries: [entry(1, "a", 1)], viewer: null },
    period: "all" as const,
    scope: "global" as const,
    metric: "playtime" as const,
  };

  it("returns the loaded board with the query it was fetched for", () => {
    assert.deepEqual(
      selectLoadedLeaderboard(loaded, "steam:1:anonymous", fallback),
      {
        leaderboard: loaded.leaderboard,
        period: "all",
        scope: "global",
        metric: "playtime",
      }
    );
  });

  it("drops a board loaded for another game", () => {
    assert.deepEqual(
      selectLoadedLeaderboard(loaded, "steam:2:anonymous", fallback),
      {
        leaderboard: null,
        ...fallback,
      }
    );
  });

  it("drops a board loaded for another account", () => {
    assert.deepEqual(selectLoadedLeaderboard(loaded, "steam:1:b", fallback), {
      leaderboard: null,
      ...fallback,
    });
  });

  it("falls back to the selection when nothing is loaded", () => {
    assert.deepEqual(
      selectLoadedLeaderboard(null, "steam:1:anonymous", fallback),
      {
        leaderboard: null,
        ...fallback,
      }
    );
  });
});

describe("buildGameLeaderboardPath", () => {
  const selection = {
    period: "all" as const,
    scope: "friends" as const,
    metric: "sessions" as const,
  };

  it("opens the per-game tab with the current selection", () => {
    assert.equal(
      buildGameLeaderboardPath("steam", "291550", selection),
      "/leaderboards?tab=games&shop=steam&objectId=291550&period=all&scope=friends&metric=sessions"
    );
  });

  it("encodes object ids", () => {
    assert.equal(
      buildGameLeaderboardPath("launchbox", "a b/c", selection),
      "/leaderboards?tab=games&shop=launchbox&objectId=a+b%2Fc&period=all&scope=friends&metric=sessions"
    );
  });
});

describe("getLeaderboardBoardKey", () => {
  it("separates games and accounts", () => {
    assert.equal(
      getLeaderboardBoardKey("steam", "1", null),
      "steam:1:anonymous"
    );
    assert.equal(getLeaderboardBoardKey("steam", "1", "a"), "steam:1:a");
    assert.notEqual(
      getLeaderboardBoardKey("steam", "1", "a"),
      getLeaderboardBoardKey("steam", "1", "b")
    );
  });
});

describe("isSignedOutError", () => {
  it("matches the signed-out error by name or IPC message", () => {
    const named = new Error("x");
    named.name = "UserNotLoggedInError";

    assert.equal(isSignedOutError(named), true);
    assert.equal(
      isSignedOutError(new Error("UserNotLoggedInError: user not logged in")),
      true
    );
    assert.equal(isSignedOutError(new Error("boom")), false);
    assert.equal(isSignedOutError("user not logged in"), false);
  });
});

describe("precomputed viewer targets", () => {
  it("keeps toTop from the API and drops a malformed one", () => {
    const kept = normalizeLeaderboardResponse({
      entries: [],
      viewer: { rank: 4821, value: 7200, toTop: { rank: 100, value: 90000 } },
    });
    assert.deepEqual(kept.viewer, {
      rank: 4821,
      value: 7200,
      toTop: { rank: 100, value: 90000 },
    });
    const dropped = normalizeLeaderboardResponse({
      entries: [],
      viewer: { rank: 4821, value: 7200, toTop: { rank: 100, value: "nope" } },
    });
    assert.deepEqual(dropped.viewer, { rank: 4821, value: 7200, toTop: null });
  });

  it("nudges toward the top when the viewer sits past the loaded entries", () => {
    const top = board(entry(1, "a", 100), entry(2, "b", 40));
    assert.deepEqual(
      getLeaderboardNudge(
        {
          ...top,
          viewer: { rank: 4821, value: 20, toTop: { rank: 100, value: 35 } },
        },
        user("me")
      ),
      { type: "to_top", gap: 15, rank: 100 }
    );
    assert.equal(
      getLeaderboardNudge(
        { ...top, viewer: { rank: 4821, value: 20, toTop: null } },
        user("me")
      ),
      null
    );
    assert.equal(
      getLeaderboardNudge(
        {
          ...top,
          viewer: { rank: 50, value: 20, toTop: { rank: 100, value: 35 } },
        },
        user("me")
      ),
      null
    );
  });
});
