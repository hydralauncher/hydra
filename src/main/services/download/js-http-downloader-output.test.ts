import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { chooseDownloadOutputPath } from "./js-http-downloader-helpers.ts";

describe("HTTP download output path", () => {
  it("keeps the selected torrent folder when the server supplies a filename", () => {
    const savePath = path.join("downloads", "Games");
    const selectedPath = path.join(savePath, "Game", "Data", "file.bin");

    assert.deepEqual(
      chooseDownloadOutputPath(selectedPath, savePath, "file.bin", true),
      {
        filePath: selectedPath,
        filename: path.join("Game", "Data", "file.bin"),
      }
    );
  });

  it("uses the server filename when no path was selected", () => {
    const savePath = "downloads";
    const fallbackPath = path.join(savePath, "download");

    assert.deepEqual(
      chooseDownloadOutputPath(fallbackPath, savePath, "archive.zip", false),
      { filePath: path.join(savePath, "archive.zip"), filename: "archive.zip" }
    );
  });
});
