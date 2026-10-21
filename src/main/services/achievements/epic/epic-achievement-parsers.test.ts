import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  parseAlanWake2Achievements,
  parseNemirtingasAchievements,
  readStableFile,
} from "./epic-achievement-parsers.ts";

const fixture = (name: string) =>
  fs.readFileSync(path.join(import.meta.dirname, "fixtures", name));

const NOW_MS = Date.UTC(2026, 9, 20);
const json = (value: unknown) => Buffer.from(JSON.stringify(value));

const ALAN_WAKE_2_CATALOG_IDS = Array.from({ length: 88 }, (_, index) => {
  const position = index + 1;
  if (position <= 38) return position;
  if (position <= 40) return position + 1;
  if (position <= 66) return position + 3;
  if (position <= 78) return position + 34;
  return position + 122;
});

const buildChunk = (
  steps: Record<number, number> = {},
  {
    count = 88,
    version = 1,
    catalogIds = ALAN_WAKE_2_CATALOG_IDS,
  }: { count?: number; version?: number; catalogIds?: number[] } = {}
) => {
  const buffer = Buffer.alloc(8 + count * 16);
  buffer.writeUInt32LE(version, 0);
  buffer.writeUInt32LE(count, 4);

  for (let index = 0; index < count; index++) {
    const offset = 8 + index * 16;
    buffer.writeUInt32LE(2, offset);
    buffer.writeUInt32LE(catalogIds[index] ?? 1000 + index, offset + 4);
    buffer.writeUInt32LE(steps[index + 1] ?? 0, offset + 8);
  }

  return buffer;
};

describe("parseNemirtingasAchievements", () => {
  it("reads the emulator file attached to LBX-1070", () => {
    assert.deepEqual(
      parseNemirtingasAchievements(fixture("nemirtingas-achievements.json")),
      [
        { externalId: "38", unlockTime: 1789103553000 },
        { externalId: "32", unlockTime: 1789103566000 },
      ]
    );
  });

  it("skips achievements that are not unlocked yet", () => {
    assert.deepEqual(
      parseNemirtingasAchievements(
        json([
          { AchievementId: "ACH_1", UnlockTime: 0 },
          { AchievementId: "ACH_2", UnlockTime: 10 },
        ]),
        NOW_MS
      ),
      [{ externalId: "ACH_2", unlockTime: 10_000 }]
    );
  });

  it("accepts an empty list", () => {
    assert.deepEqual(parseNemirtingasAchievements(json([]), NOW_MS), []);
  });

  for (const [scenario, bytes] of [
    ["truncated JSON", Buffer.from('[{"AchievementId":"1","Unlock')],
    ["invalid UTF-8", Buffer.from([0x5b, 0xff, 0x5d])],
    ["a non-array root", json({ AchievementId: "1", UnlockTime: 1 })],
    ["a non-object row", json([1])],
    ["an array row", json([["1", 1]])],
    ["a numeric id", json([{ AchievementId: 1, UnlockTime: 1 }])],
    ["a blank id", json([{ AchievementId: " ", UnlockTime: 1 }])],
    ["a control character", json([{ AchievementId: "a\nb", UnlockTime: 1 }])],
    [
      "an oversized id",
      json([{ AchievementId: "a".repeat(513), UnlockTime: 1 }]),
    ],
    [
      "a duplicated id",
      json([
        { AchievementId: "1", UnlockTime: 1 },
        { AchievementId: "1", UnlockTime: 2 },
      ]),
    ],
    ["a missing time", json([{ AchievementId: "1" }])],
    ["a fractional time", json([{ AchievementId: "1", UnlockTime: 1.5 }])],
    ["a negative time", json([{ AchievementId: "1", UnlockTime: -1 }])],
    [
      "a time in the future",
      json([{ AchievementId: "1", UnlockTime: NOW_MS / 1000 + 60 }]),
    ],
  ] as const) {
    it(`rejects the whole file for ${scenario}`, () => {
      assert.equal(parseNemirtingasAchievements(bytes, NOW_MS), null);
    });
  }

  it("rejects files with too many rows", () => {
    const rows = Array.from({ length: 10_001 }, (_, index) => ({
      AchievementId: String(index),
      UnlockTime: 0,
    }));

    assert.equal(parseNemirtingasAchievements(json(rows), NOW_MS), null);
  });
});

describe("parseAlanWake2Achievements", () => {
  it("reads the save attached to LBX-1070, leaving the partial charm out", () => {
    assert.deepEqual(
      parseAlanWake2Achievements(fixture("alan-wake-2-data.chunk"), NOW_MS),
      [
        { externalId: "3", unlockTime: NOW_MS },
        { externalId: "32", unlockTime: NOW_MS },
      ]
    );
  });

  it("uses the verified step thresholds", () => {
    assert.deepEqual(
      parseAlanWake2Achievements(
        buildChunk({ 63: 13, 87: 37, 10: 6 }),
        NOW_MS
      )?.map(({ externalId }) => externalId),
      ["10", "87"]
    );
  });

  it("reads saves without the DLC records", () => {
    assert.deepEqual(
      parseAlanWake2Achievements(
        buildChunk({ 1: 1, 66: 1 }, { count: 66 }),
        NOW_MS
      )?.map(({ externalId }) => externalId),
      ["1", "66"]
    );
  });

  it("ignores records past the verified catalogue", () => {
    assert.deepEqual(
      parseAlanWake2Achievements(
        buildChunk({ 88: 1, 89: 99 }, { count: 89 }),
        NOW_MS
      )?.map(({ externalId }) => externalId),
      ["88"]
    );
  });

  it("returns no unlocks for a fresh save", () => {
    assert.deepEqual(parseAlanWake2Achievements(buildChunk(), NOW_MS), []);
  });

  it("rejects files shorter than the header", () => {
    assert.equal(parseAlanWake2Achievements(Buffer.alloc(4), NOW_MS), null);
  });

  it("rejects unknown versions", () => {
    assert.equal(
      parseAlanWake2Achievements(buildChunk({}, { version: 2 }), NOW_MS),
      null
    );
  });

  it("rejects partially written files", () => {
    assert.equal(
      parseAlanWake2Achievements(buildChunk({ 1: 1 }).subarray(0, 100), NOW_MS),
      null
    );
  });

  it("rejects unexpected record types", () => {
    const chunk = buildChunk({ 1: 1 });
    chunk.writeUInt32LE(3, 8 + 16);

    assert.equal(parseAlanWake2Achievements(chunk, NOW_MS), null);
  });

  it("rejects catalogue ids that do not match their position", () => {
    const catalogIds = [...ALAN_WAKE_2_CATALOG_IDS];
    catalogIds[38] = 39;

    assert.equal(
      parseAlanWake2Achievements(buildChunk({ 1: 1 }, { catalogIds }), NOW_MS),
      null
    );
  });
});

describe("readStableFile", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-epic-read-"));

  after(() => fs.rmSync(directory, { recursive: true, force: true }));

  it("reads a whole file", () => {
    const filePath = path.join(directory, "file.json");
    fs.writeFileSync(filePath, "[]");

    assert.equal(readStableFile(filePath)?.toString(), "[]");
  });

  it("returns null for missing files, folders and oversized files", () => {
    const filePath = path.join(directory, "large.bin");
    fs.writeFileSync(filePath, Buffer.alloc(16));

    assert.equal(readStableFile(path.join(directory, "missing")), null);
    assert.equal(readStableFile(directory), null);
    assert.equal(readStableFile(filePath, 8), null);
  });
});
