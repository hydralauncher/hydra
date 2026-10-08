import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  resolveRpcs3ConfigRootStatus,
  validateRpcs3ConfigRoot,
} from "./rpcs3-config-root.js";

const withFixture = async (
  test: (root: string, executable: string) => Promise<void>
) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-config-"));
  const executable = path.join(root, "rpcs3");
  try {
    await fs.writeFile(executable, "");
    await test(root, executable);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
};

const validRoot = async (root: string, profile = "00000001") => {
  await fs.mkdir(path.join(root, "GuiConfigs"), { recursive: true });
  await fs.mkdir(path.join(root, "dev_hdd0"), { recursive: true });
  await fs.writeFile(
    path.join(root, "GuiConfigs", "persistent_settings.dat"),
    `[Users]\nactive_user=${profile}\n`
  );
  await fs.writeFile(
    path.join(root, "vfs.yml"),
    '"/dev_hdd0/": "$(EmulatorDir)dev_hdd0/"\n'
  );
};

describe("RPCS3 configuration root selection", () => {
  it("separates missing, unique and multiple valid roots", async () =>
    withFixture(async (root, executable) => {
      const first = path.join(root, "first");
      const second = path.join(root, "second");
      assert.equal(
        (await resolveRpcs3ConfigRootStatus(executable, null, [first, second]))
          .status.status,
        "missing"
      );
      await validRoot(first);
      const unique = await resolveRpcs3ConfigRootStatus(executable, null, [
        first,
        second,
      ]);
      assert.equal(unique.status.status, "ready");
      assert.equal(unique.location?.configRoot, await fs.realpath(first));
      await validRoot(second, "00000002");
      const ambiguous = await resolveRpcs3ConfigRootStatus(executable, null, [
        first,
        second,
      ]);
      assert.equal(ambiguous.status.status, "ambiguous");
      assert.equal(ambiguous.location, null);
      assert.deepEqual(ambiguous.status.candidates, [
        await fs.realpath(first),
        await fs.realpath(second),
      ]);
    }));

  it("deduplicates symlinks and binds the selected root", async () =>
    withFixture(async (root, executable) => {
      const actual = path.join(root, "actual");
      const alias = path.join(root, "alias");
      await validRoot(actual, "00000002");
      await fs.symlink(actual, alias);
      const unique = await resolveRpcs3ConfigRootStatus(executable, null, [
        actual,
        alias,
      ]);
      assert.equal(unique.status.status, "ready");
      assert.deepEqual(unique.status.candidates, [await fs.realpath(actual)]);
      const selected = await resolveRpcs3ConfigRootStatus(
        executable,
        alias,
        []
      );
      assert.equal(
        selected.location?.homeRoot,
        path.join(await fs.realpath(path.join(actual, "dev_hdd0")), "home")
      );
    }));

  it("never switches an invalid saved choice to another valid folder", async () =>
    withFixture(async (root, executable) => {
      const chosen = path.join(root, "chosen");
      const alternative = path.join(root, "alternative");
      await validRoot(chosen);
      await validRoot(alternative);
      await fs.rm(chosen, { recursive: true });
      const result = await resolveRpcs3ConfigRootStatus(executable, chosen, [
        alternative,
      ]);
      assert.equal(result.status.status, "invalid-selection");
      assert.equal(result.location, null);
      assert.deepEqual(result.status.candidates, [
        await fs.realpath(alternative),
      ]);
    }));

  it("rejects malformed VFS, missing dev_hdd0 and folders without configuration", async () =>
    withFixture(async (root) => {
      const candidate = path.join(root, "candidate");
      await fs.mkdir(candidate);
      assert.equal(await validateRpcs3ConfigRoot(candidate), null);
      await validRoot(candidate);
      await fs.writeFile(
        path.join(candidate, "vfs.yml"),
        '"/dev_hdd0/": "relative/path"\n'
      );
      assert.equal(await validateRpcs3ConfigRoot(candidate), null);
      await fs.writeFile(
        path.join(candidate, "vfs.yml"),
        '"/dev_hdd0/": "$(EmulatorDir)dev_hdd0/"\n'
      );
      await fs.rm(path.join(candidate, "dev_hdd0"), { recursive: true });
      assert.equal(await validateRpcs3ConfigRoot(candidate), null);
    }));

  it("rejects malformed RPCS3 configuration", async () =>
    withFixture(async (root) => {
      const candidate = path.join(root, "candidate");
      await validRoot(candidate);
      await fs.writeFile(path.join(candidate, "config.yml"), "broken: [");
      assert.equal(await validateRpcs3ConfigRoot(candidate), null);
    }));

  it("keeps a VFS-only installation usable", async () =>
    withFixture(async (root, executable) => {
      const candidate = path.join(root, "candidate");
      await fs.mkdir(path.join(candidate, "dev_hdd0"), { recursive: true });
      await fs.writeFile(
        path.join(candidate, "vfs.yml"),
        '"/dev_hdd0/": "$(EmulatorDir)dev_hdd0/"\n'
      );
      const result = await resolveRpcs3ConfigRootStatus(executable, null, [
        candidate,
      ]);
      assert.equal(result.status.status, "ready");
      assert.equal(
        result.location?.homeRoot,
        path.join(await fs.realpath(path.join(candidate, "dev_hdd0")), "home")
      );
    }));

  it("requires configured executable", async () =>
    withFixture(async (root) => {
      await validRoot(path.join(root, "valid"));
      const result = await resolveRpcs3ConfigRootStatus(null, null, [
        path.join(root, "valid"),
      ]);
      assert.equal(result.status.status, "not-configured");
      assert.equal(result.location, null);
    }));
});
