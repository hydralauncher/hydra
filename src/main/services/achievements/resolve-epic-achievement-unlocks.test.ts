import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SteamAchievement } from "@types";
import {
  classifyResolvedEpicAchievementUnlocks,
  resolveEpicAchievementUnlocks,
} from "./resolve-epic-achievement-unlocks.ts";

const definition = (
  name: string,
  externalId?: string,
  externalSetId?: string
): SteamAchievement => ({
  name,
  externalId,
  externalSetId,
  displayName: name,
  icon: "",
  icongray: "",
  hidden: false,
});

describe("resolveEpicAchievementUnlocks", () => {
  it("maps exact provider IDs to the API-owned names and preserves time", () => {
    assert.deepEqual(
      resolveEpicAchievementUnlocks(
        [{ name: "32", unlockTime: 1789103566000 }],
        [definition("epic_hash", "32", "b5e4c1b")]
      ),
      {
        resolved: [{ name: "epic_hash", unlockTime: 1789103566000 }],
        unresolvedCount: 0,
        unresolvedExternalIds: [],
      }
    );
  });

  it("does not fold numeric IDs or guess without provider fields", () => {
    assert.deepEqual(
      resolveEpicAchievementUnlocks(
        [
          { name: "01", unlockTime: 1 },
          { name: "1", unlockTime: 2 },
        ],
        [definition("epic_one", "01", "set"), definition("epic_old")]
      ),
      {
        resolved: [{ name: "epic_one", unlockTime: 1 }],
        unresolvedCount: 1,
        unresolvedExternalIds: ["1"],
      }
    );
  });

  it("leaves IDs shared by two sets unresolved", () => {
    assert.deepEqual(
      resolveEpicAchievementUnlocks(
        [{ name: "7", unlockTime: 1 }],
        [definition("epic_a", "7", "set-a"), definition("epic_b", "7", "set-b")]
      ),
      { resolved: [], unresolvedCount: 1, unresolvedExternalIds: ["7"] }
    );
  });

  it("keeps a live unlock live when another file reports it as historical", () => {
    const definitions = [
      definition("epic_one", "7", "set"),
      definition("epic_two", "8", "set"),
    ];
    const historical = [
      { name: "7", unlockTime: 1 },
      { name: "8", unlockTime: 1 },
    ];
    const live = [{ name: "7", unlockTime: 2 }];
    const resolved = resolveEpicAchievementUnlocks(
      [...historical, ...live],
      definitions
    ).resolved;

    assert.deepEqual(
      classifyResolvedEpicAchievementUnlocks(resolved, live, definitions),
      { historical: [resolved[1]], live: [resolved[0], resolved[2]] }
    );
  });
});
