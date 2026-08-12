import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  detectOnlineFixCompatibility,
  patchSteamFixIniSafely,
} from "./online-fix-detector.ts";

describe("online-fix-detector", () => {
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

    const result = await detectOnlineFixCompatibility(root);

    assert.equal(result.hasFix, true);
    assert.equal(result.provider, "onlinefix");
    assert.ok(result.overrides.toLowerCase().includes("onlinefix64=n"));
  });

  it("parses manifests but rejects traversal paths", async () => {
    await fs.writeFile(
      path.join(root, "dlllist.txt"),
      "winmm.dll\nSteamOverlay64.dll\n../../evil.dll\n"
    );

    const result = await detectOnlineFixCompatibility(root);
    const overrides = result.overrides.toLowerCase();

    assert.equal(result.hasFix, true);
    assert.ok(overrides.includes("winmm=n,b"));
    assert.ok(overrides.includes("steamoverlay64=n"));
    assert.equal(overrides.includes("evil=n"), false);
  });

  it("does not use an EOS DLL alone as proof of OnlineFix", async () => {
    await fs.writeFile(path.join(root, "EOSSDK-Win64-Shipping.dll"), "");

    const result = await detectOnlineFixCompatibility(root);

    assert.equal(result.hasFix, false);
    assert.equal(result.overrides, "");
  });

  it("detects Photon dependency without downloading it", async () => {
    await fs.writeFile(path.join(root, "Launcher.exe"), "");
    await fs.writeFile(path.join(root, "onlinefix.json"), "{}");

    const result = await detectOnlineFixCompatibility(root);

    assert.equal(result.provider, "photon");
    assert.deepEqual(result.missingDependencies, [
      path.join(root, "Newtonsoft.Json.dll"),
    ]);
  });

  it("patches steamfix.ini with backup and is idempotent", async () => {
    const ini = path.join(root, "steamfix.ini");

    await fs.writeFile(
      ini,
      "[Main]\nRealAppId=123456\nFakeAppId=480\nExtraProtection=true\n"
    );

    const first = await patchSteamFixIniSafely(ini);
    assert.equal(first.changed, true);

    const patched = await fs.readFile(ini, "utf-8");

    assert.ok(patched.includes("RealAppId=480"));
    assert.ok(patched.includes("OriginalRealAppId=123456"));
    assert.ok(patched.includes("ExtraProtection=false"));

    const second = await patchSteamFixIniSafely(ini);
    assert.equal(second.changed, false);
  });
});
