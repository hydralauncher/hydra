import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  scanObjectIdFolder,
  scanSaveFolder,
} from "./scan-nested-achievement-files.js";

let saveFolder: string;

const makeFile = (...segments: string[]) => {
  const filePath = path.join(saveFolder, ...segments);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "[]");
  return filePath;
};

const relative = (filePaths: string[]) =>
  filePaths
    .map((filePath) =>
      path.relative(saveFolder, filePath).replaceAll("\\", "/")
    )
    .sort();

describe("scanSaveFolder", () => {
  before(() => {
    saveFolder = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-gse-saves-"));
  });

  after(() => {
    fs.rmSync(saveFolder, { recursive: true, force: true });
  });

  it("finds files at the canonical location and one level below it", async () => {
    makeFile("480", "achievements.json");
    makeFile("480", "6100", "achievements.json");
    makeFile("480", "remote", "win64_save", "save.dat");

    const filePathsByObjectId = await scanSaveFolder(saveFolder);

    assert.deepEqual(relative(filePathsByObjectId.get("480")!), [
      "480/6100/achievements.json",
      "480/achievements.json",
    ]);
  });

  it("keeps app ids isolated from each other", async () => {
    makeFile("1234", "achievements.json");
    makeFile("5678", "nested", "achievements.json");

    const filePathsByObjectId = await scanSaveFolder(saveFolder);

    assert.deepEqual(relative(filePathsByObjectId.get("1234")!), [
      "1234/achievements.json",
    ]);
    assert.deepEqual(relative(filePathsByObjectId.get("5678")!), [
      "5678/nested/achievements.json",
    ]);
  });

  it("omits app ids with no achievements file", async () => {
    makeFile("9999", "remote", "save.dat");

    const filePathsByObjectId = await scanSaveFolder(saveFolder);

    assert.equal(filePathsByObjectId.has("9999"), false);
  });

  it("returns an empty map for a folder that does not exist", async () => {
    const filePathsByObjectId = await scanSaveFolder(
      path.join(saveFolder, "does-not-exist")
    );

    assert.equal(filePathsByObjectId.size, 0);
  });

  it("matches the file name case insensitively", async () => {
    makeFile("111", "Achievements.JSON");

    const filePathsByObjectId = await scanSaveFolder(saveFolder);

    assert.equal(filePathsByObjectId.has("111"), true);
  });
});

describe("scanObjectIdFolder", () => {
  let objectIdFolder: string;

  before(() => {
    objectIdFolder = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-appid-"));
  });

  after(() => {
    fs.rmSync(objectIdFolder, { recursive: true, force: true });
  });

  it("does not descend past one level", async () => {
    const withinLimit = path.join(objectIdFolder, "a", "achievements.json");
    const pastLimit = path.join(objectIdFolder, "a", "b", "achievements.json");

    for (const filePath of [withinLimit, pastLimit]) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "[]");
    }

    assert.deepEqual(await scanObjectIdFolder(objectIdFolder), [withinLimit]);
  });

  it("reads a wide save folder without walking into it", async () => {
    const wideFolder = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-wide-"));

    try {
      for (let index = 0; index < 200; index++) {
        fs.mkdirSync(path.join(wideFolder, "remote", `slot${index}`), {
          recursive: true,
        });
      }

      const filePath = path.join(wideFolder, "emu", "achievements.json");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "[]");

      assert.deepEqual(await scanObjectIdFolder(wideFolder), [filePath]);
    } finally {
      fs.rmSync(wideFolder, { recursive: true, force: true });
    }
  });
});
