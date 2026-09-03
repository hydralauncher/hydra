import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { isExecutableNameExpectedForBinary } from "./is-executable-name-expected.ts";
import { KNOWN_BINARIES } from "./known-binaries.ts";
import {
  assertValidEmulatorExecutable,
  isValidEmulatorExecutable,
} from "./validate-emulator-executable.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        fs.promises.rm(directory, { recursive: true, force: true })
      )
  );
});

const createTemporaryDirectory = async () => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-emulator-validation-")
  );
  temporaryDirectories.push(directory);
  return directory;
};

describe("assertValidEmulatorExecutable", () => {
  it("throws instead of allowing installation to report success", () => {
    assert.throws(
      () => assertValidEmulatorExecutable("/missing/Dolphin.AppImage"),
      /Invalid emulator executable/
    );
  });

  it("rejects a corrupt file renamed as a Windows executable", async () => {
    const directory = await createTemporaryDirectory();
    const executable = path.join(directory, "Dolphin.exe");
    await fs.promises.writeFile(executable, "not a Windows executable");

    assert.equal(isValidEmulatorExecutable(executable, "win32"), false);
  });

  it("accepts a Windows executable with DOS and PE headers", async () => {
    const directory = await createTemporaryDirectory();
    const executable = path.join(directory, "Dolphin.exe");
    const data = Buffer.alloc(68);
    data.write("MZ", 0, "ascii");
    data.writeUInt32LE(64, 0x3c);
    data.set([0x50, 0x45, 0, 0], 64);
    await fs.promises.writeFile(executable, data);

    assert.equal(isValidEmulatorExecutable(executable, "win32"), true);
  });
});

describe("isExecutableNameExpectedForBinary", () => {
  const dolphin = { binary: "dolphin" };
  const ppsspp = { binary: "ppsspp" };

  it("rejects KDE Dolphin as Dolphin Emulator on Linux", () => {
    assert.equal(KNOWN_BINARIES.dolphin.linuxNames.includes("dolphin"), false);
    assert.equal(
      isExecutableNameExpectedForBinary("/usr/bin/dolphin", dolphin, "linux"),
      false
    );
  });

  it("accepts Dolphin Emulator Linux executable names", () => {
    assert.equal(
      isExecutableNameExpectedForBinary(
        "/usr/bin/dolphin-emu",
        dolphin,
        "linux"
      ),
      true
    );
    assert.equal(
      isExecutableNameExpectedForBinary(
        "/home/user/Applications/Dolphin-2606-x86_64.AppImage",
        dolphin,
        "linux"
      ),
      true
    );
  });

  it("keeps the Dolphin executable name valid on other platforms", () => {
    assert.equal(
      isExecutableNameExpectedForBinary(
        String.raw`C:\\Dolphin\\Dolphin.exe`,
        dolphin,
        "win32"
      ),
      true
    );
  });

  it("rejects another emulator selected as PPSSPP", () => {
    assert.equal(
      isExecutableNameExpectedForBinary(
        "/mnt/games/DuckStation-x64.AppImage",
        ppsspp,
        "linux"
      ),
      false
    );
  });

  it("accepts PPSSPP executable variants", () => {
    assert.equal(
      isExecutableNameExpectedForBinary(
        "/home/user/Applications/PPSSPP-v1.20.4.AppImage",
        ppsspp,
        "linux"
      ),
      true
    );
    assert.equal(
      isExecutableNameExpectedForBinary(
        String.raw`C:\Emulators\PPSSPPWindows64.exe`,
        ppsspp,
        "win32"
      ),
      true
    );
  });

  it("rejects another emulator selected as Dolphin", () => {
    assert.equal(
      isExecutableNameExpectedForBinary(
        "/home/user/Applications/PPSSPP.AppImage",
        dolphin,
        "linux"
      ),
      false
    );
  });
});
