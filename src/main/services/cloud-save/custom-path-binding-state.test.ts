import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  applyCloudSaveCustomPathLocalPathMigrations,
  classifyCloudSaveCustomPathResolutionError,
} from "./custom-path-binding-state.ts";

describe("cloud save custom path binding state", () => {
  it("classifies temporary environment and account failures as recoverable", () => {
    assert.deepEqual(
      classifyCloudSaveCustomPathResolutionError(
        new Error("cloud_save_custom_path_wine_profile_unavailable")
      ),
      {
        state: "recoverable",
        reason: "environment-unavailable",
      }
    );
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
});
