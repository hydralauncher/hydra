import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { isExecutableMissing } from "./is-executable-missing.ts";

const tempDirectories: string[] = [];

const createScannedDirectory = async (...filePaths: string[]) => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-scan-")
  );
  tempDirectories.push(directory);

  for (const filePath of filePaths) {
    await fs.promises.mkdir(path.join(directory, path.dirname(filePath)), {
      recursive: true,
    });
    await fs.promises.writeFile(path.join(directory, filePath), "");
  }

  return directory;
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) =>
        fs.promises.rm(directory, { recursive: true, force: true })
      )
  );
});

describe("installed games scan missing executables", () => {
  it("reports an executable whose game folder was deleted", async () => {
    const directory = await createScannedDirectory("Other Game/other.exe");

    assert.equal(
      await isExecutableMissing(path.join(directory, "Game", "game.exe"), [
        directory,
      ]),
      true
    );
  });

  it("reports an executable deleted from a game folder that still has files", async () => {
    const directory = await createScannedDirectory("Game/data.pak");

    assert.equal(
      await isExecutableMissing(path.join(directory, "Game", "game.exe"), [
        directory,
      ]),
      true
    );
  });

  it("reports an executable whose game folder was replaced by a file", async () => {
    const directory = await createScannedDirectory("Game");

    assert.equal(
      await isExecutableMissing(path.join(directory, "Game", "game.exe"), [
        directory,
      ]),
      true
    );
  });

  it("keeps an executable that still exists", async () => {
    const directory = await createScannedDirectory("Game/game.exe");

    assert.equal(
      await isExecutableMissing(path.join(directory, "Game", "game.exe"), [
        directory,
      ]),
      false
    );
  });

  it("keeps an executable whose scanned folder went offline", async () => {
    const directory = await createScannedDirectory("Game/game.exe");
    await fs.promises.rm(directory, { recursive: true, force: true });

    assert.equal(
      await isExecutableMissing(path.join(directory, "Game", "game.exe"), [
        directory,
      ]),
      false
    );
  });

  it("keeps an executable behind an empty mount point", async () => {
    const directory = await createScannedDirectory("Other Game/other.exe");
    await fs.promises.mkdir(path.join(directory, "Drive"));

    assert.equal(
      await isExecutableMissing(
        path.join(directory, "Drive", "Game", "game.exe"),
        [directory]
      ),
      false
    );
  });

  it("keeps an executable behind a mount point that can no longer be opened", async () => {
    const directory = await createScannedDirectory("Other Game/other.exe");
    await fs.promises.symlink(
      path.join(directory, "Offline Drive"),
      path.join(directory, "Drive"),
      "junction"
    );

    assert.equal(
      await isExecutableMissing(
        path.join(directory, "Drive", "Game", "game.exe"),
        [directory]
      ),
      false
    );
  });

  it("keeps an executable outside the scanned folders", async () => {
    const directory = await createScannedDirectory("Game/game.exe");
    const otherDirectory = await createScannedDirectory("Other Game/other.exe");

    assert.equal(
      await isExecutableMissing(path.join(otherDirectory, "Game", "game.exe"), [
        directory,
      ]),
      false
    );
  });
});
