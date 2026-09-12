import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { isSteamOpenIdSuccessUrl } from "./steam-openid-return.ts";
import {
  parseSteamStoreSessionConfig,
  SteamSessionRequiredError,
} from "./steam-store-session-config.ts";

describe("isSteamOpenIdSuccessUrl", () => {
  it("accepts the Hydra deep link with and without query", () => {
    assert.equal(
      isSteamOpenIdSuccessUrl("hydralauncher://steam-connected"),
      true
    );
    assert.equal(
      isSteamOpenIdSuccessUrl(
        "hydralauncher://steam-connected?lng=en&oauth_linked_provider=steam"
      ),
      true
    );
  });

  it("accepts a Lerna or auth redirect that linked Steam", () => {
    assert.equal(
      isSteamOpenIdSuccessUrl(
        "http://localhost:5173/?oauth_linked_provider=steam"
      ),
      true
    );
  });

  it("rejects unrelated URLs", () => {
    assert.equal(
      isSteamOpenIdSuccessUrl("https://store.steampowered.com/"),
      false
    );
    assert.equal(isSteamOpenIdSuccessUrl("hydralauncher://run?game=1"), false);
    assert.equal(
      isSteamOpenIdSuccessUrl(
        "http://localhost:5173/?oauth_linked_provider=discord"
      ),
      false
    );
  });
});

describe("parseSteamStoreSessionConfig", () => {
  it("reads steamid and webapi_token from application_config", () => {
    assert.deepEqual(
      parseSteamStoreSessionConfig({
        currentUrl: "https://store.steampowered.com/explore/",
        userInfoRaw: JSON.stringify({
          logged_in: true,
          steamid: "76561199208012825",
        }),
        storeConfigRaw: JSON.stringify({ webapi_token: "store-token" }),
      }),
      {
        steamId64: "76561199208012825",
        accessToken: "store-token",
      }
    );
  });

  it("rejects a store login redirect", () => {
    assert.throws(
      () =>
        parseSteamStoreSessionConfig({
          currentUrl: "https://store.steampowered.com/login/",
          userInfoRaw: JSON.stringify({
            logged_in: true,
            steamid: "76561199208012825",
          }),
          storeConfigRaw: JSON.stringify({ webapi_token: "store-token" }),
        }),
      SteamSessionRequiredError
    );
  });

  it("rejects a logged-out store page", () => {
    assert.throws(
      () =>
        parseSteamStoreSessionConfig({
          currentUrl: "https://store.steampowered.com/explore/",
          userInfoRaw: JSON.stringify({ logged_in: false }),
          storeConfigRaw: JSON.stringify({ webapi_token: "store-token" }),
        }),
      SteamSessionRequiredError
    );
  });
});
