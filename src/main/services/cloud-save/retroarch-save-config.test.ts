import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  parseRetroArchSaveConfig,
  resolveRetroArchSaveDirectory,
  resolveRetroArchOverrideDirectory,
  retroArchPhysicalSaveName,
  retroArchSaveStem,
  shouldLoadRetroArchOverrides,
} from "./retroarch-save-config.js";

describe("RetroArch save layout", () => {
  const configPath = path.join(
    path.sep,
    "home",
    "user",
    "retroarch",
    "retroarch.cfg"
  );
  const romPath = path.join(path.sep, "roms", "gba", "Metroid.gba");
  const homeDir = path.join(path.sep, "home", "user");

  it("reads quoted values and ignores comments", () => {
    assert.deepEqual(
      parseRetroArchSaveConfig(
        '# comment\nsavefile_directory = "~/saves"\nsort_savefiles_enable = "true"\n'
      ),
      { savefile_directory: "~/saves", sort_savefiles_enable: "true" }
    );
  });

  it("resolves content and sorted save directories", () => {
    const resolve = (values: Record<string, string>) =>
      resolveRetroArchSaveDirectory({
        values,
        configPath,
        homeDir,
        romPath,
        coreName: "mGBA",
      });
    assert.equal(resolve({}), null);
    assert.equal(resolve({ savefile_directory: "default" }), null);
    assert.equal(
      resolve({
        savefile_directory: "~/saves",
        sort_savefiles_by_content_enable: "true",
        sort_savefiles_enable: "true",
      }),
      path.join(homeDir, "saves", "gba", "mGBA")
    );
    assert.equal(
      resolve({
        savefile_directory: "~/saves",
        savefiles_in_content_dir: "true",
      }),
      path.dirname(romPath)
    );
  });

  it("maps logical saves to the local ROM filename", () => {
    assert.equal(
      retroArchPhysicalSaveName(romPath, "battery.srm"),
      "Metroid.srm"
    );
    assert.equal(
      retroArchPhysicalSaveName(
        path.join(path.sep, "roms", "gba", "Metroid.zip"),
        "battery.srm"
      ),
      "Metroid.srm"
    );
    assert.equal(retroArchPhysicalSaveName(romPath, "other.srm"), null);
    assert.equal(retroArchPhysicalSaveName(romPath, "battery.exe"), null);
    assert.equal(
      retroArchSaveStem("/roms/Metroid.gba"),
      retroArchSaveStem("/other/metroid.zip")
    );
  });

  it("uses RetroArch's rgui_config_directory for overrides", () => {
    assert.equal(
      resolveRetroArchOverrideDirectory({}, configPath, homeDir),
      path.join(path.dirname(configPath), "config")
    );
    assert.equal(
      resolveRetroArchOverrideDirectory(
        { rgui_config_directory: "~/custom-config" },
        configPath,
        homeDir
      ),
      path.join(homeDir, "custom-config")
    );
    assert.equal(
      shouldLoadRetroArchOverrides({ auto_overrides_enable: "false" }),
      false
    );
    assert.equal(shouldLoadRetroArchOverrides({}), true);
  });
});
