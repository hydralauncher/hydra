import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  isSkippedSteamLibraryTitle,
  parseSteamSourceAchievements,
  parseSteamSourceLibrary,
} from "./steam-source-payload.ts";

const portalSpec = {
  steamAppId: "620",
  name: "Portal 2",
  playTimeInSeconds: 3600,
  lastPlayedAt: "2026-09-08T18:00:00.000Z",
};

describe("parseSteamSourceLibrary", () => {
  it("reads the OpenAPI { games } object", () => {
    assert.deepEqual(parseSteamSourceLibrary({ games: [portalSpec] }), [
      portalSpec,
    ]);
  });

  it("reads a root array", () => {
    assert.deepEqual(parseSteamSourceLibrary([portalSpec]), [portalSpec]);
  });

  it("returns an empty list when games is missing or null", () => {
    assert.deepEqual(parseSteamSourceLibrary({}), []);
    assert.deepEqual(parseSteamSourceLibrary({ games: null }), []);
    assert.deepEqual(parseSteamSourceLibrary(undefined), []);
  });

  it("reads the Steam GetOwnedGames envelope and converts fields", () => {
    const lastPlayedUnix = 1_694_196_000;

    assert.deepEqual(
      parseSteamSourceLibrary({
        response: {
          game_count: 1,
          games: [
            {
              appid: 620,
              name: "Portal 2",
              playtime_forever: 60,
              rtime_last_played: lastPlayedUnix,
            },
          ],
        },
      }),
      [
        {
          steamAppId: "620",
          name: "Portal 2",
          playTimeInSeconds: 3600,
          lastPlayedAt: new Date(lastPlayedUnix * 1000).toISOString(),
        },
      ]
    );
  });

  it("adds playtime_disconnected minutes to playtime_forever", () => {
    assert.deepEqual(
      parseSteamSourceLibrary({
        response: {
          games: [
            {
              appid: 620,
              name: "Portal 2",
              playtime_forever: 7740,
              playtime_disconnected: 2400,
            },
          ],
        },
      }),
      [
        {
          steamAppId: "620",
          name: "Portal 2",
          playTimeInSeconds: (7740 + 2400) * 60,
          lastPlayedAt: null,
        },
      ]
    );
  });

  it("drops games without a valid steamAppId", () => {
    assert.deepEqual(
      parseSteamSourceLibrary({
        games: [
          { name: "Unknown", playTimeInSeconds: 0, lastPlayedAt: null },
          {
            steamAppId: "0",
            name: "Invalid",
            playTimeInSeconds: 0,
            lastPlayedAt: null,
          },
        ],
      }),
      []
    );
  });
});

describe("parseSteamSourceAchievements", () => {
  it("reads the OpenAPI { achievements } object", () => {
    const achievements = [
      {
        name: "ACH.WAKE_UP",
        unlocked: true,
        unlockTime: "2026-09-08T17:00:00.000Z",
      },
      { name: "LOCKED", unlocked: false, unlockTime: null },
    ];

    assert.deepEqual(
      parseSteamSourceAchievements({ achievements }),
      achievements
    );
  });

  it("reads a root array", () => {
    const achievements = [
      { name: "ACH.WAKE_UP", unlocked: false, unlockTime: null },
    ];

    assert.deepEqual(parseSteamSourceAchievements(achievements), achievements);
  });

  it("reads the Steam playerstats envelope and converts fields", () => {
    const unlockUnix = 1_694_196_000;

    assert.deepEqual(
      parseSteamSourceAchievements({
        playerstats: {
          steamID: "76561198000000000",
          achievements: [
            { apiname: "ACH.WAKE_UP", achieved: 1, unlocktime: unlockUnix },
            { apiname: "LOCKED", achieved: 0, unlocktime: 0 },
          ],
        },
      }),
      [
        {
          name: "ACH.WAKE_UP",
          unlocked: true,
          unlockTime: new Date(unlockUnix * 1000).toISOString(),
        },
        { name: "LOCKED", unlocked: false, unlockTime: null },
      ]
    );
  });

  it("returns an empty list when achievements are missing", () => {
    assert.deepEqual(parseSteamSourceAchievements({}), []);
    assert.deepEqual(parseSteamSourceAchievements({ achievements: null }), []);
  });
});

describe("isSkippedSteamLibraryTitle", () => {
  it("skips demos and playtests without matching ordinary titles", () => {
    assert.equal(isSkippedSteamLibraryTitle("FINAL FANTASY XVI Demo"), true);
    assert.equal(isSkippedSteamLibraryTitle("Game (Demo)"), true);
    assert.equal(isSkippedSteamLibraryTitle("Game Name Playtest"), true);
    assert.equal(isSkippedSteamLibraryTitle("Game Name Play Test"), true);
    assert.equal(isSkippedSteamLibraryTitle("Game Name Play-Test"), true);
    assert.equal(isSkippedSteamLibraryTitle("Playtest"), true);
    assert.equal(isSkippedSteamLibraryTitle("Battlefield™ Open Beta"), true);
    assert.equal(isSkippedSteamLibraryTitle("Game PTB"), true);
    assert.equal(isSkippedSteamLibraryTitle("For Honor - Public Test"), true);
    assert.equal(isSkippedSteamLibraryTitle("PUBG: Test Server"), true);
    assert.equal(isSkippedSteamLibraryTitle("Portal 2"), false);
    assert.equal(isSkippedSteamLibraryTitle("Demolition Derby"), false);
    assert.equal(isSkippedSteamLibraryTitle("Bethesda"), false);
    assert.equal(isSkippedSteamLibraryTitle("Test Drive"), false);
  });
});
