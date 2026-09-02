import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  archiveEntriesBelongToDirectory,
  discoverDolphinGamecubeSaves,
  discoverPpssppSaves,
  emulationSavePlatformToSystem,
  isSafeEmulationSaveArchiveEntry,
  parseGciGameId,
  parseGciInternalFileName,
  parseDolphinWiiExportPath,
} from "./emulation-file-saves.js";

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-emulation-save-test-")
  );
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

const buildParamSfo = (key: string, value: string): Buffer => {
  const keyData = Buffer.from(`${key}\0`, "ascii");
  const valueData = Buffer.from(`${value}\0`, "ascii");
  const keyTableStart = 20 + 16;
  const dataTableStart = keyTableStart + keyData.length;
  const buffer = Buffer.alloc(dataTableStart + valueData.length);
  buffer.writeUInt32LE(0x46535000, 0);
  buffer.writeUInt32LE(0x00000101, 4);
  buffer.writeUInt32LE(keyTableStart, 8);
  buffer.writeUInt32LE(dataTableStart, 12);
  buffer.writeUInt32LE(1, 16);
  buffer.writeUInt16LE(0, 20);
  buffer.writeUInt16LE(0x0204, 22);
  buffer.writeUInt32LE(valueData.length, 24);
  buffer.writeUInt32LE(valueData.length, 28);
  buffer.writeUInt32LE(0, 32);
  keyData.copy(buffer, keyTableStart);
  valueData.copy(buffer, dataTableStart);
  return buffer;
};

describe("emulator file saves", () => {
  it("keeps Dolphin unified while preserving cloud platform identities", () => {
    assert.equal(emulationSavePlatformToSystem("gamecube"), "dolphin");
    assert.equal(emulationSavePlatformToSystem("wii"), "dolphin");
    assert.equal(emulationSavePlatformToSystem("psp"), "psp");
  });

  it("discovers a complete PPSSPP savedata directory from portable storage", async () => {
    const root = await makeTemporaryDirectory();
    const executablePath = path.join(root, "PPSSPPWindows64.exe");
    const systemPath = path.join(root, "memstick", "PSP", "SYSTEM");
    const savedataPath = path.join(
      root,
      "memstick",
      "PSP",
      "SAVEDATA",
      "ULUS105670000"
    );
    await fs.mkdir(systemPath, { recursive: true });
    await fs.mkdir(savedataPath, { recursive: true });
    await fs.writeFile(path.join(systemPath, "ppsspp.ini"), "[General]\n");
    await fs.writeFile(
      path.join(savedataPath, "PARAM.SFO"),
      buildParamSfo("DISC_ID", "ULUS10567")
    );
    await fs.writeFile(path.join(savedataPath, "DATA.BIN"), "save");

    const saves = await discoverPpssppSaves(executablePath);

    assert.equal(saves.length, 1);
    assert.equal(saves[0]?.sku, "ULUS10567");
    assert.equal(saves[0]?.saveIdentity, "ULUS105670000");
    assert.deepEqual(saves[0]?.metadata, {
      schemaVersion: 1,
      artifactFormat: "ppsspp-savedata-zip",
      discId: "ULUS10567",
      savedataDirectory: "ULUS105670000",
    });
    assert.equal(saves[0]?.fileCount, 2);
  });

  it("reads GameCube identity and discovers a portable Dolphin GCI folder", async () => {
    const root = await makeTemporaryDirectory();
    const executablePath = path.join(root, "Dolphin.exe");
    const portableUserDirectory =
      process.platform === "linux" ? "user" : "User";
    const cardPath = path.join(
      root,
      portableUserDirectory,
      "GC",
      "USA",
      "Card A"
    );
    await fs.writeFile(path.join(root, "portable.txt"), "");
    await fs.mkdir(cardPath, { recursive: true });
    const header = Buffer.alloc(0x40);
    header.write("GM8E01", 0, "ascii");
    header.write("gczelda", 8, "ascii");
    await fs.writeFile(path.join(cardPath, "zelda.gci"), header);

    assert.equal(parseGciGameId(header), "GM8E01");
    assert.equal(parseGciInternalFileName(header), "gczelda");

    const saves = await discoverDolphinGamecubeSaves(executablePath);

    assert.equal(saves.length, 1);
    assert.equal(saves[0]?.saveIdentity, "A:USA:GM8E01:gczelda");
    assert.deepEqual(saves[0]?.metadata, {
      schemaVersion: 1,
      artifactFormat: "dolphin-gci",
      gameId: "GM8E01",
      slot: "A",
      region: "USA",
      internalFileName: "gczelda",
    });
  });

  it("rejects absolute and parent paths in PPSSPP save archives", () => {
    assert.equal(isSafeEmulationSaveArchiveEntry("ULUS10567/PARAM.SFO"), true);
    assert.equal(isSafeEmulationSaveArchiveEntry("../PARAM.SFO"), false);
    assert.equal(
      isSafeEmulationSaveArchiveEntry("folder\\..\\PARAM.SFO"),
      false
    );
    assert.equal(isSafeEmulationSaveArchiveEntry("/tmp/PARAM.SFO"), false);
    assert.equal(isSafeEmulationSaveArchiveEntry("C:/temp/PARAM.SFO"), false);
    assert.equal(
      archiveEntriesBelongToDirectory(
        ["ULUS105670000", "ULUS105670000/PARAM.SFO"],
        "ULUS105670000"
      ),
      true
    );
    assert.equal(
      archiveEntriesBelongToDirectory(
        ["ULUS105670000/PARAM.SFO", "another-save/PARAM.SFO"],
        "ULUS105670000"
      ),
      false
    );
  });

  it("derives a Wii title ID only from Dolphin's native export layout", () => {
    assert.deepEqual(
      parseDolphinWiiExportPath(
        "D:\\Wii Saves\\private\\wii\\title\\RMGE\\data.bin"
      ),
      { gameCode: "RMGE", titleId: "00010000524d4745" }
    );
    assert.equal(parseDolphinWiiExportPath("D:\\Wii Saves\\data.bin"), null);
  });
});
