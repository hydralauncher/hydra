import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  canDeleteInstallationOwnedCustomPathFiles,
  getInstallationOwnedCustomPathRawPaths,
  isCloudSavePathWithinRoot,
} from "./installation-owned-custom-paths.ts";

describe("installation-owned custom paths", () => {
  it("allows inferred deletion only after the game exits", () => {
    assert.equal(canDeleteInstallationOwnedCustomPathFiles("post-exit"), true);
    for (const trigger of [
      "manual",
      "environment-changed",
      "game-page-open",
      "custom-path-rebind",
      "pre-launch",
    ] as const) {
      assert.equal(canDeleteInstallationOwnedCustomPathFiles(trigger), false);
    }
  });

  it("uses component-aware, case-insensitive containment on Windows", () => {
    assert.equal(
      isCloudSavePathWithinRoot(
        "c:/games/example/Saves",
        "C:/Games/Example",
        "windows"
      ),
      true
    );
    assert.equal(
      isCloudSavePathWithinRoot(
        "C:/Games/Example 2/Saves",
        "C:/Games/Example",
        "windows"
      ),
      false
    );
  });

  it("classifies only bindings inside the game root or Wine prefix", async () => {
    const insideGame = "<custom><windows><base>/Saves";
    const insidePrefix = "<custom><windows><winDocuments>/Game";
    const external = "<custom><linux><home>/Backups/Game";
    const result = await getInstallationOwnedCustomPathRawPaths(
      {
        ready: [
          {
            rawPath: insideGame,
            path: "/games/example/Saves",
            platform: "linux",
          },
          {
            rawPath: insidePrefix,
            path: "/prefix/drive_c/users/steamuser/Documents/Game",
            platform: "windows",
          },
          {
            rawPath: external,
            path: "/home/hydra/Backups/Game",
            platform: "linux",
          },
        ],
        unresolved: [],
      },
      {
        shop: "steam",
        objectId: "1",
        platform: "linux",
        homeDir: "/home/hydra",
        executablePath: "/games/example/bin/game.exe",
        winePrefixPath: "/prefix",
        storeUserContext: { known: [] },
      },
      {
        findGameRoot: async () => "/games/example",
        canonicalize: async (value) => value,
      }
    );

    assert.deepEqual(result, new Set([insideGame, insidePrefix]));
  });
});
