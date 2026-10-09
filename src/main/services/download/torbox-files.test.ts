import assert from "node:assert/strict";
import { it } from "node:test";
import {
  buildTorBoxDownloadManifest as build,
  selectTorBoxFiles,
} from "./torbox-files.ts";
import type { TorBoxTorrentInfo } from "../../../types/index.ts";
const torrent = (
  files: { id: number; name: string; size: number; zipped?: boolean }[],
  name = "Game"
) => ({ id: 42, name, files }) as TorBoxTorrentInfo;
it("keeps folder paths, provider file IDs, and zero-byte files", () => {
  const manifest = build(
    torrent([
      { id: 7, name: "Game/Disc 1/data.bin", size: 100 },
      { id: 0, name: "Game/readme.txt", size: 0 },
    ])
  );
  assert.equal(manifest.totalSize, 100);
  assert.deepEqual(manifest.files, [
    { id: 7, path: "Game/Disc 1/data.bin", size: 100 },
    { id: 0, path: "Game/readme.txt", size: 0 },
  ]);
  assert.deepEqual(selectTorBoxFiles(manifest, [0]), [manifest.files[1]]);
  assert.deepEqual(selectTorBoxFiles(manifest), manifest.files);
});
it("uses direct file IDs for ZIP-only cached files", () => {
  const manifest = build(
    torrent([{ id: 0, name: "Game/Game.zip", size: 123, zipped: true }])
  );
  assert.equal(manifest.archiveOnly, true);
  assert.deepEqual(manifest.files, [
    { id: 0, path: "Game/Game.zip", size: 123 },
  ]);
});
it("normalizes separators, HTML entities, Unicode, and Windows names", () => {
  const manifest = build(
    torrent([
      { id: 0, name: "Game\\Aux.txt", size: 1 },
      { id: 1, name: "Game/a&amp;b.txt", size: 1 },
      { id: 2, name: "Game/cafe\u0301.txt", size: 1 },
    ])
  );
  assert.deepEqual(
    manifest.files.map((f) => f.path),
    ["Game/_Aux.txt", "Game/a&b.txt", "Game/café.txt"]
  );
});
it("uses the magnet name for an opaque provider root", () => {
  const hash = "a".repeat(40);
  assert.equal(
    build(torrent([{ id: 0, name: hash + "/data.bin", size: 1 }], hash), "Game")
      .files[0].path,
    "Game/data.bin"
  );
});
for (const name of [
  "../file",
  "/file",
  "C:/file",
  "Game/../file",
  "Game//",
  "Game/./file",
]) {
  it(`rejects unsafe path ${name}`, () =>
    assert.throws(() => build(torrent([{ id: 0, name, size: 1 }]))));
}
for (const files of [
  [
    { id: 0, name: "a", size: 1 },
    { id: 0, name: "b", size: 1 },
  ],
  [{ id: -1, name: "a", size: 1 }],
  [{ id: 0, name: "a", size: -1 }],
  [{ id: 0, name: "a", size: 1.5 }],
  [
    { id: 0, name: "A.txt", size: 1 },
    { id: 1, name: "a.txt", size: 1 },
  ],
  [
    { id: 0, name: "a?.txt", size: 1 },
    { id: 1, name: "a*.txt", size: 1 },
  ],
  [
    { id: 0, name: "a", size: 1 },
    { id: 1, name: "a/b", size: 1 },
  ],
  [
    { id: 0, name: "a/b", size: 1 },
    { id: 1, name: "a", size: 1 },
  ],
  [
    { id: 0, name: "a", size: Number.MAX_SAFE_INTEGER },
    { id: 1, name: "b", size: 1 },
  ],
])
  it(`rejects invalid or colliding files ${JSON.stringify(files)}`, () =>
    assert.throws(() => build(torrent(files))));
it("rejects empty or stale selections before requesting download links", () => {
  const manifest = build(torrent([{ id: 7, name: "a", size: 1 }]));
  assert.throws(() => selectTorBoxFiles(manifest, []));
  assert.throws(() => selectTorBoxFiles(manifest, [7, 9]));
  assert.equal(selectTorBoxFiles(manifest, [7, 7]).length, 1);
});
