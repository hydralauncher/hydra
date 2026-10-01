import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CloudSaveOverview, CloudSaveV2FileDetails } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as presentationModule from "./cloud-save-presentation.ts";

const {
  canOpenCloudSaveFileBrowser,
  getCloudSaveOperationPresentation,
  getCloudSavePanelAction,
  getCloudSavePartialDescriptionKey,
  getCloudSavePresentation,
  getCloudSaveSnapshotPanelMode,
  getCloudSaveSyncErrorKind,
  getCloudSaveUploadLimitError,
  hasCloudSaveDataToDelete,
  shouldShowCloudSaveEmptySnapshot,
  shouldSyncCloudSaveOnGamePage,
} = presentationModule;

describe("cloud save operation presentation", () => {
  it("shares progress labels and file counts between surfaces", () => {
    assert.deepEqual(getCloudSaveOperationPresentation(null), {
      labelKey: "cloud_save_v2_syncing",
      fileCount: null,
    });
    assert.deepEqual(
      getCloudSaveOperationPresentation({
        gameId: { shop: "steam", objectId: "game" },
        stage: "uploading",
        processedFiles: 2,
        totalFiles: 5,
      }),
      {
        labelKey: "cloud_save_v2_progress_uploading",
        fileCount: { count: 5, processed: 2, total: 5 },
      }
    );
  });

  it("supports operations without transfer progress", () => {
    assert.deepEqual(
      getCloudSaveOperationPresentation(null, "cloud_save_v2_deleting"),
      {
        labelKey: "cloud_save_v2_deleting",
        fileCount: null,
      }
    );
    assert.deepEqual(
      getCloudSaveOperationPresentation({
        gameId: { shop: "steam", objectId: "game" },
        stage: "completed",
        processedFiles: 0,
        totalFiles: 0,
      }),
      {
        labelKey: "cloud_save_v2_progress_completed",
        fileCount: null,
      }
    );
  });
});

const fileDetails = (
  overrides: Partial<CloudSaveV2FileDetails> = {}
): CloudSaveV2FileDetails =>
  ({
    state: "untracked",
    local: {
      kind: "local",
      fileCount: 0,
      totalSizeBytes: 0,
      files: [],
    },
    activeSnapshot: null,
    customPaths: [],
    unresolvedCustomPaths: [],
    comparisons: [],
    variants: [],
    unresolvedRemoteVariantCount: 0,
    ...overrides,
  }) as CloudSaveV2FileDetails;

describe("cloud save deletion availability", () => {
  it("supports remote-only, local-only and custom-path-only states", () => {
    assert.equal(hasCloudSaveDataToDelete(null), false);
    assert.equal(hasCloudSaveDataToDelete(fileDetails()), false);
    assert.equal(
      hasCloudSaveDataToDelete(
        fileDetails({
          activeSnapshot: {
            kind: "active-snapshot",
            snapshotId: "snapshot",
            version: 1,
            updatedAt: "2026-07-30T00:00:00.000Z",
            fileCount: 0,
            totalSizeBytes: 0,
            files: [],
          },
        })
      ),
      true
    );
    assert.equal(
      hasCloudSaveDataToDelete(
        fileDetails({
          local: {
            kind: "local",
            fileCount: 1,
            totalSizeBytes: 4,
            files: [],
          },
        })
      ),
      true
    );
    assert.equal(
      hasCloudSaveDataToDelete(
        fileDetails({
          unresolvedCustomPaths: [
            {
              rawPath: "<custom>/save",
              pathHint: "save",
              state: "needs-confirmation",
              reason: "legacy",
              registered: true,
            },
          ],
        })
      ),
      true
    );
  });
});

describe("cloud save upload limit errors", () => {
  it("recognizes size and file-count failures from IPC errors", () => {
    assert.equal(
      getCloudSaveUploadLimitError(
        new Error("Cloud save failed: cloud_save_snapshot_too_large")
      ),
      "snapshot-too-large"
    );
    assert.equal(
      getCloudSaveUploadLimitError("cloud_save_too_many_files"),
      "too-many-files"
    );
    assert.equal(getCloudSaveUploadLimitError(new Error("network")), null);
  });

  it("classifies metadata and unknown sync failures", () => {
    assert.equal(
      getCloudSaveSyncErrorKind(
        new Error("cloud_save_restore_metadata_failed")
      ),
      "restore-metadata"
    );
    assert.equal(getCloudSaveSyncErrorKind(new Error("network")), "generic");
  });
});

