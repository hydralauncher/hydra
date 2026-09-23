import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TorBoxTorrentInfo } from "@types";
import {
  buildTorBoxDownloadManifest,
  selectTorBoxFiles,
} from "./torbox-files.ts";

const torrent = (
  files: Array<{
    id: number;
    name: string;
    size?: number;
    zipped?: boolean;
  }>
): TorBoxTorrentInfo =>
  ({
    id: 42,
    name: "Game",
    files: files.map((file) => ({
      id: file.id,
      name: file.name,
      short_name: file.name.split("/").at(-1),
      size: file.size ?? 10,
      zipped: file.zipped,
    })),
  }) as TorBoxTorrentInfo;

describe("TorBox file manifest", () => {
  it("keeps the torrent folder and nested file paths", () => {
    const manifest = buildTorBoxDownloadManifest(
      torrent([
        { id: 7, name: "Game/Data/one.bin", size: 20 },
        { id: 9, name: "Data/two.bin", size: 30 },
      ])
    );

    assert.equal(manifest.torrentId, 42);
    assert.equal(manifest.totalSize, 50);
    assert.deepEqual(manifest.files, [
      { id: 7, path: "Game/Data/one.bin", size: 20 },
      { id: 9, path: "Game/Data/two.bin", size: 30 },
    ]);
    assert.deepEqual(selectTorBoxFiles(manifest, [9]), [manifest.files[1]]);
  });

  it("handles a single file named after the torrent", () => {
    const manifest = buildTorBoxDownloadManifest(
      torrent([{ id: 1, name: "Game" }])
    );
    assert.equal(manifest.files[0].path, "Game/Game");
  });

  it("rejects missing selections and unsafe or colliding paths", () => {
    const manifest = buildTorBoxDownloadManifest(
      torrent([{ id: 1, name: "Game/one.bin" }])
    );
    assert.throws(() => selectTorBoxFiles(manifest, [2]));
    assert.throws(() => selectTorBoxFiles(manifest, []));
    assert.throws(() =>
      buildTorBoxDownloadManifest(torrent([{ id: 1, name: "../escape" }]))
    );
    assert.throws(() =>
      buildTorBoxDownloadManifest(
        torrent([
          { id: 1, name: "Game/Foo" },
          { id: 2, name: "Game/foo/bar" },
        ])
      )
    );
  });

  it("rejects torrents whose original files were zipped", () => {
    assert.throws(() =>
      buildTorBoxDownloadManifest(
        torrent([{ id: 1, name: "Game.zip", zipped: true }])
      )
    );
  });
});
