import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { seedPrefixSteamClientFiles } from "./umu-steam-client-files.js";

describe("seedPrefixSteamClientFiles", () => {
  let root: string;
  let steamPath: string;
  let prefixPath: string;
  let prefixSteamPath: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "umu-steam-client-"));
    steamPath = path.join(root, "steam");
    prefixPath = path.join(root, "prefix");
    prefixSteamPath = path.join(
      prefixPath,
      "drive_c",
      "Program Files (x86)",
      "Steam"
    );

    const legacyCompatPath = path.join(steamPath, "legacycompat");
    fs.mkdirSync(legacyCompatPath, { recursive: true });
    fs.writeFileSync(path.join(steamPath, "GameOverlayRenderer64.dll"), "gor");
    fs.symlinkSync(
      "../GameOverlayRenderer64.dll",
      path.join(legacyCompatPath, "GameOverlayRenderer64.dll")
    );
    fs.writeFileSync(path.join(legacyCompatPath, "SteamService.exe"), "svc");
    fs.writeFileSync(path.join(legacyCompatPath, "Steam.dll"), "steam");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("copies the Steam client files Proton would install", () => {
    const copied = seedPrefixSteamClientFiles(prefixPath, steamPath);

    assert.deepEqual(copied, [
      "GameOverlayRenderer64.dll",
      "steam.exe",
      "Steam.dll",
    ]);
    assert.equal(
      fs.readFileSync(
        path.join(prefixSteamPath, "GameOverlayRenderer64.dll"),
        "utf8"
      ),
      "gor"
    );
    assert.equal(
      fs
        .lstatSync(path.join(prefixSteamPath, "GameOverlayRenderer64.dll"))
        .isSymbolicLink(),
      false
    );
    assert.equal(
      fs.readFileSync(path.join(prefixSteamPath, "steam.exe"), "utf8"),
      "svc"
    );
  });

  it("skips files that are already up to date", () => {
    fs.mkdirSync(path.join(prefixPath, "drive_c"), { recursive: true });
    seedPrefixSteamClientFiles(prefixPath, steamPath);

    assert.deepEqual(seedPrefixSteamClientFiles(prefixPath, steamPath), []);
  });

  it("replaces files left behind by an older Steam client", () => {
    fs.mkdirSync(prefixSteamPath, { recursive: true });
    fs.writeFileSync(path.join(prefixSteamPath, "Steam.dll"), "old-steam-dll");

    const copied = seedPrefixSteamClientFiles(prefixPath, steamPath);

    assert.ok(copied.includes("Steam.dll"));
    assert.equal(
      fs.readFileSync(path.join(prefixSteamPath, "Steam.dll"), "utf8"),
      "steam"
    );
  });

  it("seeds a prefix before Proton has created it", () => {
    const copied = seedPrefixSteamClientFiles(prefixPath, steamPath);

    assert.equal(copied.length, 3);
    assert.ok(fs.existsSync(path.join(prefixSteamPath, "steam.exe")));
  });

  it("does not create anything when Steam has no legacycompat files", () => {
    fs.rmSync(path.join(steamPath, "legacycompat"), { recursive: true });

    assert.deepEqual(seedPrefixSteamClientFiles(prefixPath, steamPath), []);
    assert.equal(fs.existsSync(prefixPath), false);
  });
});
