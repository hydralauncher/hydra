import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SteamAchievement } from "@types";
import {
  countSessionUnlocks,
  selectOptimisticUnlocks,
} from "./retro-achievements-optimistic-unlocks.js";

const achievement = (name: string): SteamAchievement => ({
  name,
  displayName: `Achievement ${name}`,
  description: "",
  icon: "",
  icongray: "",
  hidden: false,
});

const catalogue = [achievement("10"), achievement("11"), achievement("12")];

describe("RetroAchievements optimistic unlocks", () => {
  it("counts unconfirmed session unlocks towards progress", () => {
    assert.equal(
      countSessionUnlocks(catalogue, ["10"], new Set(["11", "12"])),
      3
    );
    assert.equal(
      countSessionUnlocks(catalogue, ["10"], new Set(["10", "99"])),
      1
    );
  });

  it("selects locked catalogue achievements in detection order", () => {
    assert.deepEqual(
      selectOptimisticUnlocks(
        [
          { id: "12", title: "Third" },
          { id: "10", title: "First" },
        ],
        catalogue,
        [],
        new Set()
      ).map(({ name }) => name),
      ["12", "10"]
    );
  });

  it("skips achievements that are already unlocked or notified", () => {
    assert.deepEqual(
      selectOptimisticUnlocks(
        [
          { id: "10", title: "First" },
          { id: "11", title: "Second" },
          { id: "12", title: "Third" },
        ],
        catalogue,
        ["10"],
        new Set(["11"])
      ).map(({ name }) => name),
      ["12"]
    );
  });

  it("skips achievements missing from the cached catalogue", () => {
    assert.deepEqual(
      selectOptimisticUnlocks(
        [{ id: "99", title: "Unknown" }],
        catalogue,
        [],
        new Set()
      ),
      []
    );
  });

  it("selects a repeated detection only once", () => {
    assert.equal(
      selectOptimisticUnlocks(
        [
          { id: "10", title: "First" },
          { id: "10", title: "First" },
        ],
        catalogue,
        [],
        new Set()
      ).length,
      1
    );
  });
});
