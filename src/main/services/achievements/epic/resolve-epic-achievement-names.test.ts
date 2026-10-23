import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SteamAchievement } from "@types";
import { resolveEpicAchievementNames } from "./resolve-epic-achievement-names.ts";

const definition = (
  name: string,
  externalId?: string,
  externalSetId = "set"
): SteamAchievement => ({
  name,
  displayName: name,
  icon: "",
  icongray: "",
  hidden: false,
  externalId,
  externalSetId: externalId ? externalSetId : undefined,
});

const unlock = (name: string, unlockTime = 1) => ({ name, unlockTime });

describe("resolveEpicAchievementNames", () => {
  it("maps Epic ids to catalogue names", () => {
    assert.deepEqual(
      resolveEpicAchievementNames(
        [unlock("38", 5)],
        [definition("epic_a", "38"), definition("epic_b", "32")]
      ),
      { resolved: [unlock("epic_a", 5)], unresolved: [] }
    );
  });

  it("maps Alan Wake 2 positions to ACH_ prefixed ids", () => {
    assert.deepEqual(
      resolveEpicAchievementNames(
        [unlock("3")],
        [definition("epic_a", "ACH_3")]
      ).resolved,
      [unlock("epic_a")]
    );
  });

  it("keeps ids without a catalogue entry unresolved", () => {
    assert.deepEqual(
      resolveEpicAchievementNames(
        [unlock("ACH_9"), unlock("10")],
        [definition("epic_a", "ACH_1"), definition("epic_b")]
      ),
      { resolved: [], unresolved: [unlock("ACH_9"), unlock("10")] }
    );
  });

  it("does not guess between achievement sets", () => {
    assert.deepEqual(
      resolveEpicAchievementNames(
        [unlock("1")],
        [definition("epic_a", "1", "base"), definition("epic_b", "1", "dlc")]
      ).unresolved,
      [unlock("1")]
    );
  });

  it("does not guess between the two id forms", () => {
    assert.deepEqual(
      resolveEpicAchievementNames(
        [unlock("1")],
        [definition("epic_a", "1"), definition("epic_b", "ACH_1")]
      ).unresolved,
      [unlock("1")]
    );
  });
});