const overview = (
  overrides: Partial<CloudSaveOverview> = {}
): CloudSaveOverview => ({
  state: "local-ahead",
  hasChanged: true,
  activeRemoteSnapshot: null,
  localSnapshotSummary: {
    updatedAt: "2026-07-22T10:00:00.000Z",
    totalSizeBytes: 1024,
  },
  isAutomaticSyncEnabled: true,
  suggestedAction: "upload",
  discoveredVariantCount: 1,
  unresolvedRemoteVariantCount: 0,
  unconfiguredCustomPathCount: 0,
  warnings: [],
  ...overrides,
});

describe("partial cloud save explanations", () => {
  it("distinguishes unresolved targets, scan warnings and deferred changes", () => {
    assert.equal(
      getCloudSavePartialDescriptionKey(
        overview({ state: "partial", unresolvedRemoteVariantCount: 1 })
      ),
      "cloud_save_v2_partial_unresolved_description"
    );
    assert.equal(
      getCloudSavePartialDescriptionKey(
        overview({
          state: "partial",
          warnings: [
            {
              candidateId: "candidate",
              ruleId: "rule",
              selectedRoot: true,
              authority: "authoritative",
              outcome: "failed",
              enumeratedCompletely: false,
              warningCodes: ["permission-denied"],
            },
          ],
        })
      ),
      "cloud_save_v2_partial_scan_description"
    );
    assert.equal(
      getCloudSavePartialDescriptionKey(overview({ state: "partial" })),
      "cloud_save_v2_partial_deferred_description"
    );
    assert.equal(
      getCloudSavePartialDescriptionKey(
        overview({ state: "partial", unconfiguredCustomPathCount: 1 })
      ),
      null
    );
    assert.equal(getCloudSavePartialDescriptionKey(overview()), null);
  });
});

const shouldSyncOnGamePage = (
  overrides: Partial<Parameters<typeof shouldSyncCloudSaveOnGamePage>[0]> = {}
) =>
  shouldSyncCloudSaveOnGamePage({
    overview: overview(),
    shop: "steam",
    canUseCloudSaves: true,
    hasExecutablePath: true,
    isGameRunning: false,
    isSyncing: false,
    isInFlight: false,
    ...overrides,
  });

