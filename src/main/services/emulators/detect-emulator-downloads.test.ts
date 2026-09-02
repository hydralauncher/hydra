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

  it("finds Dolphin in Hydra's emulator folder under a download root", async () => {
    const emptyDownloads = await createTemporaryDirectory();
    const downloads = await createTemporaryDirectory();
    const dolphinDirectory = path.join(downloads, "Dolphin", "Dolphin-x64");
    await fs.promises.mkdir(dolphinDirectory, { recursive: true });

    let executablePath: string;
    if (process.platform === "win32") {
      executablePath = path.join(dolphinDirectory, "Dolphin.exe");
      await fs.promises.writeFile(executablePath, "");
    } else if (process.platform === "darwin") {
      executablePath = path.join(dolphinDirectory, "Dolphin.app");
      await fs.promises.mkdir(executablePath);
    } else {
      executablePath = path.join(
        dolphinDirectory,
        "Dolphin-2606-x86_64.AppImage"
      );
      await fs.promises.writeFile(executablePath, "");
    }

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
      await fs.promises.writeFile(executablePath, "");
    } else if (process.platform === "darwin") {
      executablePath = path.join(portableDirectory, "Dolphin.app");
      await fs.promises.mkdir(executablePath);
    } else {
      executablePath = path.join(portableDirectory, "dolphin-emu");
      await fs.promises.writeFile(executablePath, "");
    }

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
    await fs.promises.writeFile(executablePath, "");

    assert.equal(
      findEmulatorInDownloadDirectories(
        KNOWN_BINARIES.psp,
        [downloads],
        "linux"
      ),
      executablePath
    );
  });
});
