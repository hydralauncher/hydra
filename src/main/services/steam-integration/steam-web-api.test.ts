import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  SteamWebApiHttpError,
  fetchSteamFamilyGroupForUser,
  fetchSteamFamilyPlaytimeSummary,
  fetchSteamGameAchievementSchema,
  fetchSteamLastPlayedTimes,
  fetchSteamOwnedGames,
  fetchSteamOwnedGame,
  fetchSteamSharedLibraryApps,
} from "./steam-web-api.ts";

const token = {
  steamId64: "76561199208012825",
  accessToken: "store-token",
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("Steam Web API client", () => {
  it("calls GetOwnedGames with the store access token", async () => {
    const envelope = {
      response: {
        game_count: 1,
        games: [{ appid: 620, name: "Portal 2", playtime_forever: 60 }],
      },
    };

    const response = await fetchSteamOwnedGames(token, undefined, (input) => {
      const url = new URL(String(input));
      assert.equal(
        url.origin + url.pathname,
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/"
      );
      assert.equal(url.searchParams.get("access_token"), token.accessToken);
      assert.equal(url.searchParams.get("steamid"), token.steamId64);
      assert.equal(url.searchParams.get("include_appinfo"), "1");
      assert.equal(url.searchParams.get("key"), null);
      return Promise.resolve(jsonResponse(200, envelope));
    });

    assert.deepEqual(response, envelope);
  });

  it("filters GetOwnedGames to one app for incremental sync", async () => {
    await fetchSteamOwnedGame(token, "620", undefined, (input) => {
      const url = new URL(String(input));
      assert.deepEqual(JSON.parse(url.searchParams.get("input_json")!), {
        include_appinfo: true,
        include_played_free_games: true,
        appids_filter: [620],
      });
      return Promise.resolve(jsonResponse(200, { response: { games: [] } }));
    });
  });

  it("calls GetGameAchievements with the store access token and no steamid", async () => {
    const envelope = {
      response: {
        achievements: [
          {
            internal_name: "NEW_ACHIEVEMENT_1_1",
            localized_name: "Welcome to the City of the Dead",
          },
        ],
      },
    };

    const response = await fetchSteamGameAchievementSchema(
      token,
      "883710",
      undefined,
      (input) => {
        const url = new URL(String(input));
        assert.equal(
          url.origin + url.pathname,
          "https://api.steampowered.com/IPlayerService/GetGameAchievements/v1/"
        );
        assert.equal(url.searchParams.get("access_token"), token.accessToken);
        assert.equal(url.searchParams.get("appid"), "883710");
        assert.equal(url.searchParams.get("language"), "english");
        assert.equal(url.searchParams.get("steamid"), null);
        assert.equal(url.searchParams.get("key"), null);
        return Promise.resolve(jsonResponse(200, envelope));
      }
    );

    assert.deepEqual(response, envelope);
  });

  it("calls GetFamilyGroupForUser with the store access token and no steamid", async () => {
    const envelope = { response: { family_groupid: "12345" } };

    const response = await fetchSteamFamilyGroupForUser(
      token,
      undefined,
      (input) => {
        const url = new URL(String(input));
        assert.equal(
          url.origin + url.pathname,
          "https://api.steampowered.com/IFamilyGroupsService/GetFamilyGroupForUser/v1/"
        );
        assert.equal(url.searchParams.get("access_token"), token.accessToken);
        assert.equal(url.searchParams.get("steamid"), null);
        assert.equal(url.searchParams.get("key"), null);
        return Promise.resolve(jsonResponse(200, envelope));
      }
    );

    assert.deepEqual(response, envelope);
  });

  it("calls GetSharedLibraryApps with the family group and no steamid", async () => {
    const envelope = {
      response: { apps: [{ appid: 2947610, name: "SILENT HILL 2" }] },
    };

    const response = await fetchSteamSharedLibraryApps(
      token,
      "12345",
      undefined,
      (input) => {
        const url = new URL(String(input));
        assert.equal(
          url.origin + url.pathname,
          "https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/"
        );
        assert.equal(url.searchParams.get("access_token"), token.accessToken);
        assert.equal(url.searchParams.get("family_groupid"), "12345");
        assert.equal(url.searchParams.get("include_own"), "0");
        assert.equal(url.searchParams.get("include_excluded"), "0");
        assert.equal(url.searchParams.get("include_free"), "0");
        assert.equal(url.searchParams.get("include_non_games"), "0");
        assert.equal(url.searchParams.get("language"), "english");
        assert.equal(url.searchParams.get("steamid"), null);
        assert.equal(url.searchParams.get("key"), null);
        return Promise.resolve(jsonResponse(200, envelope));
      }
    );

    assert.deepEqual(response, envelope);
  });

  it("calls GetPlaytimeSummary with the family group and no steamid", async () => {
    const envelope = { response: { entries: [] } };

    const response = await fetchSteamFamilyPlaytimeSummary(
      token,
      "12345",
      undefined,
      (input) => {
        const url = new URL(String(input));
        assert.equal(
          url.origin + url.pathname,
          "https://api.steampowered.com/IFamilyGroupsService/GetPlaytimeSummary/v1/"
        );
        assert.equal(url.searchParams.get("access_token"), token.accessToken);
        assert.equal(url.searchParams.get("family_groupid"), "12345");
        assert.equal(
          url.searchParams.get("input_json"),
          JSON.stringify({ family_groupid: "12345" })
        );
        assert.equal(url.searchParams.get("steamid"), null);
        assert.equal(url.searchParams.get("key"), null);
        return Promise.resolve(jsonResponse(200, envelope));
      }
    );

    assert.deepEqual(response, envelope);
  });

  it("calls ClientGetLastPlayedTimes with the store access token and no steamid", async () => {
    const envelope = {
      response: {
        games: [
          {
            appid: 2947610,
            playtime_forever: 60,
            last_playtime: 1_694_196_000,
          },
        ],
      },
    };

    const response = await fetchSteamLastPlayedTimes(
      token,
      undefined,
      (input) => {
        const url = new URL(String(input));
        assert.equal(
          url.origin + url.pathname,
          "https://api.steampowered.com/IPlayerService/ClientGetLastPlayedTimes/v1/"
        );
        assert.equal(url.searchParams.get("access_token"), token.accessToken);
        assert.equal(url.searchParams.get("steamid"), null);
        assert.equal(url.searchParams.get("key"), null);
        return Promise.resolve(jsonResponse(200, envelope));
      }
    );

    assert.deepEqual(response, envelope);
  });

  it("throws SteamWebApiHttpError on non-2xx", async () => {
    await assert.rejects(
      () =>
        fetchSteamOwnedGames(token, undefined, () =>
          Promise.resolve(jsonResponse(429, { message: "rate" }))
        ),
      (error: unknown) => {
        assert.ok(error instanceof SteamWebApiHttpError);
        assert.equal(error.status, 429);
        return true;
      }
    );
  });
});
