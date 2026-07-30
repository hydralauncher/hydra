import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canCreateCloudSaveUploadGuard,
  canUploadCloudSaveAfterLaunch,
  consumeCloudSaveLaunchGuard,
  setCloudSaveLaunchGuard,
  shouldBlockGameLaunchForCloudSave,
} from "./launch-guard.ts";

describe("cloud save launch guard", () => {
  it("is single-use and scoped by game", () => {
    setCloudSaveLaunchGuard("1091500", "steam", {
      environmentId: "environment-a",
      baseRemoteHash: "base",
      uploadAllowed: true,
      createdAt: "2026-07-20T00:00:00.000Z",
    });

    assert.equal(consumeCloudSaveLaunchGuard("other", "steam"), null);
    assert.equal(
      consumeCloudSaveLaunchGuard("1091500", "steam")?.environmentId,
      "environment-a"
    );
    assert.equal(consumeCloudSaveLaunchGuard("1091500", "steam"), null);
  });

  it("blocks failed pre-launch and environment changes", () => {
    const safeGuard = {
      environmentId: "environment-a",
      baseRemoteHash: null,
      uploadAllowed: true,
      createdAt: "2026-07-20T00:00:00.000Z",
    };

    assert.equal(
      canUploadCloudSaveAfterLaunch(safeGuard, "environment-a"),
      true
    );
    assert.equal(
      canUploadCloudSaveAfterLaunch(safeGuard, "environment-b"),
      false
    );
    assert.equal(
      canUploadCloudSaveAfterLaunch(
        { ...safeGuard, uploadAllowed: false },
        "environment-a"
      ),
      false
    );
    assert.equal(canUploadCloudSaveAfterLaunch(null, "environment-a"), false);
  });

  it("creates an upload guard only from the matching pre-launch result", () => {
    const result = {
      trigger: "pre-launch" as const,
      action: "none" as const,
      initialState: "synced" as const,
      finalState: "synced" as const,
      environmentId: "environment-a",
    };

    assert.equal(
      canCreateCloudSaveUploadGuard(true, "environment-a", result),
      true
    );
    assert.equal(
      canCreateCloudSaveUploadGuard(true, "environment-b", result),
      false
    );
    assert.equal(
      canCreateCloudSaveUploadGuard(true, "environment-a", {
        ...result,
        trigger: "environment-changed",
      }),
      false
    );
    assert.equal(
      canCreateCloudSaveUploadGuard(false, "environment-a", result),
      false
    );
  });

  it("blocks launch only for a pre-launch cloud save conflict", () => {
    const conflict = {
      trigger: "pre-launch" as const,
      action: "conflict" as const,
      initialState: "conflict" as const,
      finalState: "conflict" as const,
    };

    assert.equal(shouldBlockGameLaunchForCloudSave(conflict), true);
    assert.equal(
      shouldBlockGameLaunchForCloudSave({
        ...conflict,
        trigger: "environment-changed",
      }),
      false
    );
    assert.equal(
      shouldBlockGameLaunchForCloudSave({
        ...conflict,
        action: "none",
        initialState: "synced",
        finalState: "synced",
      }),
      false
    );
    assert.equal(shouldBlockGameLaunchForCloudSave(null), false);
  });
});
