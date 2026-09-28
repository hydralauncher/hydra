import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { isExecutableMissing } from "./is-executable-missing.ts";

const GAME_EXECUTABLE = path.join("Game", "game.exe");
const DRIVE_EXECUTABLE = path.join("Drive", GAME_EXECUTABLE);

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

const scenarios: {
  name: string;
  filePaths: string[];
  prepare?: (directory: string) => Promise<unknown>;
  executable?: string;
  isMissing: boolean;
}[] = [
  {
    name: "reports an executable whose game folder was deleted",
    filePaths: ["Other Game/other.exe"],
    isMissing: true,
  },
  {
    name: "reports an executable deleted from a game folder that still has files",
    filePaths: ["Game/data.pak"],
    isMissing: true,
  },
  {
    name: "reports an executable whose game folder was replaced by a file",
    filePaths: ["Game"],
    isMissing: true,
  },
  {
    name: "keeps an executable that still exists",
    filePaths: ["Game/game.exe"],
    isMissing: false,
  },
  {
    name: "keeps an executable whose scanned folder went offline",
    filePaths: ["Game/game.exe"],
    prepare: (directory) =>
      fs.promises.rm(directory, { recursive: true, force: true }),
    isMissing: false,
  },
  {
    name: "keeps an executable behind an empty mount point",
    filePaths: ["Other Game/other.exe"],
    prepare: (directory) => fs.promises.mkdir(path.join(directory, "Drive")),
    executable: DRIVE_EXECUTABLE,
    isMissing: false,
  },
  {
    name: "keeps an executable behind a mount point that can no longer be opened",
    filePaths: ["Other Game/other.exe"],
    prepare: (directory) =>
      fs.promises.symlink(
        path.join(directory, "Offline Drive"),
        path.join(directory, "Drive"),
        "junction"
      ),
    executable: DRIVE_EXECUTABLE,
    isMissing: false,
  },
];

describe("installed games scan missing executables", () => {
  for (const {
    name,
    filePaths,
    prepare,
    executable = GAME_EXECUTABLE,
    isMissing,
  } of scenarios) {
    it(name, async () => {
      const directory = await createScannedDirectory(...filePaths);
      await prepare?.(directory);

      assert.equal(
        await isExecutableMissing(path.join(directory, executable), [
          directory,
        ]),
        isMissing
      );
    });
  }

  it("keeps an executable outside the scanned folders", async () => {
    const directory = await createScannedDirectory("Game/game.exe");
    const otherDirectory = await createScannedDirectory("Other Game/other.exe");

    assert.equal(
      await isExecutableMissing(path.join(otherDirectory, GAME_EXECUTABLE), [
        directory,
      ]),
      false
    );
  });
});
