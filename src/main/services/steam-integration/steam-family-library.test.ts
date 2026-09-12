import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SteamSourceLibraryGame } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  mergeSteamFamilyPlaytimeMaps,
  mergeSteamOwnedAndFamilyGames,
  parseSteamFamilyGroupId,
  parseSteamFamilyPlaytimeByAppId,
  parseSteamLastPlayedTimes,
  parseSteamSharedLibraryApps,
  playtimeMapFromSharedApps,
} from "./steam-family-library.ts";

const steamId64 = "76561199208012825";
const friendSteamId64 = "76561198000000000";

const portal: SteamSourceLibraryGame = {
  steamAppId: "620",
  name: "Portal 2",
  playTimeInSeconds: 3600,
  lastPlayedAt: "2026-09-08T18:00:00.000Z",
};

describe("parseSteamFamilyGroupId", () => {
  it("reads the family group id from the Steam envelope", () => {
    assert.equal(
      parseSteamFamilyGroupId({ response: { family_groupid: "12345" } }),
      "12345"
    );
  });

  it("returns null when the account is not in a family group", () => {
    assert.equal(
      parseSteamFamilyGroupId({
        response: {
          family_groupid: "0",
          is_not_member_of_any_group: true,
        },
      }),
      null
    );
    assert.equal(parseSteamFamilyGroupId({ family_groupid: "0" }), null);
    assert.equal(parseSteamFamilyGroupId({}), null);
    assert.equal(parseSteamFamilyGroupId(undefined), null);
  });
});

describe("parseSteamSharedLibraryApps", () => {
  it("reads shareable family games and viewer playtime", () => {
    const lastPlayedUnix = 1_694_196_000;

    assert.deepEqual(
      parseSteamSharedLibraryApps({
        response: {
          apps: [
            {
              appid: 2947610,
              name: "SILENT HILL 2",
              owner_steamids: [friendSteamId64],
              exclude_reason: 0,
              app_type: 1,
              rt_playtime: 90,
              rt_last_played: lastPlayedUnix,
            },
            {
              appid: 220,
              name: "Half-Life 2",
              rt_playtime: 999,
            },
          ],
        },
      }),
      [
        {
          steamAppId: "2947610",
          name: "SILENT HILL 2",
          playTimeInSeconds: 5400,
          lastPlayedAt: new Date(lastPlayedUnix * 1000).toISOString(),
        },
        {
          steamAppId: "220",
          name: "Half-Life 2",
          playTimeInSeconds: 59_940,
          lastPlayedAt: null,
        },
      ]
    );
  });

  it("keeps games with no app_type or exclude_reason", () => {
    assert.deepEqual(
      parseSteamSharedLibraryApps({
        apps: [{ appid: 220, name: "Half-Life 2" }],
      }),
      [
        {
          steamAppId: "220",
          name: "Half-Life 2",
          playTimeInSeconds: 0,
          lastPlayedAt: null,
        },
      ]
    );
  });

  it("drops excluded apps, non-games, and nameless apps", () => {
    assert.deepEqual(
      parseSteamSharedLibraryApps({
        apps: [
          {
            appid: 2947610,
            name: "SILENT HILL 2",
            exclude_reason: 2,
            app_type: 1,
          },
          { appid: 480, name: "Soundtrack", app_type: 4 },
          { appid: 10, name: "   " },
          { name: "Unknown" },
        ],
      }),
      []
    );
  });
});

describe("parseSteamFamilyPlaytimeByAppId", () => {
  it("keeps playtime for the connected Steam account only", () => {
    const lastPlayedUnix = 1_694_196_000;
    const playtimeByAppId = parseSteamFamilyPlaytimeByAppId(
      {
        response: {
          entries: [
            {
              steamid: steamId64,
              appid: 2947610,
              seconds: 5400,
              latest_played: lastPlayedUnix,
            },
            {
              steamid: friendSteamId64,
              appid: 2947610,
              seconds: 90_000,
              latest_played: lastPlayedUnix,
            },
          ],
        },
      },
      steamId64
    );

    assert.deepEqual(playtimeByAppId.get("2947610"), {
      playTimeInSeconds: 5400,
      lastPlayedAt: new Date(lastPlayedUnix * 1000).toISOString(),
    });
    assert.equal(playtimeByAppId.size, 1);
  });

  it("reads playtime_forever as minutes and entries_by_owner", () => {
    const playtimeByAppId = parseSteamFamilyPlaytimeByAppId(
      {
        response: {
          entries_by_owner: [
            {
              steamid: steamId64,
              appid: 220,
              playtime_forever: 15,
              first_played: 1_694_196_000,
            },
          ],
        },
      },
      steamId64
    );

    assert.deepEqual(playtimeByAppId.get("220"), {
      playTimeInSeconds: 900,
      lastPlayedAt: new Date(1_694_196_000 * 1000).toISOString(),
    });
  });

  it("treats a missing steamid as the connected account", () => {
    const playtimeByAppId = parseSteamFamilyPlaytimeByAppId(
      {
        response: {
          entries: [{ appid: 2947610, seconds_played: 5400 }],
        },
      },
      steamId64
    );

    assert.deepEqual(playtimeByAppId.get("2947610"), {
      playTimeInSeconds: 5400,
      lastPlayedAt: null,
    });
  });

  it("ignores a friend's string steamid even when seconds are present", () => {
    const playtimeByAppId = parseSteamFamilyPlaytimeByAppId(
      {
        response: {
          entries: [
            {
              steamid: friendSteamId64,
              appid: 2947610,
              seconds_played: 90_000,
            },
          ],
        },
      },
      steamId64
    );

    assert.equal(playtimeByAppId.size, 0);
  });
});

