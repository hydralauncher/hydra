import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserAchievement } from "@types";
import {
  createRetroAchievementsUnlockConfirmer,
  type RetroAchievementsConfirmationSyncResult,
} from "./retro-achievements-unlock-confirmer.js";

const achievement = (
  name: string,
  unlockTime: number | null
): UserAchievement => ({
  name,
  displayName: `Achievement ${name}`,
  description: "",
  icon: "",
  icongray: "",
  hidden: false,
  unlocked: unlockTime !== null,
  unlockTime,
});

const createHarness = (results: RetroAchievementsConfirmationSyncResult[]) => {
  const waits: number[] = [];
  const confirmations: string[][] = [];
  let syncCount = 0;

  const confirmer = createRetroAchievementsUnlockConfirmer({
    sync: async () => results[Math.min(syncCount++, results.length - 1)],
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
    onConfirmed: (confirmed) => {
      confirmations.push(confirmed.map(({ name }) => name));
    },
    attemptDelaysMs: [0, 10, 20],
  });

  return {
    confirmer,
    waits,
    confirmations,
    syncCount: () => syncCount,
  };
};

describe("RetroAchievements unlock confirmer", () => {
  it("confirms a detected unlock once RetroAchievements reports it", async () => {
    const harness = createHarness([
      { status: "success", achievements: [achievement("10", null)] },
      { status: "success", achievements: [achievement("10", 1_000)] },
    ]);

    await harness.confirmer.enqueue([{ id: "10", title: "First" }]);

    assert.deepEqual(harness.confirmations, [["10"]]);
    assert.deepEqual(harness.waits, [10]);
    assert.equal(harness.syncCount(), 2);
  });

  it("does not confirm the same achievement twice in a session", async () => {
    const harness = createHarness([
      { status: "success", achievements: [achievement("10", 1_000)] },
    ]);

    await harness.confirmer.enqueue([{ id: "10", title: "First" }]);
    await harness.confirmer.enqueue([{ id: "10", title: "First" }]);

    assert.deepEqual(harness.confirmations, [["10"]]);
    assert.equal(harness.syncCount(), 1);
  });

  it("gives up silently when the unlock is never confirmed", async () => {
    const harness = createHarness([
      { status: "success", achievements: [achievement("10", null)] },
    ]);

    await harness.confirmer.enqueue([{ id: "10", title: "First" }]);

    assert.deepEqual(harness.confirmations, []);
    assert.equal(harness.syncCount(), 3);
  });

  it("stops retrying when credentials or mapping are missing", async () => {
    const harness = createHarness([{ status: "no_mapping", achievements: [] }]);

    await harness.confirmer.enqueue([{ id: "10", title: "First" }]);

    assert.equal(harness.syncCount(), 1);
    assert.deepEqual(harness.waits, []);
  });

  it("confirms simultaneous unlocks independently and in unlock order", async () => {
    const harness = createHarness([
      {
        status: "success",
        achievements: [achievement("11", 2_000), achievement("10", null)],
      },
      {
        status: "success",
        achievements: [achievement("11", 2_000), achievement("10", 3_000)],
      },
    ]);

    await harness.confirmer.enqueue([
      { id: "10", title: "First" },
      { id: "11", title: "Second" },
    ]);

    assert.deepEqual(harness.confirmations, [["11"], ["10"]]);
  });

  it("keeps processing after a sync failure", async () => {
    const errors: unknown[] = [];
    let calls = 0;
    const confirmer = createRetroAchievementsUnlockConfirmer({
      sync: async () => {
        calls += 1;
        if (calls === 1) throw new Error("network");
        return { status: "success", achievements: [achievement("12", 1)] };
      },
      wait: async () => {},
      onConfirmed: () => {},
      onError: (error) => errors.push(error),
      attemptDelaysMs: [0],
    });

    await confirmer.enqueue([{ id: "12", title: "Third" }]);
    await confirmer.enqueue([{ id: "12", title: "Third" }]);

    assert.equal(errors.length, 1);
    assert.equal(calls, 2);
  });
});
