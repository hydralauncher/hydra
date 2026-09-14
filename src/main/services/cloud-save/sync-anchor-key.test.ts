import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getCloudSaveSyncAnchorEnvironmentFromKey,
  isCloudSaveSyncAnchorKeyForGame,
} from "./sync-anchor-key.ts";

describe("cloud save sync anchor keys", () => {
  it("matches legacy and environment anchors for one user and game", () => {
    assert.equal(
      isCloudSaveSyncAnchorKeyForGame(
        JSON.stringify(["user", "steam", "game"]),
        "user",
        "steam",
        "game"
      ),
      true
    );
    assert.equal(
      isCloudSaveSyncAnchorKeyForGame(
        JSON.stringify([
          "user",
          "steam",
          "game",
          "environment",
          "environment-a",
        ]),
        "user",
        "steam",
        "game"
      ),
      true
    );
  });

  it("does not match another user, game, shop or malformed key", () => {
    const candidates = [
      JSON.stringify(["other-user", "steam", "game"]),
      JSON.stringify(["user", "steam", "other-game"]),
      JSON.stringify(["user", "launchbox", "game"]),
      JSON.stringify(["user", "steam", "game", "unknown", "environment-a"]),
      JSON.stringify(["user", "steam", "game", "environment"]),
      "not-json",
    ];

    for (const candidate of candidates) {
      assert.equal(
        isCloudSaveSyncAnchorKeyForGame(candidate, "user", "steam", "game"),
        false
      );
    }
  });

  it("extracts only an environment belonging to the current user and game", () => {
    const key = JSON.stringify([
      "user",
      "steam",
      "game",
      "environment",
      "environment-a",
    ]);
    assert.equal(
      getCloudSaveSyncAnchorEnvironmentFromKey(key, "user", "steam", "game"),
      "environment-a"
    );
    assert.equal(
      getCloudSaveSyncAnchorEnvironmentFromKey(
        key,
        "other-user",
        "steam",
        "game"
      ),
      null
    );
    assert.equal(
      getCloudSaveSyncAnchorEnvironmentFromKey(
        JSON.stringify(["user", "steam", "game"]),
        "user",
        "steam",
        "game"
      ),
      null
    );
  });
});
