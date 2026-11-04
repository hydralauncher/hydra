import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mapSteamClientAchievements,
  steamClientSuccessPercentage,
  // @ts-ignore The Node ESM test runner requires the source extension.
} from "./steam-client-achievements.ts";

const schema = {
  "730": {
    stats: {
      "1": { type: "4", name: "plain_stat" },
      "2": {
        type: "4",
        bits: {
          "0": { name: "FIRST_WIN" },
          "1": { name: "SECOND_WIN" },
        },
      },
      "3": { type: "4", bits: { "0": { name: "OTHER_GROUP" } } },
    },
  },
};

describe("mapSteamClientAchievements", () => {
  it("maps schema bits to unlock times", () => {
    assert.deepEqual(
      mapSteamClientAchievements(schema, [
        { achievement_id: 2, unlock_time: [0, 1700000000] },
      ]),
      [
        { apiname: "FIRST_WIN", achieved: 0, unlocktime: 0 },
        { apiname: "SECOND_WIN", achieved: 1, unlocktime: 1700000000 },
        { apiname: "OTHER_GROUP", achieved: 0, unlocktime: 0 },
      ]
    );
  });

  it("reads stats and bits parsed as arrays", () => {
    assert.deepEqual(
      mapSteamClientAchievements(
        {
          "1": {
            stats: [{ bits: [{ name: "ARRAY_BIT" }] }],
          },
        },
        [{ achievement_id: 0, unlock_time: [1700000000] }]
      ),
      [{ apiname: "ARRAY_BIT", achieved: 1, unlocktime: 1700000000 }]
    );
  });

  it("returns nothing when the schema has no achievements", () => {
    assert.deepEqual(
      mapSteamClientAchievements({ "1": { stats: {} } }, []),
      []
    );
    assert.deepEqual(mapSteamClientAchievements(null, []), []);
  });
});

describe("steamClientSuccessPercentage", () => {
  it("ignores games without achievements", () => {
    assert.equal(
      steamClientSuccessPercentage({
        client: 19,
        noAchievements: 50,
        scrape: 1,
      }),
      95
    );
  });

  it("treats a run with nothing to fetch as a full success", () => {
    assert.equal(
      steamClientSuccessPercentage({ client: 0, noAchievements: 3, scrape: 0 }),
      100
    );
  });
});
