import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { findEmulatorInDownloadDirectories } from "./find-emulator-in-download-directories.ts";
import { KNOWN_BINARIES } from "./known-binaries.ts";

describe("findEmulatorInDownloadDirectories", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        fs.promises.rm(directory, {
          recursive: true,
          force: true,
        })
      )
    );
  });

  const createTemporaryDirectory = async () => {
    const directory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-emulator-downloads-")
    );
    temporaryDirectories.push(directory);
    return directory;
  };

  const writeValidExecutable = async (
    executablePath: string,
    platform: NodeJS.Platform
  ) => {
    if (platform === "win32") {
      const data = Buffer.alloc(68);
      data.write("MZ", 0, "ascii");
      data.writeUInt32LE(64, 0x3c);
      data.set([0x50, 0x45, 0, 0], 64);
      await fs.promises.writeFile(executablePath, data);
      return;
    }

    if (platform === "darwin" && executablePath.endsWith(".app")) {
      const bundleExecutable = path.join(
        executablePath,
        "Contents",
        "MacOS",
        path.basename(executablePath, ".app")
      );
      await fs.promises.mkdir(path.dirname(bundleExecutable), {
        recursive: true,
      });
      await fs.promises.writeFile(
        bundleExecutable,
        Buffer.from([0xfe, 0xed, 0xfa, 0xcf])
      );
      await fs.promises.chmod(bundleExecutable, 0o755);
      return;
    }

    await fs.promises.writeFile(
      executablePath,
      Buffer.from([0x7f, 0x45, 0x4c, 0x46])
    );
    await fs.promises.chmod(executablePath, 0o755);
  };

  it("finds Dolphin in Hydra's emulator folder under a download root", async () => {
    const emptyDownloads = await createTemporaryDirectory();
    const downloads = await createTemporaryDirectory();
    const dolphinDirectory = path.join(downloads, "Dolphin", "Dolphin-x64");
    await fs.promises.mkdir(dolphinDirectory, { recursive: true });

    let executablePath: string;
    if (process.platform === "win32") {
      executablePath = path.join(dolphinDirectory, "Dolphin.exe");
    } else if (process.platform === "darwin") {
      executablePath = path.join(dolphinDirectory, "Dolphin.app");
    } else {
      executablePath = path.join(
        dolphinDirectory,
        "Dolphin-2606-x86_64.AppImage"
      );
    }
    await writeValidExecutable(executablePath, process.platform);

    assert.equal(
      findEmulatorInDownloadDirectories(KNOWN_BINARIES.dolphin, [
        emptyDownloads,
        downloads,
      ]),
      executablePath
    );
  });

  it("finds a portable emulator in a nested download subfolder", async () => {
    const downloads = await createTemporaryDirectory();
    const portableDirectory = path.join(
      downloads,
      "manually-extracted",
      "emulators",
      "dolphin"
    );
    await fs.promises.mkdir(portableDirectory, { recursive: true });

    let executablePath: string;
    if (process.platform === "win32") {
      executablePath = path.join(portableDirectory, "Dolphin.exe");
    } else if (process.platform === "darwin") {
      executablePath = path.join(portableDirectory, "Dolphin.app");
    } else {
      executablePath = path.join(portableDirectory, "dolphin-emu");
    }
    await writeValidExecutable(executablePath, process.platform);

    assert.equal(
      findEmulatorInDownloadDirectories(KNOWN_BINARIES.dolphin, [downloads]),
      executablePath
    );
  });

  it("finds a PPSSPP AppImage in a nested download subfolder", async () => {
    const downloads = await createTemporaryDirectory();
    const portableDirectory = path.join(downloads, "portable", "sony", "psp");
    await fs.promises.mkdir(portableDirectory, { recursive: true });
    const executablePath = path.join(
      portableDirectory,
      "PPSSPP-v1.20.4-x86_64.AppImage"
    );
    await writeValidExecutable(executablePath, "linux");

    assert.equal(
      findEmulatorInDownloadDirectories(
        KNOWN_BINARIES.psp,
        [downloads],
        "linux"
      ),
      executablePath
    );
  });

  it("rejects a corrupt Windows executable with the expected name", async () => {
    const downloads = await createTemporaryDirectory();
    await fs.promises.writeFile(
      path.join(downloads, "Dolphin.exe"),
      "not a Windows executable"
    );

    assert.equal(
      findEmulatorInDownloadDirectories(
        KNOWN_BINARIES.dolphin,
        [downloads],
        "win32"
      ),
      null
    );
  });

  it("skips a corrupt AppImage and finds a valid nested candidate", async () => {
    const downloads = await createTemporaryDirectory();
    const corrupt = path.join(downloads, "PPSSPP-broken.AppImage");
    const valid = path.join(
      downloads,
      "portable",
      "PPSSPP-v1.20.4-x86_64.AppImage"
    );
    await fs.promises.writeFile(corrupt, "not an AppImage");
    await fs.promises.chmod(corrupt, 0o755);
    await fs.promises.mkdir(path.dirname(valid), { recursive: true });
    await writeValidExecutable(valid, "linux");

    assert.equal(
      findEmulatorInDownloadDirectories(
        KNOWN_BINARIES.psp,
        [downloads],
        "linux"
      ),
      valid
    );
  });

  it("rejects a macOS bundle without a valid executable", async () => {
    const downloads = await createTemporaryDirectory();
    await fs.promises.mkdir(path.join(downloads, "Dolphin.app"));

    assert.equal(
      findEmulatorInDownloadDirectories(
        KNOWN_BINARIES.dolphin,
        [downloads],
        "darwin"
      ),
      null
    );
  });

  it("accepts a macOS bundle with a valid executable", async () => {
    const downloads = await createTemporaryDirectory();
    const bundle = path.join(downloads, "Dolphin.app");
    await writeValidExecutable(bundle, "darwin");

    assert.equal(
      findEmulatorInDownloadDirectories(
        KNOWN_BINARIES.dolphin,
        [downloads],
        "darwin"
      ),
      bundle
    );
  });
});
