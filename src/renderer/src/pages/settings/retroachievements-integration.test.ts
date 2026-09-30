import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getRetroAchievementsConnectErrorField } from "./retroachievements-integration.js";

describe("getRetroAchievementsConnectErrorField", () => {
  it("maps credential errors to their fields", () => {
    assert.equal(
      getRetroAchievementsConnectErrorField(
        "profile/retroachievements-invalid-password"
      ),
      "password"
    );
    assert.equal(
      getRetroAchievementsConnectErrorField(
        "profile/retroachievements-invalid-web-api-key"
      ),
      "webApiKey"
    );
  });

  it("keeps unknown errors at form level", () => {
    assert.equal(
      getRetroAchievementsConnectErrorField("network-error"),
      "form"
    );
  });
});
