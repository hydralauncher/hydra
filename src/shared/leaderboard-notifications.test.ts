import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLeaderboardBoardPath,
  getLeaderboardRankDelta,
  parseLeaderboardNotification,
} from "./leaderboard-notifications.js";

describe("parseLeaderboardNotification", () => {
  it("reads a rank change on a game board", () => {
    const info = parseLeaderboardNotification({
      type: "LEADERBOARD_RANK_CHANGED",
      variables: {
        boardType: "game",
        metric: "playtime",
        scope: "global",
        shop: "steam",
        objectId: "291550",
        gameTitle: "Brawlhalla",
        previousRank: 7,
        newRank: 3,
        direction: "up",
        moment: "top3",
        cloudRank: null,
        push: true,
      },
    });

    assert.deepEqual(info, {
      kind: "rank",
      metric: "playtime",
      scope: "global",
      game: { shop: "steam", objectId: "291550", title: "Brawlhalla" },
      rank: 3,
      previousRank: 7,
      direction: "up",
      moment: "top3",
      cloudRank: null,
      push: true,
    });
    assert.equal(getLeaderboardRankDelta(info!), 4);
  });

  it("reads a missing photo nudge as a global climb", () => {
    const info = parseLeaderboardNotification({
      type: "LEADERBOARD_MISSING_PHOTO",
      variables: {
        boardType: "global",
        metric: "sessions",
        missingPhotoRank: 12,
        moment: "top100",
        push: false,
      },
    });

    assert.equal(info?.kind, "missing_photo");
    assert.equal(info?.rank, 12);
    assert.equal(info?.scope, "global");
    assert.equal(info?.game, null);
    assert.equal(getLeaderboardRankDelta(info!), null);
  });

  it("ignores other notification types and broken variables", () => {
    assert.equal(
      parseLeaderboardNotification({ type: "BADGE_RECEIVED", variables: {} }),
      null
    );
    assert.equal(
      parseLeaderboardNotification({
        type: "LEADERBOARD_RANK_CHANGED",
        variables: { metric: "playtime", newRank: 0 },
      }),
      null
    );
  });
});

describe("buildLeaderboardBoardPath", () => {
  it("matches the paths the leaderboards page requests", () => {
    assert.equal(
      buildLeaderboardBoardPath("playtime", null),
      "/leaderboards/playtime"
    );
    assert.equal(
      buildLeaderboardBoardPath("sessions", {
        shop: "launchbox",
        objectId: "a b/c",
      }),
      "/games/launchbox/a%20b%2Fc/leaderboards/sessions"
    );
  });
});
