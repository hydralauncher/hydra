import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SteamSourceAchievement, SteamSourceLibraryGame } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { buildSteamSnapshot } from "./steam-sync-snapshot.ts";

const portal: SteamSourceLibraryGame = {
  steamAppId: "620",
  name: "Portal 2",
  playTimeInSeconds: 3600,
  lastPlayedAt: "2026-09-08T18:00:00.000Z",
};

const halfLife: SteamSourceLibraryGame = {
  steamAppId: "220",
  name: "Half-Life 2",
  playTimeInSeconds: 120,
  lastPlayedAt: null,
};

describe("buildSteamSnapshot", () => {
  it("keeps steamAppId as a string and library order", () => {
    const snapshot = buildSteamSnapshot([portal, halfLife], new Map());

    assert.deepEqual(
      snapshot.games.map((game) => game.steamAppId),
      ["620", "220"]
    );
    assert.equal(typeof snapshot.games[0].steamAppId, "string");
  });

  it("copies playtime and lastPlayedAt from the library, not achievements", () => {
    const achievements: SteamSourceAchievement[] = [
      {
        name: "ACH.WAKE_UP",
        unlocked: true,
        unlockTime: "2026-09-08T17:00:00.000Z",
      },
    ];

    const snapshot = buildSteamSnapshot(
      [portal],
      new Map([["620", achievements]])
    );

    assert.equal(snapshot.games[0].playTimeInSeconds, 3600);
    assert.equal(snapshot.games[0].lastPlayedAt, "2026-09-08T18:00:00.000Z");
    assert.equal(snapshot.games[0].name, "Portal 2");
  });

  it("includes only unlocked achievements that have unlockTime", () => {
    const achievements: SteamSourceAchievement[] = [
      {
        name: "LOCKED",
        unlocked: false,
        unlockTime: "2026-09-08T17:00:00.000Z",
      },
      {
        name: "NO_TIME",
        unlocked: true,
        unlockTime: null,
      },
      {
        name: "ACH.WAKE_UP",
        unlocked: true,
        unlockTime: "2026-09-08T17:00:00.000Z",
      },
    ];

    const snapshot = buildSteamSnapshot(
      [portal],
      new Map([["620", achievements]])
    );

    assert.deepEqual(snapshot.games[0].achievements, [
      {
        name: "ACH.WAKE_UP",
        unlockTime: "2026-09-08T17:00:00.000Z",
      },
    ]);
  });

  it("omits achievements when collection was skipped", () => {
    const snapshot = buildSteamSnapshot([portal, halfLife], new Map());

    assert.equal("achievements" in snapshot.games[0], false);
    assert.equal("achievements" in snapshot.games[1], false);
  });

  it("includes an empty list when collection confirms zero unlocks", () => {
    const snapshot = buildSteamSnapshot([portal], new Map([["620", []]]));

    assert.deepEqual(snapshot.games[0].achievements, []);
  });

  it("omits achievements when one game exceeds the API limit", () => {
    const achievements = Array.from({ length: 2_001 }, (_, index) => ({
      name: `ACH.${index}`,
      unlocked: true,
      unlockTime: "2026-09-08T17:00:00.000Z",
    }));
    const snapshot = buildSteamSnapshot(
      [portal, halfLife],
      new Map([
        ["620", achievements],
        ["220", []],
      ])
    );

    assert.equal("achievements" in snapshot.games[0], false);
    assert.deepEqual(snapshot.games[1].achievements, []);
  });
});
