import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RecompilationReleaseAsset } from "@types";
import {
  isRecompilationAssetFromRepository,
  pickRecompilationInstallAsset,
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
  });
});
