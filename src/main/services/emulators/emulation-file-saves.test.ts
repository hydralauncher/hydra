import assert from "node:assert/strict";
import { createDecipheriv, createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  archiveEntriesBelongToDirectory,
  buildDolphinWiiDataBin,
  discoverDolphinGamecubeSaves,
  discoverDolphinWiiSaves,
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
      buildParamSfo("SAVEDATA_DIRECTORY", "ULUS105670000")
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

  it("discovers a Wii NAND save and exports a Dolphin-importable data.bin", async () => {
    const root = await makeTemporaryDirectory();
    const executablePath = path.join(root, "Dolphin.exe");
    const portableUserDirectory =
      process.platform === "linux" ? "user" : "User";
    const dataPath = path.join(
      root,
      portableUserDirectory,
      "Wii",
      "title",
      "00010000",
      "524d4345",
      "data"
    );
    await fs.writeFile(path.join(root, "portable.txt"), "");
    await fs.mkdir(dataPath, { recursive: true });
    const tmd = Buffer.alloc(0x19a);
    Buffer.from("00010000524d4345", "hex").copy(tmd, 0x18c);
    tmd.write("01", 0x198, "ascii");
    await fs.mkdir(path.join(path.dirname(dataPath), "content"));
    await fs.writeFile(
      path.join(path.dirname(dataPath), "content", "title.tmd"),
      tmd
    );
    const banner = Buffer.alloc(0x72a0);
    banner[7] = 1;
    await fs.writeFile(path.join(dataPath, "banner.bin"), banner);
    await fs.writeFile(path.join(dataPath, "rksys.dat"), "save-data");

    const saves = await discoverDolphinWiiSaves(executablePath);
    assert.equal(saves.length, 1);
    assert.equal(saves[0]?.sku, "RMCE01");
    assert.equal(saves[0]?.saveIdentity, "00010000524d4345");
    assert.equal(saves[0]?.fileCount, 2);
    assert.deepEqual(saves[0]?.metadata, {
      schemaVersion: 1,
      artifactFormat: "dolphin-wii-data-bin",
      titleId: "00010000524d4345",
      gameId: "RMCE01",
    });

    const dataBin = await buildDolphinWiiDataBin(dataPath, "00010000524d4345");
    const decipher = createDecipheriv(
      "aes-128-cbc",
      Buffer.from("ab01b9d8e1622b08afbad84dbfc2a55d", "hex"),
      Buffer.from("216712e6aa1f689f95c5a22324dc6a98", "hex")
    );
    decipher.setAutoPadding(false);
    const header = Buffer.concat([
      decipher.update(dataBin.subarray(0, 0xf0c0)),
      decipher.final(),
    ]);
    assert.equal(header.readBigUInt64BE(0), 0x00010000524d4345n);
    assert.equal(header.readUInt32BE(8), 0x72a0);
    assert.equal(header[0x27] & 1, 0);
    const storedMd5 = Buffer.from(header.subarray(0x0e, 0x1e));
    Buffer.from("0e65378199be4517ab06ec22451a5793", "hex").copy(header, 0x0e);
    assert.deepEqual(createHash("md5").update(header).digest(), storedMd5);

    const backupHeaderOffset = 0xf0c0;
    assert.equal(dataBin.readUInt32BE(backupHeaderOffset), 0x70);
    assert.equal(dataBin.readUInt32BE(backupHeaderOffset + 4), 0x426b0001);
    assert.equal(dataBin.readUInt32BE(backupHeaderOffset + 0x0c), 1);
    assert.equal(
      dataBin.readBigUInt64BE(backupHeaderOffset + 0x60),
      0x00010000524d4345n
    );

    const fileHeaderOffset = backupHeaderOffset + 0x80;
    assert.equal(dataBin.readUInt32BE(fileHeaderOffset), 0x03adf17e);
    assert.equal(dataBin.readUInt32BE(fileHeaderOffset + 4), 9);
    assert.equal(dataBin[fileHeaderOffset + 0x0a], 1);
    assert.equal(
      dataBin
        .subarray(fileHeaderOffset + 0x0b, fileHeaderOffset + 0x4b)
        .toString("utf8")
        .replaceAll("\0", ""),
      "rksys.dat"
    );
    const fileDecipher = createDecipheriv(
      "aes-128-cbc",
      Buffer.from("ab01b9d8e1622b08afbad84dbfc2a55d", "hex"),
      Buffer.alloc(16)
    );
    fileDecipher.setAutoPadding(false);
    const fileDataOffset = fileHeaderOffset + 0x80;
    const fileData = Buffer.concat([
      fileDecipher.update(
        dataBin.subarray(fileDataOffset, fileDataOffset + 0x40)
      ),
      fileDecipher.final(),
    ]);
    assert.equal(fileData.subarray(0, 9).toString("utf8"), "save-data");
  });

  it("discovers Wii saves from Dolphin's configured NAND root", async () => {
    const root = await makeTemporaryDirectory();
    const executablePath = path.join(root, "Dolphin.exe");
    const portableUserDirectory =
      process.platform === "linux" ? "user" : "User";
    const userDirectory = path.join(root, portableUserDirectory);
    const customNandRoot = path.join(root, "custom-nand");
    const dataPath = path.join(
      customNandRoot,
      "title",
      "00010000",
      "524d4745",
      "data"
    );
    await fs.writeFile(path.join(root, "portable.txt"), "");
    await fs.mkdir(path.join(userDirectory, "Config"), { recursive: true });
    await fs.writeFile(
      path.join(userDirectory, "Config", "Dolphin.ini"),
      `[General]\nNANDRootPath = ${customNandRoot}\n`
    );
    await fs.mkdir(dataPath, { recursive: true });
    await fs.writeFile(path.join(dataPath, "banner.bin"), Buffer.alloc(0x72a0));

    const saves = await discoverDolphinWiiSaves(executablePath);

    assert.equal(saves.length, 1);
    assert.equal(saves[0]?.sku, "RMGE");
    assert.equal(saves[0]?.sourcePath, dataPath);
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
