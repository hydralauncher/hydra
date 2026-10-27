import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Download, LibraryGame } from "@types";
import {
  getFinishedDownload,
  getFinishedDownloadStep,
} from "./finished-download-step.js";
import { Downloader } from "./constants.js";

const makeGame = (
  download: Partial<Download> | null,
  overrides: Partial<LibraryGame> = {}
): LibraryGame =>
  ({
    id: "steam:1",
    shop: "steam",
    objectId: "1",
    title: "Game",
    executablePath: null,
    download: download
      ? ({
          shop: "steam",
          objectId: "1",
          progress: 1,
          downloader: Downloader.Torrent,
          extracting: false,
          folderName: "Game",
          downloadPath: "/downloads",
          ...download,
        } as Download)
      : null,
    ...overrides,
  }) as LibraryGame;

describe("getFinishedDownload", () => {
  it("ignores missing, unfinished and Epic downloads", () => {
    assert.equal(getFinishedDownload(null), null);
    assert.equal(getFinishedDownload(makeGame(null)), null);
    assert.equal(getFinishedDownload(makeGame({ progress: 0.5 })), null);
    assert.equal(
      getFinishedDownload(makeGame({ downloader: Downloader.Epic })),
      null
    );
  });

  it("returns a finished download", () => {
    assert.equal(getFinishedDownload(makeGame({}))?.folderName, "Game");
  });
});

describe("getFinishedDownloadStep", () => {
  it("returns null when the download is not finished", () => {
    assert.equal(
      getFinishedDownloadStep(makeGame({ progress: 0.2 }), true),
      null
    );
  });

  it("plays Classics games through their discs and never asks for an executable", () => {
    const withDiscs = makeGame({ folderName: "Rom.zip" }, {
      shop: "launchbox",
      discs: [{ path: "/roms/Rom.zip" }],
    } as Partial<LibraryGame>);
    const withoutDiscs = makeGame({ folderName: "Rom.zip" }, {
      shop: "launchbox",
      discs: [],
    } as Partial<LibraryGame>);

    assert.equal(getFinishedDownloadStep(withDiscs, true), "play");
    assert.equal(getFinishedDownloadStep(withoutDiscs, false), null);
  });

  it("waits for extraction before anything else", () => {
    const game = makeGame(
      { extracting: true },
      { executablePath: "C:\\Games\\Game\\game.exe" }
    );
    assert.equal(getFinishedDownloadStep(game, true), "extracting");
  });

  it("offers play once an executable is set", () => {
    const game = makeGame({}, { executablePath: "C:\\Games\\Game\\game.exe" });
    assert.equal(getFinishedDownloadStep(game, true), "play");
  });

  it("offers install while the installer has not run", () => {
    assert.equal(getFinishedDownloadStep(makeGame({}), true), "install");
  });

  it("asks for the executable after the installer ran", () => {
    const game = makeGame({ installerLaunched: true });
    assert.equal(getFinishedDownloadStep(game, true), "select-executable");
  });

  it("asks to extract a download that is still an archive", () => {
    const game = makeGame({ folderName: "Game.ZIP" });
    assert.equal(getFinishedDownloadStep(game, false), "extract");
  });

  it("prefers play over extract once an executable is set", () => {
    const game = makeGame(
      { folderName: "Game.rar" },
      { executablePath: "C:\\Games\\Game\\game.exe" }
    );
    assert.equal(getFinishedDownloadStep(game, false), "play");
  });

  it("shows installing while the installer is running", () => {
    const game = makeGame({ installerLaunched: true, installerRunning: true });
    assert.equal(getFinishedDownloadStep(game, true), "installing");
  });

  it("asks for the executable when there is no installer", () => {
    assert.equal(
      getFinishedDownloadStep(makeGame({}), false),
      "select-executable"
    );
  });
});
