import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

import type { Game } from "@types";

import {
  listRpcs3TropUsrFiles,
  matchRpcs3UnlocksToCatalogue,
  npCommIdsFromCatalogue,
  parseRpcs3TropUsr,
  pickRpcs3TrophySets,
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
      unlocked?.toSorted((a, b) => Number(a.id) - Number(b.id)),
      [
        { npCommId: "NPWR00160_00", id: "1", unlockTime: 1_000 },
        { npCommId: "NPWR00160_00", id: "9", unlockTime: 3_000 },
        { npCommId: "NPWR00160_00", id: "25", unlockTime: 5_000 },
      ]
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("reads trophy set ids from catalogue icon urls", () => {
  assert.deepEqual(
    npCommIdsFromCatalogue([
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

const trophyIcon = (npCommId: string, id: number) => ({
  icon: `https://cdn.example/psn/trophies/${npCommId}/${id}.webp`,
  icongray: `https://cdn.example/psn/trophies/${npCommId}/${id}_lock.webp`,
});

it("keeps trophies with the same id apart across trophy sets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-trophy-"));
  try {
    const homeRoot = path.join(root, "dev_hdd0", "home");
    const writeSet = async (
      npCommId: string,
      unlocked: Record<number, number>
    ) => {
      const directory = path.join(homeRoot, "00000001", "trophy", npCommId);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(
        path.join(directory, "TROPUSR.DAT"),
        buildTropUsr(10, unlocked)
      );
    };
    await writeSet("NPWR01435_00", { 0: 1_000, 5: 2_000 });
    await writeSet("NPWR01433_00", { 5: 3_000 });
    await writeSet("NPWR01341_00", { 1: 4_000 });

    const setIds = ["NPWR01435_00", "NPWR01433_00", "NPWR01341_00"];
    const files = await listRpcs3TropUsrFiles([homeRoot], setIds);
    const unlocks = await readRpcs3UnlockedTrophies(files);
    assert.equal(unlocks?.length, 4);

    const catalogue = [
      { name: "SLY1_0", ...trophyIcon("NPWR01435_00", 0) },
      { name: "SLY1_5", ...trophyIcon("NPWR01435_00", 5) },
      { name: "SLY2_5", ...trophyIcon("NPWR01433_00", 5) },
    ];
    const matched = matchRpcs3UnlocksToCatalogue(
      unlocks ?? [],
      catalogue,
      pickRpcs3TrophySets(npCommIdsFromCatalogue(catalogue), setIds)
    );
    assert.deepEqual(
      matched.toSorted((a, b) => a.unlockTime - b.unlockTime),
      [
        { name: "SLY1_0", unlockTime: 1_000 },
        { name: "SLY1_5", unlockTime: 2_000 },
        { name: "SLY2_5", unlockTime: 3_000 },
      ]
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("ignores unlocks the catalogue does not list", () => {
  const unlocks = [
    { npCommId: "NPWR00160_00", id: "1", unlockTime: 1_000 },
    { npCommId: "NPWR00160_00", id: "70", unlockTime: 2_000 },
  ];
  assert.deepEqual(
    matchRpcs3UnlocksToCatalogue(
      unlocks,
      [{ name: "1", ...trophyIcon("NPWR00160_00", 1) }],
      { NPWR00160_00: "NPWR00160_00" }
    ),
    [{ name: "1", unlockTime: 1_000 }]
  );
  assert.deepEqual(matchRpcs3UnlocksToCatalogue(unlocks, [], {}), []);
});

it("reads the disc's regional trophy set as the catalogue's only set", () => {
  const catalogueSets = pickRpcs3TrophySets(["NPWR00160_00"], ["NPWR00195_00"]);
  assert.deepEqual(catalogueSets, { NPWR00195_00: "NPWR00160_00" });
  assert.deepEqual(
    matchRpcs3UnlocksToCatalogue(
      [{ npCommId: "NPWR00195_00", id: "3", unlockTime: 1_000 }],
      [{ name: "3", ...trophyIcon("NPWR00160_00", 3) }],
      catalogueSets
    ),
    [{ name: "3", unlockTime: 1_000 }]
  );
});

it("picks trophy sets only when they can be told apart", () => {
  const sly = ["NPWR01435_00", "NPWR01433_00", "NPWR01490_00"];
  assert.deepEqual(pickRpcs3TrophySets([], sly), {});
  assert.deepEqual(pickRpcs3TrophySets([], ["NPWR00160_00"]), {
    NPWR00160_00: "NPWR00160_00",
  });
  assert.deepEqual(pickRpcs3TrophySets(["NPWR01435_00"], sly), {
    NPWR01435_00: "NPWR01435_00",
  });
  assert.deepEqual(pickRpcs3TrophySets(["NPWR09999_00"], sly), {});
  assert.deepEqual(pickRpcs3TrophySets(["NPWR00160_00"], []), {
    NPWR00160_00: "NPWR00160_00",
  });
});

it("matches by trophy id when the catalogue has no set ids and one set was read", () => {
  const catalogue = [{ name: "2", icon: "", icongray: "" }];
  assert.deepEqual(
    matchRpcs3UnlocksToCatalogue(
      [{ npCommId: "NPWR00160_00", id: "2", unlockTime: 1_000 }],
      catalogue,
      { NPWR00160_00: "NPWR00160_00" }
    ),
    [{ name: "2", unlockTime: 1_000 }]
  );
});
