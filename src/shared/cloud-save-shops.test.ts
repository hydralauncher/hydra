import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { supportsCloudSaveV2 } from "./cloud-save-shops.js";

describe("cloud save V2 shop eligibility", () => {
  it("supports catalogue shops without enabling unrelated game types", () => {
    assert.equal(supportsCloudSaveV2("steam"), true);
    assert.equal(supportsCloudSaveV2("epic"), true);
    assert.equal(supportsCloudSaveV2("custom"), false);
    assert.equal(supportsCloudSaveV2("launchbox"), false);
  });
});
