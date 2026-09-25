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
  }>,
  name = "Game"
): TorBoxTorrentInfo =>
  ({
    id: 42,
    name,
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

  it("uses a shared file folder instead of adding a release-name wrapper", () => {
    const manifest = buildTorBoxDownloadManifest(
      torrent(
        [
          { id: 1, name: "Release Files/setup.exe" },
          { id: 2, name: "Release Files/data.bin" },
        ],
        "Long Release &amp; Extras Title"
      )
    );

    assert.equal(manifest.name, "Release Files");
    assert.deepEqual(
      manifest.files.map((file) => file.path),
      ["Release Files/setup.exe", "Release Files/data.bin"]
    );
  });

  it("decodes HTML entities in a release folder when files are at its root", () => {
    const manifest = buildTorBoxDownloadManifest(
      torrent(
        [
          { id: 1, name: "data.bin" },
          { id: 2, name: "Bonus/setup.exe" },
        ],
        "Release &amp; Extras"
      )
    );

    assert.equal(manifest.name, "Release & Extras");
    assert.equal(manifest.files[0].path, "Release & Extras/data.bin");
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

  it("offers a ZIP archive when the original files were compressed", () => {
    const manifest = buildTorBoxDownloadManifest(
      torrent([{ id: 1, name: "Game.zip", size: 42, zipped: true }])
    );
    assert.equal(manifest.archiveOnly, true);
    assert.equal(manifest.totalSize, 42);
    assert.deepEqual(manifest.files, [
      { id: 1, path: "Game/Game.zip", size: 42, isZip: true },
    ]);
    assert.deepEqual(selectTorBoxFiles(manifest, [1]), manifest.files);
  });

  it("uses the magnet name when the provider names an archive with a hash", () => {
    const hash = "4cf0bd89d230ec5147a8ca18610ef2d1d21c42c6";
    const manifest = buildTorBoxDownloadManifest(
      torrent([{ id: 1, name: `${hash}.zip`, zipped: true }], hash),
      "Readable download name"
    );

    assert.equal(manifest.name, "Readable download name");
    assert.equal(
      manifest.files[0].path,
      "Readable download name/Readable download name.zip"
    );
  });
});
