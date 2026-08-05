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

import { swapDirectory } from "./swap-directory.js";

const PREVIOUS = "previous build";
const STAGED = "staged build";

interface Fixture {
  stagingDir: string;
  targetDir: string;
  backupDir: string;
  executable: string;
}

const writeFile = (filePath: string, contents: string): void => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
};

const setup = (withPrevious: boolean): Fixture => {
  const root = mkdtempSync(path.join(tmpdir(), "swap-dir-"));
  const targetDir = path.join(root, "emulator");
  const stagingDir = `${targetDir}-staging`;

  writeFile(path.join(stagingDir, "nested", "retroarch"), STAGED);
  if (withPrevious) {
    writeFile(path.join(targetDir, "nested", "retroarch"), PREVIOUS);
    writeFile(path.join(targetDir, "leftover.cfg"), PREVIOUS);
  }

  return {
    stagingDir,
    targetDir,
    backupDir: `${targetDir}.backup`,
    executable: path.join(targetDir, "nested", "retroarch"),
  };
};

describe("swapDirectory", () => {
  it("installs the staged build and clears the backup on success", async () => {
    const f = setup(true);

    await swapDirectory(f.stagingDir, f.targetDir, async () => {});

    assert.equal(readFileSync(f.executable, "utf8"), STAGED);
    assert.equal(existsSync(f.backupDir), false);
    assert.equal(existsSync(f.stagingDir), false);
  });

  it("keeps user files the new build does not ship, such as downloaded cores", async () => {
    const f = setup(true);
    writeFile(path.join(f.targetDir, "cores", "fceumm.dll"), PREVIOUS);

    await swapDirectory(f.stagingDir, f.targetDir, async () => {});

    assert.equal(readFileSync(f.executable, "utf8"), STAGED);
    assert.equal(
      readFileSync(path.join(f.targetDir, "cores", "fceumm.dll"), "utf8"),
      PREVIOUS
    );
    assert.equal(
      readFileSync(path.join(f.targetDir, "leftover.cfg"), "utf8"),
      PREVIOUS
    );
  });

  it("installs when there is no previous build", async () => {
    const f = setup(false);

    await swapDirectory(f.stagingDir, f.targetDir, async () => {});

    assert.equal(readFileSync(f.executable, "utf8"), STAGED);
    assert.equal(existsSync(f.backupDir), false);
  });

  it("restores the previous build when the commit fails", async () => {
    const f = setup(true);
    const failure = new Error("config write rejected");

    await assert.rejects(
      swapDirectory(f.stagingDir, f.targetDir, async () => {
        assert.equal(readFileSync(f.executable, "utf8"), STAGED);
        throw failure;
      }),
      failure
    );

    assert.equal(readFileSync(f.executable, "utf8"), PREVIOUS);
    assert.equal(
      readFileSync(path.join(f.targetDir, "leftover.cfg"), "utf8"),
      PREVIOUS
    );
    assert.equal(existsSync(f.backupDir), false);
  });

  it("leaves nothing behind when the commit fails on a fresh install", async () => {
    const f = setup(false);

    await assert.rejects(
      swapDirectory(f.stagingDir, f.targetDir, async () => {
        throw new Error("config write rejected");
      })
    );

    assert.equal(existsSync(f.targetDir), false);
    assert.equal(existsSync(f.backupDir), false);
  });

  it("restores the previous build when the staged directory is missing", async () => {
    const f = setup(true);

    await assert.rejects(
      swapDirectory(`${f.stagingDir}-gone`, f.targetDir, async () => {
        throw new Error("commit must not run after a failed rename");
      })
    );

    assert.equal(readFileSync(f.executable, "utf8"), PREVIOUS);
    assert.equal(existsSync(f.backupDir), false);
  });
});
