import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SteamAppDetails } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { parseSteamAppDetailsResponse } from "./steam-app-details.ts";

const details = (steam_appid: number) =>
  ({
    steam_appid,
    name: "Marvel's Spider-Man: Miles Morales",
    about_the_game: "Game description",
  }) as SteamAppDetails;

describe("parseSteamAppDetailsResponse", () => {
  it("accepts the usual response keyed by the requested app ID", () => {
    const game = details(1817190);

    assert.deepEqual(
      parseSteamAppDetailsResponse(
        { "1817190": { success: true, data: game } },
        "1817190"
      ),
      { ...game, objectId: "1817190" }
    );
  });

  it("accepts game details keyed by a related DLC ID", () => {
    const game = details(1817190);

    assert.deepEqual(
      parseSteamAppDetailsResponse(
        { "2133610": { success: true, data: game } },
        "1817190"
      ),
      { ...game, objectId: "1817190" }
    );
  });

  it("does not return a different game even when the outer key matches", () => {
    assert.equal(
      parseSteamAppDetailsResponse(
        { "1817190": { success: true, data: details(2133610) } },
        "1817190"
      ),
      null
    );
  });

  it("returns null for unsuccessful or missing details", () => {
    assert.equal(
      parseSteamAppDetailsResponse(
        { "1817190": { success: false } },
        "1817190"
      ),
      null
    );
    assert.equal(parseSteamAppDetailsResponse({}, "1817190"), null);
  });
});
