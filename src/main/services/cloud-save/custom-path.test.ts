import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  canonicalizeSelectedCloudSaveCustomPath,
  cloudSaveCustomPathStorageKey,
  decodeCloudSaveCustomPath,
  encodeCloudSaveCustomPath,
  validateCloudSaveCustomPathForRestore,
} from "./custom-path.ts";

describe("cloud save custom path codec", () => {
  it("round trips canonical Windows, Linux and macOS paths", () => {
    assert.deepEqual(
      encodeCloudSaveCustomPath(
        "c:\\Users\\Hydra\\AppData\\Roaming\\Game\\",
        "windows"
      ),
      {
        rawPath: "<custom><windows>C:/Users/Hydra/AppData/Roaming/Game",
        path: "C:/Users/Hydra/AppData/Roaming/Game",
        platform: "windows",
      }
    );
    assert.equal(
      encodeCloudSaveCustomPath("/home/hydra/.local/share/game/", "linux")
        .rawPath,
      "<custom><linux>/home/hydra/.local/share/game"
    );
    assert.equal(
      encodeCloudSaveCustomPath(
        "/Users/hydra/Library/Application Support/Game",
        "mac"
      ).rawPath,
      "<custom><mac>/Users/hydra/Library/Application Support/Game"
    );
  });

  it("rejects unknown platforms, relative paths, traversal and roots", () => {
    for (const rawPath of [
      "<custom><bsd>/home/hydra/game",
      "<custom><linux>relative/game",
      "<custom><linux>/home/hydra/../game",
      "<custom><windows>c:/Users/Hydra/Game",
      "<custom><windows>C:/",
      "<custom><windows>C:/Windows/System32",
      "<custom><linux>/",
      "<custom><mac>/System/Library",
    ]) {
      assert.throws(() => decodeCloudSaveCustomPath(rawPath));
    }
  });

  it("does not apply a valid path from another platform", async () => {
    assert.equal(
      await validateCloudSaveCustomPathForRestore(
        "<custom><linux>/home/hydra/game",
        "windows"
      ),
      null
    );
  });

  it("isolates persisted paths by Hydra user, shop and objectId", () => {
    assert.notEqual(
      cloudSaveCustomPathStorageKey("user-a", "steam", "1"),
      cloudSaveCustomPathStorageKey("user-b", "steam", "1")
    );
    assert.notEqual(
      cloudSaveCustomPathStorageKey("user-a", "steam", "1"),
      cloudSaveCustomPathStorageKey("user-a", "custom", "1")
    );
    assert.notEqual(
      cloudSaveCustomPathStorageKey("user-a", "steam", "1"),
      cloudSaveCustomPathStorageKey("user-a", "steam", "2")
    );
  });

  it("canonicalizes an existing selected directory", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-custom-path-")
    );
    try {
      const customPath =
        await canonicalizeSelectedCloudSaveCustomPath(directory);
      assert.equal(customPath.path, directory.replaceAll("\\", "/"));
      assert.equal(
        decodeCloudSaveCustomPath(customPath.rawPath).path,
        customPath.path
      );
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
