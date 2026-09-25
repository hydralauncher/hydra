import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertRealDebridFileLink,
  isZipDownloadUrl,
  selectDebridFiles,
  stableDebridFileIndex,
  toTorrentFilesResponse,
} from "./debrid-files.ts";

describe("debrid file selection", () => {
  it("keeps a file identity when the provider changes file order", () => {
    const first = {
      index: stableDebridFileIndex("Game/a.bin", 10),
      path: "Game/a.bin",
      size: 10,
    };
    const second = {
      index: stableDebridFileIndex("Game/b.bin", 20),
      path: "Game/b.bin",
      size: 20,
    };

    assert.equal(selectDebridFiles([second, first], [first.index])[0], first);
    assert.deepEqual(toTorrentFilesResponse("Game", [first, second]).files, [
      { index: first.index, path: first.path, length: first.size },
      { index: second.index, path: second.path, length: second.size },
    ]);
  });

  it("rejects missing, empty, or duplicate selections", () => {
    const file = {
      index: stableDebridFileIndex("Game/a.bin", 10),
      path: "Game/a.bin",
      size: 10,
    };

    assert.throws(() => selectDebridFiles([file], []));
    assert.throws(() => selectDebridFiles([file], [42]));
    assert.throws(() => selectDebridFiles([file, file], [file.index]));
  });
});

describe("Real-Debrid file links", () => {
  it("rejects a link that does not match the selected file", () => {
    assert.doesNotThrow(() =>
      assertRealDebridFileLink("/Game/Data.bin", 20, "Data.bin", 20)
    );
    assert.throws(() =>
      assertRealDebridFileLink("/Game/Data.bin", 20, "Other.bin", 20)
    );
    assert.throws(() =>
      assertRealDebridFileLink("/Game/Data.bin", 20, "Data.bin", 10)
    );
  });
});

describe("debrid download connection policy", () => {
  it("recognizes ZIP paths, including encoded filenames", () => {
    assert.equal(
      isZipDownloadUrl("https://cdn.example/Game%20Files.ZIP?token=abc"),
      true
    );
    assert.equal(
      isZipDownloadUrl("https://cdn.example/Game/file.bin?token=abc"),
      false
    );
    assert.equal(
      isZipDownloadUrl("https://cdn.example/download?id=abc", "Game.zip"),
      true
    );
  });
});
