import assert from "node:assert/strict";
import { test } from "node:test";
import { EpicAchievementBaselineTracker } from "./achievement-baseline.ts";

const unlock = (name: string, unlockTime: number) => ({ name, unlockTime });

test("separates older and new Nemirtingas unlocks after a failed baseline", () => {
  const tracker = new EpicAchievementBaselineTracker();
  const file = "nemirtingas/achievements.json";

  assert.equal(
    tracker.observe("game", file, "nemirtingas", null, true, 10_500),
    null
  );
  assert.equal(
    tracker.observe("game", file, "nemirtingas", null, true, 12_500),
    null
  );

  const recovered = [
    unlock("older", 9_000),
    unlock("boundary", 10_000),
    unlock("new", 11_000),
  ];
  assert.deepEqual(
    tracker.observe("game", file, "nemirtingas", recovered, true, 13_000),
    {
      historical: [recovered[0]],
      live: [recovered[1], recovered[2]],
    }
  );

  const later = [...recovered, unlock("later", 14_000)];
  assert.deepEqual(
    tracker.observe("game", file, "nemirtingas", later, false, 15_000),
    { historical: [later[0]], live: later.slice(1) }
  );
});

test("imports the first recovered Alan Wake 2 snapshot silently", () => {
  const tracker = new EpicAchievementBaselineTracker();
  const file = "alan-wake-2/data.chunk";

  tracker.observe("game", file, "alan-wake-2", null, true, 10_500);
  const first = [unlock("older", 12_000)];
  assert.deepEqual(
    tracker.observe("game", file, "alan-wake-2", first, false, 12_000),
    { historical: first, live: [] }
  );

  tracker.observe("game", file, "alan-wake-2", null, false, 13_000);
  const later = [...first, unlock("new", 14_000)];
  assert.deepEqual(
    tracker.observe("game", file, "alan-wake-2", later, false, 14_000),
    { historical: first, live: [later[1]] }
  );
});

test("keeps an empty successful baseline through a later failed read", () => {
  const tracker = new EpicAchievementBaselineTracker();
  const file = "nemirtingas/achievements.json";

  assert.deepEqual(
    tracker.observe("game", file, "nemirtingas", [], true, 10_000),
    { historical: [], live: [] }
  );
  tracker.observe("game", file, "nemirtingas", null, true, 11_000);
  const earned = [unlock("new", 12_000)];
  assert.deepEqual(
    tracker.observe("game", file, "nemirtingas", earned, false, 12_000),
    { historical: [], live: earned }
  );
});

test("classifies the first file found after startup by source and timestamp", () => {
  const tracker = new EpicAchievementBaselineTracker(10_500);
  const nemirtingas = [unlock("older", 9_000), unlock("new", 10_000)];
  assert.deepEqual(
    tracker.observe(
      "game",
      "nemirtingas/achievements.json",
      "nemirtingas",
      nemirtingas,
      false,
      12_000
    ),
    { historical: [nemirtingas[0]], live: [nemirtingas[1]] }
  );

  const alanWake2 = [unlock("older", 12_000)];
  assert.deepEqual(
    tracker.observe(
      "game",
      "alan-wake-2/data.chunk",
      "alan-wake-2",
      alanWake2,
      false,
      12_000
    ),
    { historical: alanWake2, live: [] }
  );
});

test("treats recreated reset files as live without affecting other paths", () => {
  const tracker = new EpicAchievementBaselineTracker(10_500);
  const file = "nemirtingas/achievements.json";
  const earned = [unlock("old", 9_000)];

  tracker.observe("game", file, "nemirtingas", earned, true, 10_000);
  tracker.markReset("game", [file]);
  assert.deepEqual(
    tracker.observe("game", file, "nemirtingas", earned, false, 11_000),
    { historical: [], live: earned }
  );
  assert.deepEqual(
    tracker.observe(
      "game",
      "alan-wake-2/data.chunk",
      "alan-wake-2",
      earned,
      false,
      11_000
    ),
    { historical: earned, live: [] }
  );
  const otherNemirtingas = [...earned, unlock("new", 10_000)];
  assert.deepEqual(
    tracker.observe(
      "game",
      "nemirtingas/other.json",
      "nemirtingas",
      otherNemirtingas,
      false,
      11_000
    ),
    { historical: [earned[0]], live: [otherNemirtingas[1]] }
  );
  tracker.clear(12_000);
  assert.deepEqual(
    tracker.observe("game", file, "nemirtingas", earned, true, 12_000),
    { historical: earned, live: [] }
  );
});

test("refreshes the first-seen cutoff after an auth session reset", () => {
  const tracker = new EpicAchievementBaselineTracker(10_500);
  tracker.clear(20_500);
  const found = [unlock("before-sign-in", 15_000), unlock("new", 20_000)];

  assert.deepEqual(
    tracker.observe(
      "game",
      "nemirtingas/achievements.json",
      "nemirtingas",
      found,
      false,
      21_000
    ),
    { historical: [found[0]], live: [found[1]] }
  );
});

test("a reset with no deleted files does not arm later files", () => {
  const tracker = new EpicAchievementBaselineTracker(10_500);
  const old = [unlock("old", 9_000)];

  tracker.markReset("game", []);
  assert.deepEqual(
    tracker.observe(
      "game",
      "alan-wake-2/data.chunk",
      "alan-wake-2",
      old,
      false,
      11_000
    ),
    { historical: old, live: [] }
  );
});
