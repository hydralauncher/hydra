import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  parseRetroArchSaveConfig,
  createRetroArchGameSaveFileFilter,
  resolveRetroArchSaveDirectory,
  resolveRetroArchOverrideDirectory,
  retroArchBatterySuffixes,
  retroArchLogicalNameForPhysicalFile,
  retroArchPhysicalSaveName,
  retroArchSaveStem,
  retroArchStateSuffix,
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
    assert.equal(
      parseRetroArchSaveConfig('display_version = "1.61"\n').display_version,
      "1.61"
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
      resolve({ savefile_directory: "~/saves" }),
      path.join(homeDir, "saves", "mGBA")
    );
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
      path.join(path.dirname(romPath), "mGBA")
    );
  });

  it("resolves state settings independently of battery saves", () => {
    const values = {
      savefile_directory: "~/saves",
      savestate_directory: "~/states",
      sort_savefiles_enable: "false",
      sort_savestates_enable: "true",
      sort_savestates_by_content_enable: "true",
    };
    assert.equal(
      resolveRetroArchSaveDirectory({
        values,
        configPath,
        homeDir,
        romPath,
        coreName: "mGBA",
        kind: "save",
      }),
      path.join(homeDir, "saves")
    );
    assert.equal(
      resolveRetroArchSaveDirectory({
        values,
        configPath,
        homeDir,
        romPath,
        coreName: "mGBA",
        kind: "state",
      }),
      path.join(homeDir, "states", "gba", "mGBA")
    );
    assert.equal(
      resolveRetroArchSaveDirectory({
        values: {
          savestate_directory: "default",
          savestates_in_content_dir: "true",
        },
        configPath,
        homeDir,
        romPath,
        coreName: "mGBA",
        kind: "state",
      }),
      path.join(path.dirname(romPath), "mGBA")
    );
    assert.equal(
      resolveRetroArchSaveDirectory({
        values: { savestate_directory: "default" },
        configPath,
        homeDir,
        romPath,
        coreName: "mGBA",
        kind: "state",
      }),
      null
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
      retroArchPhysicalSaveName(romPath, "state.state1"),
      "Metroid.state1"
    );
    assert.equal(
      retroArchPhysicalSaveName(romPath, "state.state.auto.png"),
      "Metroid.state.auto.png"
    );
    assert.equal(
      retroArchSaveStem("/roms/Metroid.gba"),
      retroArchSaveStem("/other/metroid.zip")
    );
  });

  it("accepts per-core saves, numbered states and paired images only", () => {
    assert.deepEqual(retroArchBatterySuffixes("gba"), [".srm"]);
    assert.deepEqual(retroArchBatterySuffixes("snes"), [".srm", ".rtc"]);
    assert.deepEqual(retroArchBatterySuffixes("gb"), [".srm", ".rtc"]);
    assert.deepEqual(retroArchBatterySuffixes("gbc"), [".srm", ".rtc"]);
    assert.deepEqual(retroArchBatterySuffixes("nes"), [".srm"]);
    assert.deepEqual(retroArchBatterySuffixes("n64"), [".srm"]);
    assert.equal(retroArchStateSuffix("Metroid.state1", "Metroid"), ".state1");
    assert.equal(
      retroArchStateSuffix("Metroid.state.auto", "Metroid"),
      ".state.auto"
    );
    assert.equal(retroArchStateSuffix("Other.state1", "Metroid"), null);
    assert.equal(
      retroArchLogicalNameForPhysicalFile(romPath, "Metroid.srm", "gba"),
      "battery.srm"
    );
    assert.equal(
      retroArchLogicalNameForPhysicalFile(romPath, "Metroid.rtc", "gba"),
      null
    );
    assert.equal(
      retroArchLogicalNameForPhysicalFile(romPath, "Metroid.state1", "gba"),
      "state.state1"
    );
    assert.equal(
      retroArchLogicalNameForPhysicalFile(romPath, "Metroid.state1.png", "gba"),
      null
    );
    assert.equal(
      retroArchLogicalNameForPhysicalFile(
        romPath,
        "Metroid.state1.png",
        "gba",
        true
      ),
      "state.state1.png"
    );
    assert.equal(
      retroArchLogicalNameForPhysicalFile(romPath, "Other.srm", "gba"),
      null
    );
    const n64 = "/roms/Pokemon Stadium.z64";
    assert.equal(
      retroArchLogicalNameForPhysicalFile(
        n64,
        "Pokemon Stadium.z64.sav",
        "n64"
      ),
      null
    );
    assert.equal(
      retroArchLogicalNameForPhysicalFile(
        n64,
        "Pokemon Stadium.z64.sav",
        "n64",
        false,
        true
      ),
      "transfer-pak.sav"
    );
    assert.equal(
      retroArchLogicalNameForPhysicalFile(
        n64,
        "Pokemon Stadium.z64.gb",
        "n64",
        false,
        true
      ),
      null
    );
  });

  it("filters a shared directory to one ROM, including paired state images", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "retroarch-filter-"));
    try {
      const rom = path.join(root, "Mario.sfc");
      const files = [
        "Mario.srm",
        "Mario.state1",
        "Mario.state1.png",
        "Mario.state2.png",
        "Zelda.srm",
        "Zelda.state1",
      ];
      for (const file of files) await fs.writeFile(path.join(root, file), file);
      const filter = createRetroArchGameSaveFileFilter([rom], "snes");
      const accepted: string[] = [];
      for (const file of files) {
        if (await filter(path.join(root, file))) accepted.push(file);
      }
      assert.deepEqual(accepted, [
        "Mario.srm",
        "Mario.state1",
        "Mario.state1.png",
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses RetroArch's rgui_config_directory for overrides", () => {
    assert.equal(
      resolveRetroArchOverrideDirectory({}, configPath, homeDir),
      path.join(path.dirname(configPath), "config")
    );
    assert.equal(
      resolveRetroArchOverrideDirectory(
        {},
        path.join(homeDir, "RetroArch", "config", "retroarch.cfg"),
        homeDir
      ),
      path.join(homeDir, "RetroArch", "config")
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
