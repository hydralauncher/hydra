import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RecompilationReleaseAsset } from "@types";
import { isCloudSaveV2Eligible } from "./cloud-save-emulator-provider.js";
import {
  isRecompilationAssetFromRepository,
  parseRecompilationCloudSaveObjectId,
  pickRecompilationInstallAsset,
  toCloudSaveApiGame,
  toRecompilationCloudSaveObjectId,
} from "./recompilations.js";

const asset = (
  overrides: Partial<RecompilationReleaseAsset>
): RecompilationReleaseAsset => ({
  name: "Zelda64Recompiled-v1.2.2-Windows.zip",
  size: 1,
  downloadCount: 0,
  url: "https://github.com/Zelda64Recomp/Zelda64Recomp/releases/download/v1.2.2/Zelda64Recompiled-v1.2.2-Windows.zip",
  sha256: null,
  os: "windows",
  arch: "x64",
  isInstallTarget: true,
  ...overrides,
});

describe("pickRecompilationInstallAsset", () => {
  const assets = [
    asset({ os: "linux", arch: "arm64", isInstallTarget: false }),
    asset({ os: "linux", arch: "x64", name: "Linux-X64.zip" }),
    asset({ os: "windows", name: "Windows.zip" }),
    asset({ os: "macos", isInstallTarget: false }),
  ];

  it("takes the install target of this OS", () => {
    assert.equal(
      pickRecompilationInstallAsset(assets, "win32")?.name,
      "Windows.zip"
    );
    assert.equal(
      pickRecompilationInstallAsset(assets, "linux")?.name,
      "Linux-X64.zip"
    );
  });

  it("returns null when the OS has no install target", () => {
    assert.equal(pickRecompilationInstallAsset(assets, "darwin"), null);
    assert.equal(pickRecompilationInstallAsset(assets, "freebsd"), null);
  });
});

describe("isRecompilationAssetFromRepository", () => {
  it("accepts only files from the port's own release", () => {
    assert.ok(
      isRecompilationAssetFromRepository(
        asset({}),
        "Zelda64Recomp/Zelda64Recomp",
        "v1.2.2"
      )
    );
    assert.ok(
      !isRecompilationAssetFromRepository(
        asset({ url: "https://example.com/Zelda64Recompiled.zip" }),
        "Zelda64Recomp/Zelda64Recomp",
        "v1.2.2"
      )
    );
    assert.ok(
      !isRecompilationAssetFromRepository(
        asset({}),
        "Zelda64Recomp/Zelda64",
        "v1.2.2"
      )
    );
    assert.ok(
      !isRecompilationAssetFromRepository(
        asset({
          url: "https://github.com/Zelda64Recomp/Zelda64Recomp/releases/download/v1.2.2/../../../../Other/Repo/releases/download/v1/evil.zip",
        }),
        "Zelda64Recomp/Zelda64Recomp",
        "v1.2.2"
      )
    );
    assert.ok(
      !isRecompilationAssetFromRepository(
        asset({
          url: "https://github.com/Zelda64Recomp/Zelda64Recomp/releases/download/v1.2.2/%2e%2e/%2e%2e/%2e%2e/%2e%2e/Other/Repo/releases/download/v1/evil.zip",
        }),
        "Zelda64Recomp/Zelda64Recomp",
        "v1.2.2"
      )
    );
    assert.ok(
      isRecompilationAssetFromRepository(
        asset({
          url: "https://github.com/Zelda64Recomp/Zelda64Recomp/releases/download/release%2F1.0/Port.zip",
        }),
        "Zelda64Recomp/Zelda64Recomp",
        "release/1.0"
      )
    );
  });
});

describe("recompilation cloud save key", () => {
  it("round-trips a port through its cloud save object id", () => {
    const objectId = toRecompilationCloudSaveObjectId("167", "zelda64recomp");
    assert.equal(objectId, "167:zelda64recomp");
    assert.deepEqual(
      parseRecompilationCloudSaveObjectId("launchbox", objectId),
      {
        objectId: "167",
        slug: "zelda64recomp",
      }
    );
  });

  it("only reads ports from launchbox keys", () => {
    assert.equal(
      parseRecompilationCloudSaveObjectId("steam", "167:zelda"),
      null
    );
    assert.equal(parseRecompilationCloudSaveObjectId("launchbox", "167"), null);
    assert.equal(
      parseRecompilationCloudSaveObjectId("launchbox", "abc:zelda"),
      null
    );
  });

  it("splits the port for the API and leaves other games alone", () => {
    assert.deepEqual(toCloudSaveApiGame("launchbox", "167:zelda64recomp"), {
      shop: "launchbox",
      objectId: "167",
      recompilationSlug: "zelda64recomp",
    });
    assert.deepEqual(toCloudSaveApiGame("launchbox", "167"), {
      shop: "launchbox",
      objectId: "167",
    });
  });

  it("makes ports eligible for cloud save V2 without a platform", () => {
    assert.equal(
      isCloudSaveV2Eligible("launchbox", null, "167:zelda64recomp"),
      true
    );
    assert.equal(isCloudSaveV2Eligible("launchbox", null, "167"), false);
  });
});
