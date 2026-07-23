import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCloudSaveAccessAction } from "./cloud-save-access.js";

describe("cloud save access", () => {
  it("sends unauthenticated users to sign in", () => {
    assert.equal(getCloudSaveAccessAction(false, false), "sign-in");
  });

  it("sends authenticated users without a subscription to the paywall", () => {
    assert.equal(getCloudSaveAccessAction(true, false), "paywall");
  });

  it("opens cloud saves only for active subscribers", () => {
    assert.equal(getCloudSaveAccessAction(true, true), "open");
  });
});
