import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

import type { Game } from "@types";

import {
  listRpcs3TropUsrFiles,
  npCommIdsFromAchievementIcons,
  parseRpcs3TropUsr,
  readRpcs3UnlockedTrophies,
  resolveRpcs3NpCommIds,
} from "./rpcs3-trophies.js";

const RTC_EPOCH_OFFSET_MS = 62_135_596_800_000n;

const toRtcTick = (unixMs: number) =>
  (BigInt(unixMs) + RTC_EPOCH_OFFSET_MS) * 1000n;

const buildTropUsr = (
  trophyCount: number,
  unlocked: Record<number, number>
): Buffer => {
  const typeFourSize = 0x50;
  const typeSixSize = 0x60;
  const typeFourOffset = 0x30 + 2 * 0x20;
  const typeSixOffset = typeFourOffset + trophyCount * (0x10 + typeFourSize);
  const data = Buffer.alloc(typeSixOffset + trophyCount * (0x10 + typeSixSize));

  data.writeUInt32BE(0x818f54ad, 0);
  data.writeUInt32BE(0x00010000, 4);
  data.writeUInt32BE(2, 8);

  const tables = [
    [4, typeFourSize, typeFourOffset],
    [6, typeSixSize, typeSixOffset],
  ] as const;
  tables.forEach(([type, size, offset], index) => {
    const header = 0x30 + index * 0x20;
    data.writeUInt32BE(type, header);
    data.writeUInt32BE(size, header + 4);
    data.writeUInt32BE(1, header + 8);
    data.writeUInt32BE(trophyCount, header + 12);
    data.writeBigUInt64BE(BigInt(offset), header + 16);
  });

  for (let id = 0; id < trophyCount; id++) {
    const entry = typeSixOffset + id * (0x10 + typeSixSize);
    data.writeUInt32BE(6, entry);
    data.writeUInt32BE(typeSixSize, entry + 4);
    data.writeUInt32BE(id, entry + 8);
    data.writeUInt32BE(id, entry + 16);

    const unlockTime = unlocked[id];
    if (unlockTime === undefined) continue;
    data.writeUInt32BE(1, entry + 20);
    data.writeBigUInt64BE(toRtcTick(unlockTime), entry + 32);
    data.writeBigUInt64BE(toRtcTick(unlockTime), entry + 40);
  }

  return data;
};

it("reads unlocked trophies and their RTC timestamps from TROPUSR.DAT", () => {
  const unlockTime = Date.UTC(2026, 9, 7, 14, 15, 29, 138);
  const data = buildTropUsr(48, { 9: unlockTime, 16: unlockTime - 1000 });

  assert.deepEqual(parseRpcs3TropUsr(data, 0), [
    { name: "9", unlockTime },
    { name: "16", unlockTime: unlockTime - 1000 },
  ]);
});

it("rejects truncated or foreign TROPUSR.DAT contents", () => {
  const data = buildTropUsr(4, { 1: Date.now() });

  assert.equal(parseRpcs3TropUsr(data.subarray(0, data.length - 1), 0), null);
  assert.equal(parseRpcs3TropUsr(Buffer.alloc(64), 0), null);
});

it("merges unlocks from every RPCS3 user and keeps the earliest time", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-trophy-"));
  try {
    const hdd0 = path.join(root, "dev_hdd0");
    const homeRoot = path.join(hdd0, "home");
    const discPath = path.join(root, "disc");
    await fs.mkdir(path.join(discPath, "PS3_GAME", "TROPDIR", "NPWR00160_00"), {
      recursive: true,
    });
    await fs.mkdir(
      path.join(hdd0, "game", "BCUS98148", "TROPDIR", "NPWR00161_00"),
      {
        recursive: true,
      }
    );

    const writeUser = async (
      userId: string,
      unlocked: Record<number, number>
    ) => {
      const directory = path.join(homeRoot, userId, "trophy", "NPWR00160_00");
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(
        path.join(directory, "TROPUSR.DAT"),
        buildTropUsr(48, unlocked)
      );
    };
    await writeUser("00000001", { 1: 2_000, 25: 5_000 });
    await writeUser("00000002", { 1: 1_000, 9: 3_000 });
    await fs.mkdir(path.join(homeRoot, "00000003"), { recursive: true });

    const game = {
      discs: [{ path: discPath, sku: "BCUS-98148" }],
    } as unknown as Game;
    const npCommIds = await resolveRpcs3NpCommIds(game, [discPath], [homeRoot]);
    assert.deepEqual(npCommIds.toSorted(), ["NPWR00160_00", "NPWR00161_00"]);

    const files = await listRpcs3TropUsrFiles([homeRoot], npCommIds);
    assert.equal(files.length, 2);

    const unlocked = await readRpcs3UnlockedTrophies(files);
    assert.deepEqual(
      unlocked?.toSorted((a, b) => Number(a.name) - Number(b.name)),
      [
        { name: "1", unlockTime: 1_000 },
        { name: "9", unlockTime: 3_000 },
        { name: "25", unlockTime: 5_000 },
      ]
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("reads trophy set ids from catalogue icon urls", () => {
  assert.deepEqual(
    npCommIdsFromAchievementIcons([
      {
        icon: "https://cdn.example/psn/trophies/NPWR00160_00/0.webp",
        icongray: "https://cdn.example/psn/trophies/NPWR00160_00/0_lock.webp",
      },
      { icon: "https://cdn.example/steam/icon.jpg", icongray: "" },
    ]),
    ["NPWR00160_00"]
  );
});

it("reads a TROPUSR.DAT written by RPCS3", async () => {
  const data = await fs.readFile(
    fileURLToPath(new URL("./fixtures/rpcs3-tropusr.dat", import.meta.url))
  );

  assert.deepEqual(parseRpcs3TropUsr(data, 0), [
    { name: "25", unlockTime: Date.UTC(2020, 0, 1, 0, 0, 0, 0) },
    { name: "29", unlockTime: Date.UTC(2020, 0, 1, 0, 5, 0, 500) },
  ]);
});