const presentation = (
  overrides: Partial<Parameters<typeof getCloudSavePresentation>[0]> = {}
) =>
  getCloudSavePresentation({
    canUseCloudSaves: true,
    hasExecutablePath: true,
    isChecking: false,
    isSyncing: false,
    hasError: false,
    hasUnconfiguredCustomPaths: false,
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

  it("shows a specific status when a remote custom path needs a destination", () => {
    assert.deepEqual(
      presentation({
        state: "partial",
        hasUnconfiguredCustomPaths: true,
      }),
      {
        labelKey: "cloud_save_v2_location_required",
        icon: "warning",
        tone: "outdated",
      }
    );
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
    assert.equal(getCloudSavePanelAction("untracked", "none").kind, "verify");
    assert.equal(
      getCloudSavePanelAction("conflict", "conflict").kind,
      "conflict"
    );
  });

  it("prioritizes confirming a custom save destination", () => {
    assert.deepEqual(getCloudSavePanelAction("partial", "none", true), {
      kind: "confirm-location",
      labelKey: "cloud_save_v2_confirm_location",
      icon: "folder",
    });
    assert.equal(
      getCloudSavePanelAction("conflict", "conflict", true).kind,
      "confirm-location"
    );
  });

  it("opens the file browser for tracked and not-yet-tracked games", () => {
    assert.equal(canOpenCloudSaveFileBrowser(null), false);
    assert.equal(
      canOpenCloudSaveFileBrowser(overview({ state: "untracked" })),
      true
    );
    assert.equal(
      canOpenCloudSaveFileBrowser(
        overview({
          state: "local-ahead",
          activeRemoteSnapshot: null,
          suggestedAction: "upload",
        })
      ),
      true
    );
  });

  it("shows an empty snapshot after a completed overview without a remote snapshot", () => {
    assert.equal(
      shouldShowCloudSaveEmptySnapshot({
        overview: overview({ state: "untracked" }),
        isLoading: false,
        hasError: false,
      }),
      true
    );
    assert.equal(
      shouldShowCloudSaveEmptySnapshot({
        overview: overview({
          state: "local-ahead",
          activeRemoteSnapshot: null,
          suggestedAction: "upload",
        }),
        isLoading: false,
        hasError: false,
      }),
      true
    );
  });

  it("keeps the empty snapshot visible after a completed overview", () => {
    assert.equal(
      shouldShowCloudSaveEmptySnapshot({
        overview: overview({ state: "untracked" }),
        isLoading: true,
        hasError: false,
      }),
      true
    );
    assert.equal(
      shouldShowCloudSaveEmptySnapshot({
        overview: overview({ state: "untracked" }),
        isLoading: false,
        hasError: true,
      }),
      true
    );
  });

  it("does not show the empty snapshot before an overview", () => {
    assert.equal(
      shouldShowCloudSaveEmptySnapshot({
        overview: null,
        isLoading: true,
        hasError: false,
      }),
      false
    );
    assert.equal(
      shouldShowCloudSaveEmptySnapshot({
        overview: overview({
          state: "synced",
          activeRemoteSnapshot: {
            id: "snapshot",
            version: 1,
            createdAt: "2026-07-30T00:00:00.000Z",
            updatedAt: "2026-07-30T00:00:00.000Z",
            fileCount: 1,
            totalSizeBytes: 1,
            aggregateHash: "hash",
          },
        }),
        isLoading: false,
        hasError: false,
      }),
      false
    );
  });

  it("shows a skeleton only during the initial load", () => {
    assert.equal(
      getCloudSaveSnapshotPanelMode({
        overview: null,
        isLoading: true,
        isSyncing: false,
        hasError: false,
      }),
      "skeleton"
    );
    assert.equal(
      getCloudSaveSnapshotPanelMode({
        overview: null,
        isLoading: true,
        isSyncing: false,
        hasError: true,
      }),
      "hidden"
    );
  });

  it("hides an empty settled panel and preserves real or active content", () => {
    assert.equal(
      getCloudSaveSnapshotPanelMode({
        overview: null,
        isLoading: false,
        isSyncing: false,
        hasError: false,
      }),
      "hidden"
    );
    assert.equal(
      getCloudSaveSnapshotPanelMode({
        overview: null,
        isLoading: false,
        isSyncing: true,
        hasError: false,
      }),
      "content"
    );
    assert.equal(
      getCloudSaveSnapshotPanelMode({
        overview: overview({ state: "untracked" }),
        isLoading: true,
        isSyncing: false,
        hasError: true,
      }),
      "content"
    );
  });
});

describe("game page automatic cloud save sync", () => {
  it("submits every fresh overview to the main-process planner", () => {
    for (const suggestedAction of [
      "none",
      "upload",
      "restore",
      "merge",
      "conflict",
    ] as const) {
      assert.equal(
        shouldSyncOnGamePage({
          overview: overview({ suggestedAction }),
        }),
        true
      );
    }
  });

  it("blocks only concurrent attempts in the renderer", () => {
    assert.equal(shouldSyncOnGamePage({ isInFlight: true }), false);
  });

  it("waits for the user to confirm remote custom save destinations", () => {
    assert.equal(
      shouldSyncOnGamePage({
        overview: overview({ unconfiguredCustomPathCount: 1 }),
      }),
      false
    );
  });

  it("respects automatic sync and game eligibility", () => {
    assert.equal(
      shouldSyncOnGamePage({
        overview: overview({ isAutomaticSyncEnabled: false }),
      }),
      false
    );
    assert.equal(shouldSyncOnGamePage({ overview: null }), false);
    assert.equal(shouldSyncOnGamePage({ shop: "launchbox" }), false);
    assert.equal(shouldSyncOnGamePage({ canUseCloudSaves: false }), false);
    assert.equal(shouldSyncOnGamePage({ hasExecutablePath: false }), false);
    assert.equal(shouldSyncOnGamePage({ isGameRunning: true }), false);
    assert.equal(shouldSyncOnGamePage({ isSyncing: true }), false);
  });
});
