import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { detectWindowsCompatibility } from "./windows-compatibility-detector.ts";

describe("windows-compatibility-detector", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-onlinefix-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("detects known OnlineFix files recursively", async () => {
    const nested = path.join(root, "Bin", "Win64");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, "OnlineFix64.dll"), "");

    const result = await detectWindowsCompatibility(root);

    assert.equal(result.requiresCompatibilityMode, true);
    assert.equal(result.provider, "onlinefix");
    assert.ok(result.overrides.toLowerCase().includes("onlinefix64=n"));
  });

  it("parses manifests but rejects traversal paths", async () => {
    await fs.writeFile(
      path.join(root, "dlllist.txt"),
      "winmm.dll\nSteamOverlay64.dll\n../../evil.dll\n"
    );

    const result = await detectWindowsCompatibility(root);
    const overrides = result.overrides.toLowerCase();

    assert.equal(result.requiresCompatibilityMode, true);
    assert.ok(overrides.includes("winmm=n,b"));
    assert.ok(overrides.includes("steamoverlay64=n"));
    assert.equal(overrides.includes("evil=n"), false);
  });

  it("does not use winmm.dll alone as proof of a compatibility setup", async () => {
    await fs.writeFile(path.join(root, "winmm.dll"), "");

    const result = await detectWindowsCompatibility(root);

    assert.equal(result.requiresCompatibilityMode, false);
    assert.equal(result.overrides, "");
  });

  it("does not use version.dll alone as proof of a compatibility setup", async () => {
    await fs.writeFile(path.join(root, "version.dll"), "");

    const result = await detectWindowsCompatibility(root);

    assert.equal(result.requiresCompatibilityMode, false);
    assert.equal(result.overrides, "");
  });

  it("does not use an EOS DLL alone as proof of OnlineFix", async () => {
    await fs.writeFile(path.join(root, "EOSSDK-Win64-Shipping.dll"), "");

    const result = await detectWindowsCompatibility(root);

    assert.equal(result.requiresCompatibilityMode, false);
    assert.equal(result.overrides, "");
  });

  it("detects Photon dependency without downloading it", async () => {
    await fs.writeFile(path.join(root, "Launcher.exe"), "");
    await fs.writeFile(path.join(root, "onlinefix.json"), "{}");

    const result = await detectWindowsCompatibility(root);

    assert.equal(result.provider, "photon");
    assert.deepEqual(result.missingDependencies, [
      path.join(root, "Newtonsoft.Json.dll"),
    ]);
  });

  it("detects a Steam emulator configuration without treating steam_api64.dll alone as proof", async () => {
    await fs.writeFile(path.join(root, "steam_api64.dll"), "");
    await fs.writeFile(path.join(root, "steam_appid.txt"), "480");
    await fs.writeFile(path.join(root, "steam_emu.ini"), "[Settings]\n");

    const result = await detectWindowsCompatibility(root);

    assert.equal(result.requiresCompatibilityMode, true);
    assert.ok(
      result.detectedFiles.some(
        (file) => path.basename(file).toLowerCase() === "steam_emu.ini"
      )
    );
  });

  it("does not use steam_api64.dll alone as proof of a compatibility setup", async () => {
    await fs.writeFile(path.join(root, "steam_api64.dll"), "");

    const result = await detectWindowsCompatibility(root);

    assert.equal(result.requiresCompatibilityMode, false);
  });
});
