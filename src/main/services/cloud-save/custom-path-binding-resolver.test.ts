import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { resolveStoredCloudSaveCustomPathBindings } from "./custom-path-binding-resolver.ts";

const windowsContext = {
  platform: "windows" as const,
  homeDir: "C:/Users/Hydra",
  documentsDir: "C:/Users/Hydra/Documents",
  appDataDir: "C:/Users/Hydra/AppData/Roaming",
  localAppDataDir: "C:/Users/Hydra/AppData/Local",
};

describe("stored cloud save custom path bindings", () => {
  it("resolves and migrates an old portable binding", () => {
    const rawPath = "<custom><windows><winDocuments>/Game";
    const result = resolveStoredCloudSaveCustomPathBindings(
      [{ rawPath }],
      windowsContext
    );

    assert.deepEqual(result.bindings, {
      ready: [
        {
          rawPath,
          path: "C:/Users/Hydra/Documents/Game",
          platform: "windows",
        },
      ],
      unresolved: [],
    });
    assert.deepEqual(result.migrations, [
      {
        rawPath,
        localPath: "C:/Users/Hydra/Documents/Game",
        storeUserId: undefined,
      },
    ]);
  });

  it("keeps an explicit binding ready even when its folder does not exist", () => {
    const rawPath = "<custom><windows><winDocuments>/Game";
    const result = resolveStoredCloudSaveCustomPathBindings(
      [{ rawPath, localPath: "D:/Missing/Game" }],
      windowsContext
    );

    assert.equal(result.bindings.ready[0].path, "D:/Missing/Game");
    assert.deepEqual(result.bindings.unresolved, []);
    assert.deepEqual(result.migrations, []);
  });

  it("marks a missing Wine profile as recoverable and resolves it later", () => {
    const rawPath = "<custom><windows><winDocuments>/Game";
    const unavailableContext = {
      platform: "linux" as const,
      homeDir: "/home/hydra",
      windowsCompatibility: true,
      winePrefixPath: "/home/hydra/prefix",
    };
    const unavailable = resolveStoredCloudSaveCustomPathBindings(
      [{ rawPath }],
      unavailableContext
    );

    assert.deepEqual(unavailable.bindings.unresolved, [
      {
        rawPath,
        pathHint: null,
        state: "recoverable",
        reason: "wine-profile-unavailable",
        registered: true,
      },
    ]);

    const recovered = resolveStoredCloudSaveCustomPathBindings([{ rawPath }], {
      ...unavailableContext,
      wineUserProfilePath: "/home/hydra/prefix/drive_c/users/steamuser",
    });
    assert.equal(
      recovered.bindings.ready[0].path,
      "/home/hydra/prefix/drive_c/users/steamuser/Documents/Game"
    );
    assert.equal(recovered.migrations.length, 1);
  });

  it("keeps ambiguous store-user bindings visible and unused", () => {
    const rawPath = "<custom><windows><base>/saves/<storeUserId>";
    const result = resolveStoredCloudSaveCustomPathBindings([{ rawPath }], {
      ...windowsContext,
      installDir: "C:/Games/Game",
      storeUserIds: ["111", "222"],
    });

    assert.deepEqual(result.bindings.ready, []);
    assert.equal(
      result.bindings.unresolved[0].reason,
      "account-selection-required"
    );
    assert.equal(result.bindings.unresolved[0].state, "recoverable");
  });

  it("keeps legacy, foreign and malformed records visible but blocked", () => {
    const entries = [
      {
        rawPath: "<custom><windows>C:/Users/Hydra/Documents/Legacy",
      },
      { rawPath: "<custom><linux><home>/Game" },
      { rawPath: "<custom><bsd>/Game" },
    ];
    const result = resolveStoredCloudSaveCustomPathBindings(
      entries,
      windowsContext
    );

    assert.deepEqual(
      result.bindings.unresolved.map(({ state, reason }) => ({
        state,
        reason,
      })),
      [
        { state: "needs-confirmation", reason: "legacy" },
        { state: "needs-confirmation", reason: "foreign-platform" },
        { state: "invalid", reason: "invalid" },
      ]
    );
    assert.equal(
      result.bindings.unresolved[0].pathHint,
      "C:/Users/Hydra/Documents/Legacy"
    );
  });
});
