import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSteamReconnectRequired } from "./steam-session.js";

describe("isSteamReconnectRequired", () => {
  it("requires reconnect for a missing or mismatched local Steam session", () => {
    assert.equal(isSteamReconnectRequired("steam-session-required"), true);
    assert.equal(isSteamReconnectRequired("steam-account-mismatch"), true);
  });

  it("keeps retryable sync failures on the normal sync action", () => {
    assert.equal(isSteamReconnectRequired("steam-rate-limited"), false);
    assert.equal(isSteamReconnectRequired("steam-profile-private"), false);
    assert.equal(isSteamReconnectRequired(undefined), false);
  });
});
