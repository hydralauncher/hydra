import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  detectOnlineFixCompatibility,
  patchSteamFixIniSafely,
} from "../src/main/services/online-fix-detector";

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
    expect(result.hasFix).toBe(true);
    expect(result.provider).toBe("onlinefix");
    expect(result.overrides.toLowerCase()).toContain("onlinefix64=n");
  });

  it("parses manifests but rejects traversal paths", async () => {
    await fs.writeFile(
      path.join(root, "dlllist.txt"),
      "winmm.dll\nSteamOverlay64.dll\n../../evil.dll\n"
    );
    const result = await detectOnlineFixCompatibility(root);
    expect(result.hasFix).toBe(true);
    expect(result.overrides.toLowerCase()).toContain("winmm=n,b");
    expect(result.overrides.toLowerCase()).toContain("steamoverlay64=n");
    expect(result.overrides.toLowerCase()).not.toContain("evil=n");
  });

  it("does not use an EOS DLL alone as proof of OnlineFix", async () => {
    await fs.writeFile(path.join(root, "EOSSDK-Win64-Shipping.dll"), "");
    const result = await detectOnlineFixCompatibility(root);
    expect(result.hasFix).toBe(false);
    expect(result.overrides).toBe("");
  });

  it("detects Photon dependency without downloading it", async () => {
    await fs.writeFile(path.join(root, "Launcher.exe"), "");
    await fs.writeFile(path.join(root, "onlinefix.json"), "{}");
    const result = await detectOnlineFixCompatibility(root);
    expect(result.provider).toBe("photon");
    expect(result.missingDependencies).toEqual([
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
    expect(first.changed).toBe(true);

    const patched = await fs.readFile(ini, "utf-8");
    expect(patched).toContain("RealAppId=480");
    expect(patched).toContain("OriginalRealAppId=123456");
    expect(patched).toContain("ExtraProtection=false");

    const second = await patchSteamFixIniSafely(ini);
    expect(second.changed).toBe(false);
  });
});
