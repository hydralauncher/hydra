import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  resolveShadps4DataDirStatus,
  validateShadps4DataDir,
} from "./shadps4-data-dir.js";

let root: string;
let previousAppData: string | undefined;
let previousXdgDataHome: string | undefined;

const writeConfig = async (dataDir: string, config: unknown) => {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    path.join(dataDir, "config.json"),
    typeof config === "string" ? config : JSON.stringify(config)
  );
};

const real = (target: string) => fs.realpath(target);

describe("shadPS4 data folder", () => {
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-shadps4-data-"));
    previousAppData = process.env["APPDATA"];
    previousXdgDataHome = process.env["XDG_DATA_HOME"];
    process.env["APPDATA"] = path.join(root, "appdata");
    process.env["XDG_DATA_HOME"] = path.join(root, "appdata");
    await fs.mkdir(path.join(root, "emulator"), { recursive: true });
    await fs.writeFile(path.join(root, "emulator", "shadPS4.exe"), "");
  });

  afterEach(async () => {
    process.env["APPDATA"] = previousAppData;
    process.env["XDG_DATA_HOME"] = previousXdgDataHome;
    await fs.rm(root, { recursive: true, force: true });
  });

  const exe = () => path.join(root, "emulator", "shadPS4.exe");
  const portable = () => path.join(root, "emulator", "user");
  const standard = () => path.join(root, "appdata", "shadPS4");

  it("uses <data>/home when General.home_dir is empty or missing", async () => {
    await writeConfig(portable(), { General: { home_dir: "" } });
    await fs.mkdir(path.join(portable(), "home"));
    assert.deepEqual(await validateShadps4DataDir(portable()), {
      dataDir: await real(portable()),
      homeRoot: await real(path.join(portable(), "home")),
    });

    await writeConfig(portable(), {});
    assert.equal(
      (await validateShadps4DataDir(portable()))?.homeRoot,
      await real(path.join(portable(), "home"))
    );
  });

  it("follows a custom General.home_dir", async () => {
    const customHome = path.join(root, "elsewhere", "ps4-home");
    await fs.mkdir(customHome, { recursive: true });
    await writeConfig(portable(), { General: { home_dir: customHome } });
    assert.equal(
      (await validateShadps4DataDir(portable()))?.homeRoot,
      await real(customHome)
    );
  });

  it("resolves a relative General.home_dir from the launcher folder", async () => {
    await writeConfig(portable(), { General: { home_dir: "ps4-home" } });
    await fs.mkdir(path.join(root, "emulator", "ps4-home"));
    assert.equal(
      (await validateShadps4DataDir(portable(), path.join(root, "emulator")))
        ?.homeRoot,
      await real(path.join(root, "emulator", "ps4-home"))
    );
    const { status, location } = await resolveShadps4DataDirStatus(exe(), null);
    assert.equal(status.status, "ready");
    assert.equal(
      location?.homeRoot,
      await real(path.join(root, "emulator", "ps4-home"))
    );
  });

  it("rejects folders without a usable config.json or home", async () => {
    await fs.mkdir(portable(), { recursive: true });
    assert.equal(await validateShadps4DataDir(portable()), null);

    await writeConfig(portable(), "{ not json");
    assert.equal(await validateShadps4DataDir(portable()), null);

    await writeConfig(portable(), { General: { home_dir: "relative/home" } });
    assert.equal(await validateShadps4DataDir(portable()), null);

    await writeConfig(portable(), { General: {} });
    assert.equal(await validateShadps4DataDir(portable()), null);
  });

  it("prefers the portable folder, like shadPS4 does", async () => {
    for (const dir of [portable(), standard()]) {
      await writeConfig(dir, {});
      await fs.mkdir(path.join(dir, "home"));
    }
    const { status, location } = await resolveShadps4DataDirStatus(exe(), null);
    assert.equal(status.status, "ready");
    assert.equal(location?.dataDir, await real(portable()));
    assert.deepEqual(
      status.candidates.sort(),
      [await real(portable()), await real(standard())].sort()
    );
  });

  it("does not fall back to the default folder past a portable one", async () => {
    await fs.mkdir(portable(), { recursive: true });
    await writeConfig(standard(), {});
    await fs.mkdir(path.join(standard(), "home"));
    const { status, location } = await resolveShadps4DataDirStatus(exe(), null);
    assert.equal(status.status, "missing");
    assert.equal(location, null);
    assert.deepEqual(status.candidates, [await real(standard())]);
  });

  it("uses the default folder when there is no portable one", async () => {
    await writeConfig(standard(), {});
    await fs.mkdir(path.join(standard(), "home"));
    const { status, location } = await resolveShadps4DataDirStatus(exe(), null);
    assert.equal(status.status, "ready");
    assert.equal(location?.dataDir, await real(standard()));
  });

  it("honours a valid selection and reports an invalid one", async () => {
    await fs.mkdir(portable(), { recursive: true });
    await writeConfig(standard(), {});
    await fs.mkdir(path.join(standard(), "home"));

    const selected = await resolveShadps4DataDirStatus(exe(), standard());
    assert.equal(selected.status.status, "ready");
    assert.equal(selected.location?.dataDir, await real(standard()));

    const invalid = await resolveShadps4DataDirStatus(exe(), portable());
    assert.equal(invalid.status.status, "invalid-selection");
    assert.equal(invalid.location, null);
  });

  it("is not configured without an existing executable", async () => {
    assert.equal(
      (await resolveShadps4DataDirStatus(null, null)).status.status,
      "not-configured"
    );
    assert.equal(
      (
        await resolveShadps4DataDirStatus(
          path.join(root, "missing", "shadPS4.exe"),
          null
        )
      ).status.status,
      "not-configured"
    );
  });
});
