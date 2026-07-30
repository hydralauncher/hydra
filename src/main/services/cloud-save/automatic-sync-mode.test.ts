import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getCloudSaveAutomaticSyncStateForMode,
  getNextCloudSaveAutomaticSyncMode,
  resolveCloudSaveAutomaticSyncMode,
  shouldRunLegacyAutomaticCloudSave,
  shouldRunV2AutomaticCloudSave,
} from "./automatic-sync-mode.js";

describe("cloud save automatic sync mode", () => {
  it("prefers V2 when both modes are enabled", () => {
    assert.equal(
      resolveCloudSaveAutomaticSyncMode({
        legacyEnabled: true,
        v2Enabled: true,
      }),
      "v2"
    );
  });

  it("selects the enabled implementation", () => {
    assert.equal(
      resolveCloudSaveAutomaticSyncMode({
        legacyEnabled: true,
        v2Enabled: false,
      }),
      "legacy"
    );
    assert.equal(
      resolveCloudSaveAutomaticSyncMode({
        legacyEnabled: false,
        v2Enabled: true,
      }),
      "v2"
    );
  });

  it("allows both implementations to be disabled", () => {
    assert.equal(
      resolveCloudSaveAutomaticSyncMode({
        legacyEnabled: false,
        v2Enabled: false,
      }),
      "disabled"
    );
  });

  it("enabling legacy disables V2", () => {
    assert.equal(
      getNextCloudSaveAutomaticSyncMode("v2", "legacy", true),
      "legacy"
    );
    assert.deepEqual(getCloudSaveAutomaticSyncStateForMode("legacy"), {
      legacyEnabled: true,
      v2Enabled: false,
    });
  });

  it("enabling V2 disables legacy", () => {
    assert.equal(getNextCloudSaveAutomaticSyncMode("legacy", "v2", true), "v2");
    assert.deepEqual(getCloudSaveAutomaticSyncStateForMode("v2"), {
      legacyEnabled: false,
      v2Enabled: true,
    });
  });

  it("disabling one mode preserves the other mode", () => {
    assert.equal(
      getNextCloudSaveAutomaticSyncMode("v2", "legacy", false),
      "v2"
    );
    assert.equal(
      getNextCloudSaveAutomaticSyncMode("legacy", "v2", false),
      "legacy"
    );
  });

  it("disabling the selected mode leaves both disabled", () => {
    assert.equal(
      getNextCloudSaveAutomaticSyncMode("legacy", "legacy", false),
      "disabled"
    );
    assert.equal(
      getNextCloudSaveAutomaticSyncMode("v2", "v2", false),
      "disabled"
    );
  });

  it("routes lifecycle work to exactly one implementation", () => {
    for (const mode of ["disabled", "legacy", "v2"] as const) {
      const legacyRuns = shouldRunLegacyAutomaticCloudSave(mode);
      const v2Runs = shouldRunV2AutomaticCloudSave(mode);

      assert.notEqual(legacyRuns && v2Runs, true);
      assert.equal(legacyRuns || v2Runs, mode !== "disabled");
    }
  });
});
