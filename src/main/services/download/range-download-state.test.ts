import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import {
  configureRangeStateDirectory,
  markSavedRange,
  missingRanges,
  savedRangeBytes,
  readRangeState,
  saveRangeState,
  rangeStatePath,
  rangeResourceId,
  getRangeDownloadedBytes,
  removeRangeState,
  type RangeDownloadState,
} from "./range-download-state.ts";
import {
  getStrongRangeValidator,
  getRangeTotal,
} from "./parallel-range-download.ts";

const metadataDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "hydra-range-metadata-")
);
configureRangeStateDirectory(metadataDirectory);
after(() => fs.rmSync(metadataDirectory, { recursive: true, force: true }));

const state = (): RangeDownloadState => ({
  version: 1,
  total: 100,
  validator: '"v1"',
  resourceId: rangeResourceId("file-1"),
  ranges: [],
});

it("merges saved bytes in any order without double counting", () => {
  const map = state();
  for (const [a, b] of [
    [80, 100],
    [20, 40],
    [30, 60],
    [0, 10],
    [10, 20],
    [60, 80],
  ])
    markSavedRange(map, a, b);
  assert.deepEqual(map.ranges, [[0, 100]]);
  assert.equal(savedRangeBytes(map), 100);
  assert.deepEqual(missingRanges(map), []);
});
it("returns every hole instead of treating sparse file length as downloaded bytes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-range-test-"));
  try {
    const file = path.join(root, "file.bin");
    fs.writeFileSync(file, Buffer.alloc(100));
    const map = state();
    map.ranges = [
      [20, 30],
      [80, 100],
    ];
    await saveRangeState(file, map);
    assert.deepEqual(readRangeState(file), map);
    assert.equal(getRangeDownloadedBytes(file), 30);
    assert.deepEqual(missingRanges(map), [
      [0, 20],
      [30, 80],
    ]);
    assert.deepEqual(fs.readdirSync(root), ["file.bin"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
for (const [name, mutate] of Object.entries({
  "unsupported version": (s: Record<string, unknown>) => (s.version = 2),
  "negative size": (s: Record<string, unknown>) => (s.total = -1),
  "unsafe size": (s: Record<string, unknown>) =>
    (s.total = Number.MAX_SAFE_INTEGER + 1),
  "missing validator": (s: Record<string, unknown>) => (s.validator = ""),
  "invalid identity": (s: Record<string, unknown>) =>
    (s.resourceId = "private-url"),
  overlap: (s: Record<string, unknown>) =>
    (s.ranges = [
      [0, 20],
      [10, 30],
    ]),
  "adjacent unmerged ranges": (s: Record<string, unknown>) =>
    (s.ranges = [
      [0, 20],
      [20, 30],
    ]),
  "reversed range": (s: Record<string, unknown>) => (s.ranges = [[20, 10]]),
  "fractional range": (s: Record<string, unknown>) => (s.ranges = [[0, 0.5]]),
  "out-of-bounds range": (s: Record<string, unknown>) =>
    (s.ranges = [[0, 101]]),
})) {
  it(`rejects ${name} metadata and preserves file bytes`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-range-test-"));
    try {
      const file = path.join(root, "file.bin");
      const bytes = Buffer.alloc(100, 42);
      fs.writeFileSync(file, bytes);
      const map = state();
      mutate(map as unknown as Record<string, unknown>);
      fs.writeFileSync(rangeStatePath(file), JSON.stringify(map));
      assert.throws(() => readRangeState(file), /Keeping the partial file/);
      assert.deepEqual(fs.readFileSync(file), bytes);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
it("rejects a truncated file and a symlink range map", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-range-test-"));
  try {
    const file = path.join(root, "file.bin");
    fs.writeFileSync(file, Buffer.alloc(20));
    const map = state();
    map.ranges = [[0, 30]];
    await saveRangeState(file, map);
    assert.throws(() => readRangeState(file), /invalid/);
    fs.renameSync(rangeStatePath(file), path.join(root, "map"));
    fs.symlinkSync(path.join(root, "map"), rangeStatePath(file));
    assert.throws(() => readRangeState(file), /invalid/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
const response = (headers: Record<string, string>, status = 206) =>
  new Response(null, { status, headers });
it("accepts strong ETags and old Last-Modified dates without ETags", () => {
  assert.equal(getStrongRangeValidator(response({ etag: '"v1"' })), '"v1"');
  const modified = "Tue, 17 Feb 2026 19:55:52 GMT";
  assert.equal(
    getStrongRangeValidator(
      response({
        "last-modified": modified,
        date: "Tue, 17 Feb 2026 19:56:52 GMT",
      })
    ),
    modified
  );
});
const unsafeValidators: Record<string, string>[] = [
  {
    etag: 'W/"v1"',
    "last-modified": "Tue, 17 Feb 2026 19:55:52 GMT",
    date: "Tue, 17 Feb 2026 19:56:52 GMT",
  },
  { etag: "broken" },
  { "last-modified": "invalid", date: "Tue, 17 Feb 2026 19:56:52 GMT" },
  { "last-modified": "Tue, 17 Feb 2026 19:55:52 GMT" },
  {
    "last-modified": "Tue, 17 Feb 2026 19:55:52 GMT",
    date: "Tue, 17 Feb 2026 19:56:51 GMT",
  },
];
for (const headers of unsafeValidators)
  it(`rejects unsafe range validators ${JSON.stringify(headers)}`, () =>
    assert.equal(getStrongRangeValidator(response(headers)), null));
it("validates the exact requested range, total, body length, and encoding", () => {
  const valid = { "content-range": "bytes 10-19/100", "content-length": "10" };
  assert.equal(getRangeTotal(response(valid), 10, 19), 100);
  assert.equal(getRangeTotal(response(valid), 0, 19), null);
  assert.equal(getRangeTotal(response(valid, 200), 10, 19), null);
  assert.equal(
    getRangeTotal(response({ ...valid, "content-length": "9" }), 10, 19),
    null
  );
  assert.equal(
    getRangeTotal(response({ ...valid, "content-encoding": "gzip" }), 10, 19),
    null
  );
  assert.equal(
    getRangeTotal(
      response({ "content-range": "bytes 90-99/100", "content-length": "10" }),
      90,
      200
    ),
    100
  );
});

it("range metadata never replaces or deletes a similarly named downloaded file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-range-collision-"));
  const file = path.join(root, "data.bin");
  const sibling = `${file}.hydra-part.json`;
  const siblingBytes = Buffer.alloc(100, 19);
  try {
    fs.writeFileSync(file, Buffer.alloc(100, 42));
    fs.writeFileSync(sibling, siblingBytes);
    const map = state();
    map.ranges = [[20, 30]];
    await saveRangeState(file, map);
    assert.deepEqual(fs.readFileSync(sibling), siblingBytes);
    assert.equal(getRangeDownloadedBytes(file), 10);
    assert.equal(getRangeDownloadedBytes(sibling), siblingBytes.length);
    assert.equal(
      path.relative(root, rangeStatePath(file)).startsWith(".."),
      true
    );
    removeRangeState(file);
    assert.deepEqual(fs.readFileSync(sibling), siblingBytes);
    assert.deepEqual(fs.readdirSync(root).sort(), [
      "data.bin",
      "data.bin.hydra-part.json",
    ]);
  } finally {
    removeRangeState(file);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("missing partial files discard orphaned metadata before a fresh download", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-range-orphan-"));
  const file = path.join(root, "data.bin");
  try {
    fs.writeFileSync(file, Buffer.alloc(100));
    await saveRangeState(file, { ...state(), ranges: [[0, 30]] });
    fs.unlinkSync(file);
    assert.equal(readRangeState(file), null);
    assert.equal(getRangeDownloadedBytes(file), 0);
    assert.equal(fs.existsSync(rangeStatePath(file)), false);
  } finally {
    removeRangeState(file);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("persistent metadata distinguishes the same filename in different folders", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-range-identity-"));
  const files = [
    path.join(root, "one", "data.bin"),
    path.join(root, "two", "data.bin"),
  ];
  try {
    await Promise.all(
      files.map(async (file, index) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.alloc(100));
        await saveRangeState(file, { ...state(), ranges: [[0, 30 + index]] });
      })
    );
    // Reinitializing the directory models another launcher session.
    configureRangeStateDirectory(metadataDirectory);
    assert.notEqual(rangeStatePath(files[0]), rangeStatePath(files[1]));
    assert.equal(getRangeDownloadedBytes(files[0]), 30);
    assert.equal(getRangeDownloadedBytes(files[1]), 31);
  } finally {
    files.forEach(removeRangeState);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