describe("parseSteamLastPlayedTimes", () => {
  it("reads playtime_forever as minutes", () => {
    const lastPlayedUnix = 1_694_196_000;
    const playtimeByAppId = parseSteamLastPlayedTimes({
      response: {
        games: [
          {
            appid: 2947610,
            playtime_forever: 60,
            last_playtime: lastPlayedUnix,
          },
        ],
      },
    });

    assert.deepEqual(playtimeByAppId.get("2947610"), {
      playTimeInSeconds: 3600,
      lastPlayedAt: new Date(lastPlayedUnix * 1000).toISOString(),
    });
  });
});

describe("mergeSteamFamilyPlaytimeMaps", () => {
  it("keeps the higher playtime per app", () => {
    const shared = playtimeMapFromSharedApps([
      {
        steamAppId: "2947610",
        name: "SILENT HILL 2",
        playTimeInSeconds: 1200,
        lastPlayedAt: null,
      },
    ]);
    const lastPlayed = parseSteamLastPlayedTimes({
      games: [{ appid: 2947610, playtime_forever: 60 }],
    });

    assert.deepEqual(
      mergeSteamFamilyPlaytimeMaps(shared, lastPlayed).get("2947610"),
      {
        playTimeInSeconds: 3600,
        lastPlayedAt: null,
      }
    );
  });
});

describe("mergeSteamOwnedAndFamilyGames", () => {
  it("keeps owned playtime when the same app is in the family library", () => {
    const familyPlaytime = new Map([
      [
        "620",
        {
          playTimeInSeconds: 60,
          lastPlayedAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    ]);

    assert.deepEqual(
      mergeSteamOwnedAndFamilyGames(
        [portal],
        [
          {
            steamAppId: "620",
            name: "Portal 2 Family",
            playTimeInSeconds: 60,
            lastPlayedAt: "2020-01-01T00:00:00.000Z",
          },
        ],
        familyPlaytime
      ),
      [portal]
    );
  });

  it("adds every family game, including titles with no playtime", () => {
    const lastPlayedAt = "2026-09-08T18:00:00.000Z";
    const familyPlaytime = new Map([
      [
        "2947610",
        {
          playTimeInSeconds: 5400,
          lastPlayedAt,
        },
      ],
    ]);

    assert.deepEqual(
      mergeSteamOwnedAndFamilyGames(
        [portal],
        [
          {
            steamAppId: "2947610",
            name: "SILENT HILL 2",
            playTimeInSeconds: 0,
            lastPlayedAt: null,
          },
          {
            steamAppId: "1245620",
            name: "ELDEN RING",
            playTimeInSeconds: 0,
            lastPlayedAt: null,
          },
        ],
        familyPlaytime
      ),
      [
        portal,
        {
          steamAppId: "2947610",
          name: "SILENT HILL 2",
          playTimeInSeconds: 5400,
          lastPlayedAt,
        },
        {
          steamAppId: "1245620",
          name: "ELDEN RING",
          playTimeInSeconds: 0,
          lastPlayedAt: null,
        },
      ]
    );
  });

  it("uses shared-app playtime when the overlay map is empty", () => {
    assert.deepEqual(
      mergeSteamOwnedAndFamilyGames(
        [portal],
        [
          {
            steamAppId: "2947610",
            name: "SILENT HILL 2",
            playTimeInSeconds: 5400,
            lastPlayedAt: "2026-09-08T18:00:00.000Z",
          },
        ],
        new Map()
      ),
      [
        portal,
        {
          steamAppId: "2947610",
          name: "SILENT HILL 2",
          playTimeInSeconds: 5400,
          lastPlayedAt: "2026-09-08T18:00:00.000Z",
        },
      ]
    );
  });

  it("returns owned games unchanged when there is no family group", () => {
    assert.deepEqual(mergeSteamOwnedAndFamilyGames([portal], [], new Map()), [
      portal,
    ]);
  });
});
