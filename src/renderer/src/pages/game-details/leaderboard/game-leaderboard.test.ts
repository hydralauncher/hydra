import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLeaderboardRequest,
  buildLeaderboardRows,
  createLeaderboardFetcher,
  buildGameLeaderboardPath,
  getLeaderboardNudge,
  getLeaderboardState,
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
  isExtended: false,
  isLoggedIn: false,
  viewerId: null,
  ...overrides,
});

describe("normalizeLeaderboardResponse", () => {
  it("reads the current top-users shape", () => {
    const result = normalizeLeaderboardResponse({
      users: [
        {
          rank: 1,
          playTimeInSeconds: 7200,
          user: { id: "a", displayName: "Ana", profileImageUrl: "a.png" },
        },
      ],
      periodStart: "2026-10-19T00:00:00.000Z",
      periodEnd: "2026-10-26T00:00:00.000Z",
    });

    assert.deepEqual(result, {
      entries: [
        {
          rank: 1,
          value: 7200,
          user: {
            id: "a",
            displayName: "Ana",
            profileImageUrl: "a.png",
            backgroundImageUrl: null,
          },
        },
      ],
      viewer: null,
    });
  });

  it("reads the profile banner when the API sends one", () => {
    const result = normalizeLeaderboardResponse({
      users: [
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

  it("prefers value and reads the viewer from the extended shape", () => {
    const result = normalizeLeaderboardResponse({
      users: [{ rank: 1, value: 12, playTimeInSeconds: 99, user: user("a") }],
      viewer: { rank: 40, value: 3 },
    });

    assert.equal(result.entries[0].value, 12);
    assert.deepEqual(result.viewer, { rank: 40, value: 3 });
  });

  it("drops invalid and duplicate entries and sorts by rank", () => {
    const result = normalizeLeaderboardResponse({
      users: [
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

  it("rejects responses without a users list", () => {
    assert.throws(() => normalizeLeaderboardResponse(null), TypeError);
    assert.throws(() => normalizeLeaderboardResponse({}), TypeError);
    assert.throws(
      () => normalizeLeaderboardResponse({ users: "nope" }),
      TypeError
    );
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

  it("pins the viewer below the top even when listed", () => {
    const rows = buildLeaderboardRows(top, user("b"), 5, { pinViewer: true });
    const last = rows.at(-1);

    assert.equal(rows.length, 6);
    assert.equal(rows[1].isViewer, true);
    assert.equal(rows[1].isPinned, false);
    assert.equal(last?.entry.user.id, "b");
    assert.equal(last?.isPinned, true);
    assert.equal(last?.gapBefore, true);
  });

  it("pins the viewer outside the top once", () => {
    const rows = buildLeaderboardRows(top, user("me"), 5, { pinViewer: true });

    assert.equal(rows.length, 6);
    assert.equal(rows.filter((row) => row.isViewer).length, 1);
    assert.equal(rows.at(-1)?.isPinned, true);
  });

  it("pins nothing without a viewer rank", () => {
    const rows = buildLeaderboardRows(top, user("ghost"), 5, {
      pinViewer: true,
    });

    assert.equal(rows.length, 5);
    assert.equal(
      rows.some((row) => row.isPinned),
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
    });
  });

  it("uses the player right above with tied ranks", () => {
    assert.deepEqual(
      getLeaderboardNudge(
        board(entry(1, "a", 100), entry(1, "b", 100), entry(3, "me", 60)),
        user("me")
      ),
      { type: "behind", gap: 40, target: user("b") }
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
  it("only authenticates extended requests", () => {
    assert.equal(
      buildLeaderboardRequest(query({ isLoggedIn: true, viewerId: "a" }))
        .options.needsAuth,
      false
    );
    assert.equal(
      buildLeaderboardRequest(
        query({ isLoggedIn: true, isExtended: true, viewerId: "a" })
      ).options.needsAuth,
      true
    );
  });

  it("only sends the current API params when the flag is off", () => {
    assert.deepEqual(
      buildLeaderboardRequest(
        query({ period: "week", scope: "friends", metric: "streak" })
      ),
      {
        path: "/games/steam/123/top-users",
        options: { params: { take: 100, range: "week" }, needsAuth: false },
      }
    );
  });

  it("sends metric and scope when the flag is on", () => {
    assert.deepEqual(
      buildLeaderboardRequest(
        query({
          scope: "friends",
          metric: "sessions",
          isExtended: true,
          isLoggedIn: true,
          objectId: "a/b",
        })
      ),
      {
        path: "/games/steam/a%2Fb/top-users",
        options: {
          params: {
            take: 100,
            range: "all",
            metric: "sessions",
            scope: "friends",
          },
          needsAuth: true,
        },
      }
    );
  });
});

describe("createLeaderboardFetcher", () => {
  const response = {
    users: [{ rank: 1, playTimeInSeconds: 60, user: user("a") }],
  };

  const setup = () => {
    let clock = 0;
    const calls: string[] = [];
    const get: LeaderboardGet = async (path) => {
      calls.push(path);
      return response;
    };
    const fetchLeaderboard = createLeaderboardFetcher(get, () => clock, 1000);

    return {
      calls,
      fetchLeaderboard,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  };

  it("reuses the cached board inside the TTL and refetches after", async () => {
    const { calls, fetchLeaderboard, advance } = setup();

    await fetchLeaderboard(query());
    advance(999);
    await fetchLeaderboard(query());
    assert.equal(calls.length, 1);

    advance(1);
    await fetchLeaderboard(query());
    assert.equal(calls.length, 2);
  });

  it("deduplicates concurrent requests for the same board", async () => {
    const { calls, fetchLeaderboard } = setup();

    const [first, second] = await Promise.all([
      fetchLeaderboard(query()),
      fetchLeaderboard(query()),
    ]);

    assert.equal(calls.length, 1);
    assert.equal(first, second);
  });

  it("keeps separate cache entries per period and login state", async () => {
    const { calls, fetchLeaderboard } = setup();

    await fetchLeaderboard(query());
    await fetchLeaderboard(query({ period: "week" }));
    await fetchLeaderboard(query({ isLoggedIn: true, viewerId: "a" }));

    assert.equal(calls.length, 3);
  });

  it("keeps separate cache entries per account", async () => {
    const { calls, fetchLeaderboard } = setup();

    await fetchLeaderboard(query({ isLoggedIn: true, viewerId: "a" }));
    await fetchLeaderboard(query({ isLoggedIn: true, viewerId: "b" }));
    await fetchLeaderboard(query({ isLoggedIn: true, viewerId: "a" }));

    assert.equal(calls.length, 2);
  });

  it("does not call the API for unsupported games", async () => {
    const { calls, fetchLeaderboard } = setup();

    const custom = await fetchLeaderboard(query({ shop: "custom" }));
    const missing = await fetchLeaderboard(query({ objectId: "" }));

    assert.equal(calls.length, 0);
    assert.deepEqual(custom.entries, []);
    assert.deepEqual(missing.entries, []);
  });

  it("drops expired and overflowing entries", async () => {
    let clock = 0;
    const calls: string[] = [];
    const fetchLeaderboard = createLeaderboardFetcher(
      async (path, options) => {
        calls.push(`${path}:${options.params.range}`);
        return response;
      },
      () => clock,
      1000,
      1
    );

    await fetchLeaderboard(query());
    await fetchLeaderboard(query({ period: "week" }));
    await fetchLeaderboard(query());
    assert.equal(calls.length, 3);

    clock += 1000;
    await fetchLeaderboard(query());
    assert.equal(calls.length, 4);
  });

  it("retries without auth when the session is stale", async () => {
    const auth: boolean[] = [];
    const fetchLeaderboard = createLeaderboardFetcher(
      async (_path, options) => {
        auth.push(options.needsAuth);
        if (options.needsAuth) {
          throw new Error(
            "Error invoking remote method: UserNotLoggedInError: user not logged in"
          );
        }
        return response;
      }
    );

    const result = await fetchLeaderboard(
      query({ isExtended: true, isLoggedIn: true, viewerId: "a" })
    );

    assert.deepEqual(auth, [true, false]);
    assert.equal(result.entries.length, 1);
  });

  it("does not retry other errors", async () => {
    let calls = 0;
    const fetchLeaderboard = createLeaderboardFetcher(async () => {
      calls += 1;
      throw new Error("boom");
    });

    await assert.rejects(
      fetchLeaderboard(
        query({ isExtended: true, isLoggedIn: true, viewerId: "a" })
      ),
      /boom/
    );
    assert.equal(calls, 1);
  });

  it("does not cache failures", async () => {
    let attempt = 0;
    const fetchLeaderboard = createLeaderboardFetcher(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("boom");
      return response;
    });

    await assert.rejects(fetchLeaderboard(query()), /boom/);
    const result = await fetchLeaderboard(query());

    assert.equal(attempt, 2);
    assert.equal(result.entries.length, 1);
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
