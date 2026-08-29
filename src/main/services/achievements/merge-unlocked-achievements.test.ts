import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeUnlockedAchievementLists } from "./merge-unlocked-achievements.ts";

const achievement = (name: string, unlockTime = 1) => ({ name, unlockTime });

describe("mergeUnlockedAchievementLists", () => {
  it("keeps local achievements the remote list has not received yet", () => {
    assert.deepEqual(
      mergeUnlockedAchievementLists(
        [achievement("ACH_ONE")],
        [achievement("ACH_ONE"), achievement("ACH_FIRED", 2)]
      ),
      [achievement("ACH_ONE"), achievement("ACH_FIRED", 2)]
    );
  });

  it("returns the remote list untouched when it already covers local", () => {
    const remote = [achievement("ACH_ONE"), achievement("ACH_TWO")];

    assert.equal(
      mergeUnlockedAchievementLists(remote, [achievement("ACH_ONE")]),
      remote
    );
  });

  it("matches names case-insensitively", () => {
    const remote = [achievement("ACH_ONE")];

    assert.equal(
      mergeUnlockedAchievementLists(remote, [achievement("ach_one")]),
      remote
    );
  });

  it("keeps every local achievement when the remote list is empty", () => {
    assert.deepEqual(
      mergeUnlockedAchievementLists([], [achievement("ACH_FIRED")]),
      [achievement("ACH_FIRED")]
    );
  });
});
