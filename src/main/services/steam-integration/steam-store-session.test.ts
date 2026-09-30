import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  completeSteamOpenIdConnection,
  isSteamOpenIdSuccessUrl,
  parseSteamOpenIdErrorBody,
  parseSteamOpenIdReturn,
} from "./steam-openid-return.ts";
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

describe("parseSteamOpenIdReturn", () => {
  it("treats an already-linked Steam account as an error, not a success", () => {
    assert.deepEqual(
      parseSteamOpenIdReturn(
        "hydralauncher://steam-connected?error=oauth-provider-already-linked"
      ),
      { kind: "error", code: "already-linked" }
    );
    assert.equal(
      isSteamOpenIdSuccessUrl(
        "hydralauncher://steam-connected?error=oauth-provider-already-linked"
      ),
      false
    );
  });

  it("reads already-linked from a Hydra API error page", () => {
    assert.deepEqual(
      parseSteamOpenIdReturn(
        "https://hydra-api.hydralauncher.gg/profile/oauth/steam/callback?error=oauth-provider-already-linked"
      ),
      { kind: "error", code: "already-linked" }
    );
  });

  it("treats a steam-connected deep link with another error as generic", () => {
    assert.deepEqual(
      parseSteamOpenIdReturn("hydralauncher://steam-connected?error=timeout"),
      { kind: "error", code: "generic" }
    );
  });
});

describe("completeSteamOpenIdConnection", () => {
  it("clears a reconnect requirement before notifying the renderer", () => {
    const calls: string[] = [];

    completeSteamOpenIdConnection({
      clearReconnectRequired: () => calls.push("clear"),
      notifyConnected: () => calls.push("notify"),
    });

    assert.deepEqual(calls, ["clear", "notify"]);
  });
});

describe("parseSteamOpenIdErrorBody", () => {
  it("reads already-linked from the Hydra API JSON body", () => {
    assert.deepEqual(
      parseSteamOpenIdErrorBody(
        '{"message":"auth/oauth-provider-already-linked"}'
      ),
      { kind: "error", code: "already-linked" }
    );
  });

  it("ignores HTML and unrelated JSON", () => {
    assert.equal(parseSteamOpenIdErrorBody("<html>Steam login</html>"), null);
    assert.equal(
      parseSteamOpenIdErrorBody('{"message":"auth/invalid-token"}'),
      null
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
