import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { swapCoreLibrary } from "./swap-core-library.js";

const PREVIOUS = "previous core";
const STAGED = "staged core";

interface Fixture {
  stagedLibrary: string;
  libraryPath: string;
  backupPath: string;
}

const writeFile = (filePath: string, contents: string): void => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
};

const setup = (withPrevious: boolean): Fixture => {
  const dir = mkdtempSync(path.join(tmpdir(), "swap-core-"));
  const stagedLibrary = path.join(dir, "staged", "core.so");
  const libraryPath = path.join(dir, "cores", "core.so");

  writeFile(stagedLibrary, STAGED);
  if (withPrevious) writeFile(libraryPath, PREVIOUS);

  return { stagedLibrary, libraryPath, backupPath: `${libraryPath}.backup` };
};

describe("swapCoreLibrary", () => {
  it("installs the staged core and clears the backup on success", async () => {
    const { stagedLibrary, libraryPath, backupPath } = setup(true);

    await swapCoreLibrary(stagedLibrary, libraryPath, async () => {});

    assert.equal(readFileSync(libraryPath, "utf8"), STAGED);
    assert.equal(existsSync(backupPath), false);
  });

  it("installs into an empty cores directory", async () => {
    const { stagedLibrary, libraryPath, backupPath } = setup(false);

    await swapCoreLibrary(stagedLibrary, libraryPath, async () => {});

    assert.equal(readFileSync(libraryPath, "utf8"), STAGED);
    assert.equal(existsSync(backupPath), false);
  });

  it("restores the previous core when the config write fails", async () => {
    const { stagedLibrary, libraryPath, backupPath } = setup(true);
    const failure = new Error("config write rejected");

    await assert.rejects(
      swapCoreLibrary(stagedLibrary, libraryPath, async () => {
        // The new binary is already in place at this point — the rollback has
        // to undo it, not just report the failure.
        assert.equal(readFileSync(libraryPath, "utf8"), STAGED);
        throw failure;
      }),
      failure
    );

    assert.equal(readFileSync(libraryPath, "utf8"), PREVIOUS);
    assert.equal(existsSync(backupPath), false);
  });

  it("leaves no core behind when the config write fails on a fresh install", async () => {
    const { stagedLibrary, libraryPath, backupPath } = setup(false);

    await assert.rejects(
      swapCoreLibrary(stagedLibrary, libraryPath, async () => {
        throw new Error("config write rejected");
      })
    );

    assert.equal(existsSync(libraryPath), false);
    assert.equal(existsSync(backupPath), false);
  });

  it("restores the previous core when the copy itself fails", async () => {
    const { libraryPath, backupPath } = setup(true);
    const missingStaged = path.join(
      path.dirname(libraryPath),
      "does-not-exist"
    );

    await assert.rejects(
      swapCoreLibrary(missingStaged, libraryPath, async () => {
        throw new Error("persistConfig must not run after a failed copy");
      })
    );

    assert.equal(readFileSync(libraryPath, "utf8"), PREVIOUS);
    assert.equal(existsSync(backupPath), false);
  });
});
