import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  findManagedEmulatorExecutable,
  requireManagedEmulatorExecutable,
} from "./find-managed-emulator-executable.ts";
import { KNOWN_BINARIES } from "./known-binaries.ts";

describe("findManagedEmulatorExecutable", () => {
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
      path.join(os.tmpdir(), "hydra-emulator-install-")
    );
    temporaryDirectories.push(directory);
    return directory;
  };

  it("finds the PPSSPP SDL macOS bundle", async () => {
    const root = await createTemporaryDirectory();
    const bundle = path.join(root, "PPSSPPSDL.app");
    await fs.promises.mkdir(bundle);

    assert.equal(
      findManagedEmulatorExecutable(root, KNOWN_BINARIES.psp),
      bundle
    );
  });

  it("finds Dolphin in a nested Windows archive", async () => {
    const root = await createTemporaryDirectory();
    const executable = path.join(root, "Dolphin-x64", "Dolphin.exe");
    await fs.promises.mkdir(path.dirname(executable), { recursive: true });
    await fs.promises.writeFile(executable, "");

    assert.equal(
      findManagedEmulatorExecutable(root, KNOWN_BINARIES.dolphin),
      executable
    );
  });

  it("rejects an archive without the requested emulator", async () => {
    const root = await createTemporaryDirectory();
    await fs.promises.writeFile(path.join(root, "readme.txt"), "missing");

    assert.throws(
      () => requireManagedEmulatorExecutable(root, KNOWN_BINARIES.dolphin),
      /No Dolphin executable found/
    );
  });

  it("rejects an invalid file with the expected executable name", async () => {
    const root = await createTemporaryDirectory();
    await fs.promises.writeFile(path.join(root, "Dolphin.exe"), "invalid");

    assert.throws(
      () => requireManagedEmulatorExecutable(root, KNOWN_BINARIES.dolphin),
      /Invalid emulator executable/
    );
  });
});
