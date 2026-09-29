import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isManualCloudSaveV2Blocked,
  refreshCloudSaveAfterModeChange,
  supportsCloudSaveV2,
} from "./cloud-save-shops.js";

describe("cloud save V2 shop eligibility", () => {
  it("supports catalogue shops without enabling unrelated game types", () => {
    assert.equal(supportsCloudSaveV2("steam"), true);
    assert.equal(supportsCloudSaveV2("epic"), true);
    assert.equal(supportsCloudSaveV2("custom"), false);
    assert.equal(supportsCloudSaveV2("launchbox"), false);
  });

  it("blocks Epic manual V2 while its legacy automatic mode is active", () => {
    assert.equal(isManualCloudSaveV2Blocked("epic", true, null), true);
    assert.equal(isManualCloudSaveV2Blocked("epic", true, false), true);
    assert.equal(isManualCloudSaveV2Blocked("epic", true, true), false);
    assert.equal(isManualCloudSaveV2Blocked("epic", false, null), false);
    assert.equal(isManualCloudSaveV2Blocked("steam", true, false), false);
  });

  it("does not wait for Epic save discovery after changing mode", async () => {
    let resolveRefresh: (() => void) | undefined;
    const pendingRefresh = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    let refreshStarted = false;

    const changeComplete = refreshCloudSaveAfterModeChange("epic", () => {
      refreshStarted = true;
      return pendingRefresh;
    });
    await changeComplete;
    assert.equal(refreshStarted, true);
    resolveRefresh?.();

    let resolveSteamRefresh: (() => void) | undefined;
    const pendingSteamRefresh = new Promise<void>((resolve) => {
      resolveSteamRefresh = resolve;
    });
    let steamComplete = false;
    const steamChange = refreshCloudSaveAfterModeChange(
      "steam",
      () => pendingSteamRefresh
    ).then(() => {
      steamComplete = true;
    });
    await Promise.resolve();
    assert.equal(steamComplete, false);
    resolveSteamRefresh?.();
    await steamChange;
    assert.equal(steamComplete, true);
  });
});
