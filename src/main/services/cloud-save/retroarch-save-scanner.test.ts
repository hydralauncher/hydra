import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  discoverRetroArchTargets,
  retroArchTargetForFile,
  type RomSaveLocation,
} from "./retroarch-save-scanner.js";

describe("RetroArch save scanner", () => {
  it("finds own battery saves and state slots across separate directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "retroarch-scan-"));
    try {
      const saveDirectory = path.join(root, "saves", "Snes9x");
      const stateDirectory = path.join(root, "states", "Snes9x");
      await fs.mkdir(saveDirectory, { recursive: true });
      await fs.mkdir(stateDirectory, { recursive: true });
      for (const [directory, files] of [
        [saveDirectory, ["Mario.srm", "Mario.rtc", "Zelda.srm"]],
        [
          stateDirectory,
          [
            "Mario.state",
            "Mario.state1",
            "Mario.state1.png",
            "Mario.state.auto",
            "Mario.state2.png",
            "Zelda.state1",
          ],
        ],
      ] as const) {
        for (const file of files)
          await fs.writeFile(path.join(directory, file), file);
      }
      const location: RomSaveLocation = {
        rawPath: "<emulator>/retroarch/snes/1234ABCD",
        romPath: path.join(root, "roms", "Mario.sfc"),
        stem: "Mario",
        saveDirectory,
        stateDirectory,
        hasTransferPak: false,
      };
      const result = await discoverRetroArchTargets(location, "snes");
      assert.equal(result.complete, true);
      assert.deepEqual(
        result.targets
          .filter((target) =>
            [
              "Mario.srm",
              "Mario.rtc",
              "Mario.state",
              "Mario.state1",
              "Mario.state1.png",
              "Mario.state.auto",
            ].includes(path.basename(target.filePath))
          )
          .map((target) => target.relativePath)
          .sort(),
        [
          "battery.rtc",
          "battery.srm",
          "state.state",
          "state.state.auto",
          "state.state1",
          "state.state1.png",
        ]
      );
      assert.equal(
        result.targets.some((target) =>
          /Zelda|state2\.png/.test(target.filePath)
        ),
        false
      );
      assert.equal(
        retroArchTargetForFile(
          {
            ...location,
            romPath: path.join(root, "roms", "Renamed Mario.sfc"),
          },
          "state.state1"
        )?.filePath,
        path.join(stateDirectory, "Renamed Mario.state1")
      );
      assert.equal(
        retroArchTargetForFile(location, "battery.sav")?.filePath,
        path.join(saveDirectory, "Mario.sav")
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("accepts Transfer Pak only with an associated companion ROM", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "retroarch-pak-"));
    try {
      const romPath = path.join(root, "Pokemon Stadium.z64");
      const location: RomSaveLocation = {
        rawPath: "<emulator>/retroarch/n64/1234ABCD",
        romPath,
        stem: "Pokemon Stadium",
        saveDirectory: root,
        stateDirectory: root,
        hasTransferPak: false,
      };
      assert.equal(retroArchTargetForFile(location, "transfer-pak.sav"), null);
      assert.equal(
        retroArchTargetForFile(
          { ...location, hasTransferPak: true },
          "transfer-pak.sav"
        )?.filePath,
        `${romPath}.sav`
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps missing save or state roots partial so remote files survive", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "retroarch-missing-"));
    try {
      const saveDirectory = path.join(root, "saves");
      const stateDirectory = path.join(root, "states");
      await fs.mkdir(saveDirectory);
      const location: RomSaveLocation = {
        rawPath: "<emulator>/retroarch/snes/1234ABCD",
        romPath: path.join(root, "Mario.sfc"),
        stem: "Mario",
        saveDirectory,
        stateDirectory,
        hasTransferPak: false,
      };
      assert.equal(
        (await discoverRetroArchTargets(location, "snes")).complete,
        false
      );
      await fs.mkdir(stateDirectory);
      assert.equal(
        (await discoverRetroArchTargets(location, "snes")).complete,
        true
      );
      await fs.rm(saveDirectory, { recursive: true });
      assert.equal(
        (await discoverRetroArchTargets(location, "snes")).complete,
        false
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("retains old V2 extra saves and marks ambiguous .sav partial", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "retroarch-old-"));
    try {
      await fs.writeFile(path.join(root, "Mario.eep"), "legacy");
      await fs.writeFile(path.join(root, "Mario.sav"), "ambiguous");
      await fs.writeFile(path.join(root, "Zelda.eep"), "other game");
      const location: RomSaveLocation = {
        rawPath: "<emulator>/retroarch/snes/1234ABCD",
        romPath: path.join(root, "Mario.sfc"),
        stem: "Mario",
        saveDirectory: root,
        stateDirectory: root,
        hasTransferPak: false,
      };
      const result = await discoverRetroArchTargets(location, "snes");
      assert.equal(result.complete, false);
      assert.equal(
        result.targets.some((target) => target.relativePath === "battery.eep"),
        true
      );
      assert.equal(
        result.targets.some((target) => target.relativePath === "battery.sav"),
        false
      );
      assert.equal(
        result.targets.some((target) => target.filePath.endsWith("Zelda.eep")),
        false
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
