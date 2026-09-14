import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  applyCloudSaveCustomPathLocalPathMigrations,
  classifyCloudSaveCustomPathResolutionError,
  normalizeStoredCloudSaveCustomPathEntries,
  reconcileStoredCloudSaveCustomPaths,
  removeStoredCloudSaveCustomPath,
  trackStoredCloudSaveCustomPaths,
} from "./custom-path-binding-state.ts";

describe("cloud save custom path binding state", () => {
  it("normalizes legacy tracking records without preserving ignored bindings", () => {
    assert.deepEqual(
      normalizeStoredCloudSaveCustomPathEntries([
        {
          rawPath: "<custom><windows><winDocuments>/Implicit",
          localPath: "C:/Saves/Implicit",
        },
        {
          rawPath: "<custom><windows><winDocuments>/Tracked",
          tracking: "tracked",
          localPath: "C:/Saves/Tracked",
        },
        {
          rawPath: "<custom><windows><winDocuments>/Ignored",
          tracking: "ignored",
          localPath: "C:/Saves/Ignored",
        },
      ]),
      [
        {
          rawPath: "<custom><windows><winDocuments>/Implicit",
          syncState: "confirmed",
          storeUserId: undefined,
          localPath: "C:/Saves/Implicit",
        },
        {
          rawPath: "<custom><windows><winDocuments>/Tracked",
          syncState: "confirmed",
          storeUserId: undefined,
          localPath: "C:/Saves/Tracked",
        },
      ]
    );
  });

  it("preserves the cause of recoverable environment failures", () => {
    assert.deepEqual(
      classifyCloudSaveCustomPathResolutionError(
        new Error("cloud_save_custom_path_wine_prefix_unavailable")
      ),
      {
        state: "recoverable",
        reason: "wine-prefix-unavailable",
      }
    );
    assert.deepEqual(
      classifyCloudSaveCustomPathResolutionError(
        new Error("cloud_save_custom_path_wine_profile_unavailable")
      ),
      {
        state: "recoverable",
        reason: "wine-profile-unavailable",
      }
    );
    assert.deepEqual(
      classifyCloudSaveCustomPathResolutionError(
        new Error("cloud_save_custom_path_token_unavailable")
      ),
      {
        state: "recoverable",
        reason: "environment-unavailable",
      }
    );
  });

  it("classifies account selection failures as recoverable", () => {
    assert.deepEqual(
      classifyCloudSaveCustomPathResolutionError(
        new Error("cloud_save_custom_path_store_user_ambiguous")
      ),
      {
        state: "recoverable",
        reason: "account-selection-required",
      }
    );
  });

  it("requires confirmation for legacy and foreign bindings", () => {
    assert.deepEqual(
      classifyCloudSaveCustomPathResolutionError(
        new Error("cloud_save_custom_path_legacy")
      ),
      {
        state: "needs-confirmation",
        reason: "legacy",
      }
    );
    assert.deepEqual(
      classifyCloudSaveCustomPathResolutionError(
        new Error("cloud_save_custom_path_foreign_platform")
      ),
      {
        state: "needs-confirmation",
        reason: "foreign-platform",
      }
    );
  });

  it("classifies malformed or unsafe bindings as invalid", () => {
    assert.deepEqual(
      classifyCloudSaveCustomPathResolutionError(
        new Error("cloud_save_custom_path_protected")
      ),
      {
        state: "invalid",
        reason: "invalid",
      }
    );
  });

  it("migrates only bindings that still exist and have no explicit path", () => {
    const migrated = applyCloudSaveCustomPathLocalPathMigrations(
      [
        {
          rawPath: "<custom><windows><winDocuments>/Game",
        },
        {
          rawPath: "<custom><windows><winAppData>/Other",
          localPath: "D:/Already Rebound",
        },
      ],
      [
        {
          rawPath: "<custom><windows><winDocuments>/Game",
          localPath: "C:/Users/Hydra/Documents/Game",
        },
        {
          rawPath: "<custom><windows><winAppData>/Other",
          localPath: "C:/Users/Hydra/AppData/Roaming/Other",
        },
        {
          rawPath: "<custom><windows><winLocalAppData>/Removed",
          localPath: "C:/Users/Hydra/AppData/Local/Removed",
        },
      ]
    );

    assert.deepEqual(migrated, [
      {
        rawPath: "<custom><windows><winDocuments>/Game",
        localPath: "C:/Users/Hydra/Documents/Game",
        storeUserId: undefined,
      },
      {
        rawPath: "<custom><windows><winAppData>/Other",
        localPath: "D:/Already Rebound",
      },
    ]);
    assert.equal(
      migrated.some(({ rawPath }) => rawPath.includes("Removed")),
      false
    );
  });

  it("removes the binding instead of storing a local ignore marker", () => {
    const rawPath = "<custom><windows><winDocuments>/Game";
    assert.deepEqual(
      removeStoredCloudSaveCustomPath(
        [
          {
            rawPath,
            syncState: "confirmed",
            localPath: "D:/Saves/Game",
          },
        ],
        rawPath
      ),
      []
    );
  });

  it("keeps pending additions but removes confirmed paths absent remotely", () => {
    const rawPath = "<custom><windows><winDocuments>/Game";
    assert.deepEqual(
      reconcileStoredCloudSaveCustomPaths(
        [{ rawPath, syncState: "confirmed", localPath: "D:/Saves/Game" }],
        new Set()
      ),
      []
    );
    assert.deepEqual(
      reconcileStoredCloudSaveCustomPaths(
        [{ rawPath, syncState: "pending", localPath: "D:/Saves/Game" }],
        new Set()
      ),
      [
        {
          rawPath,
          syncState: "pending",
          localPath: "D:/Saves/Game",
        },
      ]
    );
  });

  it("marks a local addition pending until the remote snapshot contains it", () => {
    const rawPath = "<custom><windows><winDocuments>/Game";
    assert.deepEqual(
      trackStoredCloudSaveCustomPaths(
        [],
        [{ rawPath, localPath: "C:/Users/Hydra/Documents/Game" }],
        "pending"
      ),
      [
        {
          rawPath,
          syncState: "pending",
          storeUserId: undefined,
          localPath: "C:/Users/Hydra/Documents/Game",
        },
      ]
    );
  });
});
