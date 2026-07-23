import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as presentationModule from "./cloud-save-presentation.ts";

const { getCloudSavePanelAction, getCloudSavePresentation } =
  presentationModule;

const presentation = (
  overrides: Partial<Parameters<typeof getCloudSavePresentation>[0]> = {}
) =>
  getCloudSavePresentation({
    canUseCloudSaves: true,
    hasExecutablePath: true,
    isChecking: false,
    isSyncing: false,
    hasError: false,
    state: "untracked",
    progressStage: null,
    ...overrides,
  });

describe("cloud save presentation", () => {
  it("uses the neutral cloud label when access or setup is unavailable", () => {
    assert.deepEqual(presentation({ canUseCloudSaves: false }), {
      labelKey: "cloud_save",
      icon: "cloud-slash",
      tone: "neutral",
    });
    assert.deepEqual(presentation({ hasExecutablePath: false }), {
      labelKey: "cloud_save",
      icon: "cloud-slash",
      tone: "neutral",
    });
  });

  it("shows checking and active transfer progress consistently", () => {
    assert.equal(presentation({ isChecking: true }).icon, "spinner");
    assert.deepEqual(
      presentation({
        isSyncing: true,
        hasError: true,
        progressStage: "uploading",
      }),
      {
        labelKey: "cloud_save_v2_syncing",
        icon: "upload",
        tone: "neutral",
      }
    );
    assert.equal(
      presentation({
        isSyncing: true,
        progressStage: "restoring",
      }).icon,
      "restore"
    );
  });

  it("ignores stale progress when no synchronization is active", () => {
    assert.deepEqual(
      presentation({
        hasError: true,
        progressStage: "uploading",
      }),
      {
        labelKey: "cloud_save_v2_unavailable",
        icon: "cloud-x",
        tone: "neutral",
      }
    );
  });

  it("maps every persisted state to its intended presentation", () => {
    assert.deepEqual(presentation({ state: "synced" }), {
      labelKey: "cloud_save_v2_synced",
      icon: "synced",
      tone: "synced",
    });
    assert.deepEqual(presentation({ state: "local-ahead" }), {
      labelKey: "cloud_save_v2_outdated",
      icon: "warning",
      tone: "outdated",
    });
    assert.deepEqual(presentation({ state: "remote-ahead" }), {
      labelKey: "cloud_save_v2_outdated",
      icon: "warning",
      tone: "outdated",
    });
    assert.deepEqual(presentation({ state: "partial" }), {
      labelKey: "cloud_save_v2_partial",
      icon: "warning",
      tone: "outdated",
    });
    assert.deepEqual(presentation({ state: "conflict" }), {
      labelKey: "cloud_save_v2_conflict",
      icon: "warning",
      tone: "conflict",
    });
    assert.deepEqual(presentation({ state: "untracked" }), {
      labelKey: "cloud_save",
      icon: "cloud",
      tone: "neutral",
    });
  });
});

describe("cloud save panel action", () => {
  it("describes upload, restore and bidirectional merge actions", () => {
    assert.deepEqual(getCloudSavePanelAction("local-ahead", "upload"), {
      kind: "sync",
      labelKey: "cloud_save_v2_sync_to_remote",
      icon: "upload",
    });
    assert.deepEqual(getCloudSavePanelAction("remote-ahead", "restore"), {
      kind: "sync",
      labelKey: "cloud_save_v2_sync_from_remote",
      icon: "restore",
    });
    assert.deepEqual(getCloudSavePanelAction("local-ahead", "merge"), {
      kind: "sync",
      labelKey: "cloud_save_v2_sync_now",
      icon: "cloud",
    });
  });

  it("uses specific actions for partial, synced and empty states", () => {
    assert.equal(getCloudSavePanelAction("partial", "none").kind, "details");
    assert.equal(getCloudSavePanelAction("synced", "none").kind, "verify");
    assert.equal(getCloudSavePanelAction("untracked", "none").kind, "none");
    assert.equal(
      getCloudSavePanelAction("conflict", "conflict").kind,
      "conflict"
    );
  });
});
