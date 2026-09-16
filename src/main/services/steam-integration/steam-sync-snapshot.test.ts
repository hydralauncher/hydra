import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SteamSourceAchievement, SteamSourceLibraryGame } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  buildLegacySteamSnapshot,
  buildSteamSnapshot,
  chunkSteamGameSyncPayload,
  chunkSteamSnapshot,
  uploadSteamSnapshotChunks,
} from "./steam-sync-snapshot.ts";

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

  it("keeps achievements when one game exceeds a single API chunk", () => {
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

    assert.equal(snapshot.games[0].achievements?.length, 2_001);
    assert.deepEqual(snapshot.games[1].achievements, []);
  });
});

const unlockedAchievements = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    name: `ACH.${index}`,
    unlockTime: "2026-09-08T17:00:00.000Z",
  }));

describe("chunkSteamSnapshot", () => {
  it("produces one chunk for an empty snapshot", () => {
    assert.deepEqual(chunkSteamSnapshot({ games: [] }), [
      { totalChunks: 1, games: [] },
    ]);
  });

  it("keeps exactly 2,000 achievements in one chunk", () => {
    const chunks = chunkSteamSnapshot({
      games: [{ ...portal, achievements: unlockedAchievements(2_000) }],
    });

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].games[0].achievements?.length, 2_000);
  });

  it("splits 2,001 and 4,001 achievements deterministically", () => {
    for (const [count, expectedSizes] of [
      [2_001, [2_000, 1]],
      [4_001, [2_000, 2_000, 1]],
    ] as const) {
      const chunks = chunkSteamSnapshot({
        games: [{ ...portal, achievements: unlockedAchievements(count) }],
      });

      assert.deepEqual(
        chunks.map((chunk) => chunk.games[0].achievements?.length),
        expectedSizes
      );
      assert.equal(
        chunks.every((chunk) => chunk.totalChunks === chunks.length),
        true
      );
    }
  });

  it("packs multiple games while preserving omitted and empty achievements", () => {
    const chunks = chunkSteamSnapshot({
      games: [
        { ...portal, achievements: unlockedAchievements(1_500) },
        { ...halfLife, achievements: unlockedAchievements(501) },
        { ...portal, steamAppId: "10" },
        { ...halfLife, steamAppId: "20", achievements: [] },
      ],
    });

    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].games[0].steamAppId, "620");
    assert.equal(chunks[0].games[1].achievements?.length, 500);
    assert.equal(chunks[1].games[0].achievements?.length, 1);
    assert.equal("achievements" in chunks[1].games[1], false);
    assert.deepEqual(chunks[1].games[2].achievements, []);
  });
});

describe("buildLegacySteamSnapshot", () => {
  it("omits oversized achievement lists without truncating them", () => {
    const snapshot = buildLegacySteamSnapshot({
      games: [
        { ...portal, achievements: unlockedAchievements(2_001) },
        { ...halfLife, achievements: unlockedAchievements(2_000) },
      ],
    });

    assert.equal("achievements" in snapshot.games[0], false);
    assert.equal(snapshot.games[1].achievements?.length, 2_000);
  });

  it("preserves omitted and confirmed-empty achievement states", () => {
    const snapshot = buildLegacySteamSnapshot({
      games: [portal, { ...halfLife, achievements: [] }],
    });

    assert.equal("achievements" in snapshot.games[0], false);
    assert.deepEqual(snapshot.games[1].achievements, []);
  });
});

describe("chunkSteamGameSyncPayload", () => {
  it("splits exit-sync achievements into additive API calls", () => {
    const chunks = chunkSteamGameSyncPayload({
      playTimeInSeconds: 3600,
      lastPlayedAt: portal.lastPlayedAt,
      achievements: unlockedAchievements(4_001),
    });

    assert.deepEqual(
      chunks.map((chunk) => chunk.achievements?.length),
      [2_000, 2_000, 1]
    );
    assert.equal(
      chunks.every((chunk) => chunk.playTimeInSeconds === 3600),
      true
    );
  });
});

describe("uploadSteamSnapshotChunks", () => {
  it("uploads chunks in order before commit", async () => {
    const chunks = chunkSteamSnapshot({
      games: [{ ...portal, achievements: unlockedAchievements(2_001) }],
    });
    const calls: string[] = [];

    await uploadSteamSnapshotChunks(
      chunks,
      async (_chunk, index) => {
        calls.push(`chunk:${index}`);
      },
      async () => {
        calls.push("commit");
      }
    );

    assert.deepEqual(calls, ["chunk:0", "chunk:1", "commit"]);
  });

  it("does not commit after a chunk upload fails", async () => {
    const chunks = chunkSteamSnapshot({
      games: [{ ...portal, achievements: unlockedAchievements(2_001) }],
    });
    let committed = false;

    await assert.rejects(
      uploadSteamSnapshotChunks(
        chunks,
        async (_chunk, index) => {
          if (index === 1) throw new Error("upload failed");
        },
        async () => {
          committed = true;
        }
      ),
      /upload failed/
    );
    assert.equal(committed, false);
  });
});
