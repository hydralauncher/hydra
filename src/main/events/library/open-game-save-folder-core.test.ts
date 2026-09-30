import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  getGameSaveFolderShellPath,
  openExistingGameSaveFolder,
} from "./open-game-save-folder-core.ts";

describe("getGameSaveFolderShellPath", () => {
  it("removes Windows extended drive prefixes", () => {
    assert.equal(
      getGameSaveFolderShellPath("\\\\?\\C:\\Users\\Hydra\\Saves", "win32"),
      "C:\\Users\\Hydra\\Saves"
    );
    assert.equal(
      getGameSaveFolderShellPath("//?/D:/Games/Save", "win32"),
      "D:\\Games\\Save"
    );
  });

  it("converts extended UNC paths to paths Explorer can open", () => {
    assert.equal(
      getGameSaveFolderShellPath("\\\\?\\UNC\\server\\share\\Saves", "win32"),
      "\\\\server\\share\\Saves"
    );
  });

  it("leaves ordinary and non-Windows paths unchanged", () => {
    assert.equal(
      getGameSaveFolderShellPath("C:\\Users\\Hydra\\Saves", "win32"),
      "C:\\Users\\Hydra\\Saves"
    );
    assert.equal(
      getGameSaveFolderShellPath("/home/hydra/saves", "linux"),
      "/home/hydra/saves"
    );
  });
});

describe("openExistingGameSaveFolder", () => {
  it("checks the filesystem path and opens its shell-compatible form", async () => {
    const checkedPaths: string[] = [];
    const openedPaths: string[] = [];
    const saveFolderPath = "\\\\?\\C:\\Users\\Hydra\\Saves";

    const opened = await openExistingGameSaveFolder({
      saveFolderPath,
      platform: "win32",
      exists: (folderPath) => {
        checkedPaths.push(folderPath);
        return true;
      },
      openPath: async (folderPath) => {
        openedPaths.push(folderPath);
        return "";
      },
    });

    assert.equal(opened, true);
    assert.deepEqual(checkedPaths, [saveFolderPath]);
    assert.deepEqual(openedPaths, ["C:\\Users\\Hydra\\Saves"]);
  });

  it("returns false when the folder is missing or the shell rejects it", async () => {
    let openCount = 0;
    const openPath = async () => {
      openCount += 1;
      return "Access denied";
    };

    assert.equal(
      await openExistingGameSaveFolder({
        saveFolderPath: "/missing",
        platform: "linux",
        exists: () => false,
        openPath,
      }),
      false
    );
    assert.equal(openCount, 0);

    assert.equal(
      await openExistingGameSaveFolder({
        saveFolderPath: "/existing",
        platform: "linux",
        exists: () => true,
        openPath,
      }),
      false
    );
    assert.equal(openCount, 1);
  });

  it("returns false when filesystem or shell access throws", async () => {
    assert.equal(
      await openExistingGameSaveFolder({
        saveFolderPath: "/saves",
        platform: "darwin",
        exists: () => {
          throw new Error("filesystem unavailable");
        },
        openPath: async () => "",
      }),
      false
    );

    assert.equal(
      await openExistingGameSaveFolder({
        saveFolderPath: "/saves",
        platform: "darwin",
        exists: () => true,
        openPath: async () => {
          throw new Error("shell unavailable");
        },
      }),
      false
    );
  });
});
