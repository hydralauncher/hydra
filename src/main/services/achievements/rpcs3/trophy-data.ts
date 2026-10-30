import { promises as fs } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import type { UserAchievement } from "@types";

export const RPCS3_TROPHY_POINTS_MULTIPLIER = 25;
export const RPCS3_TROPHY_SET_ID = /^NPWR\d{5}_\d{2}$/;
const MAX_TROPHIES = 4096;
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const PS3_UNIX_EPOCH_MICROSECONDS = 62135596800000000n;
const grades = {
  B: { grade: "bronze", points: 15 },
  S: { grade: "silver", points: 30 },
  G: { grade: "gold", points: 90 },
  P: { grade: "platinum", points: 300 },
} as const;

export interface TrophyState {
  unlocked: boolean;
  unlockTime: number | null;
}

export const trophyTimestampToMillis = (tick: bigint): number | null => {
  if (tick < PS3_UNIX_EPOCH_MICROSECONDS) return null;
  const millis = (tick - PS3_UNIX_EPOCH_MICROSECONDS) / 1000n;
  return millis <= 8640000000000000n ? Number(millis) : null;
};

/** Layout follows RPCS3's Loader/TROPUSR.h. Offsets belong to the file, not a fixed two-table layout. */
export const parseTrophyStates = (data: Buffer): Map<number, TrophyState> => {
  if (
    data.length < 48 ||
    data.length > MAX_FILE_SIZE ||
    data.readUInt32BE(0) !== 0x818f54ad
  )
    throw new Error("Invalid TROPUSR header");
  const tableCount = data.readUInt32BE(8);
  if (!tableCount || tableCount > 128 || 48 + tableCount * 32 > data.length)
    throw new Error("Invalid TROPUSR table directory");
  const states = new Map<number, TrophyState>();
  let found = false;
  for (let i = 0; i < tableCount; i++) {
    const header = 48 + i * 32;
    if (data.readUInt32BE(header) !== 6) continue;
    if (found) throw new Error("Duplicate TROPUSR state table");
    found = true;
    const stride = data.readUInt32BE(header + 4) + 16;
    const count = data.readUInt32BE(header + 12);
    const offset = data.readBigUInt64BE(header + 16);
    if (
      stride !== 112 ||
      count > MAX_TROPHIES ||
      offset < BigInt(48 + tableCount * 32) ||
      offset + BigInt(count * stride) > BigInt(data.length)
    )
      throw new Error("Invalid TROPUSR state table bounds");
    for (let j = 0; j < count; j++) {
      const pos = Number(offset) + j * stride;
      const id = data.readUInt32BE(pos + 16);
      const state = data.readUInt32BE(pos + 20);
      if (
        data.readUInt32BE(pos) !== 6 ||
        data.readUInt32BE(pos + 4) !== 96 ||
        id >= MAX_TROPHIES ||
        states.has(id) ||
        state > 1
      )
        throw new Error("Invalid TROPUSR state entry");
      states.set(id, {
        unlocked: state === 1,
        unlockTime: state
          ? trophyTimestampToMillis(data.readBigUInt64BE(pos + 40))
          : null,
      });
    }
  }
  if (!found) throw new Error("Missing TROPUSR state table");
  return states;
};

export const parseTrophyDefinitions = (
  data: Buffer,
  setId: string,
  directory: string,
  states: ReadonlyMap<number, TrophyState>
): UserAchievement[] => {
  if (!RPCS3_TROPHY_SET_ID.test(setId) || data.length > MAX_FILE_SIZE)
    throw new Error("Invalid trophy definitions");
  // Decrypted retail exports can carry a 64-byte SFM header before the XML.
  const xml = (
    data.length >= 64 && data.readUInt32BE(0) === 0x450195ba
      ? data.subarray(64)
      : data
  ).toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Unsupported trophy XML declarations");
  const dom = new JSDOM(xml, { contentType: "application/xml" });
  try {
    const root = dom.window.document.documentElement;
    const text = (node: Element, tag: string) =>
      Array.from(node.children)
        .find((child) => child.tagName === tag)
        ?.textContent?.trim() ?? "";
    if (root.tagName !== "trophyconf" || text(root, "npcommid") !== setId)
      throw new Error("Trophy set identity mismatch");
    const title = text(root, "title-name") || setId;
    const trophies = Array.from(root.children).filter(
      (child) => child.tagName === "trophy"
    );
    if (!trophies.length || trophies.length > MAX_TROPHIES)
      throw new Error("Invalid trophy count");
    const ids = new Set<number>();
    const setNumber = Number(setId.slice(4, 9)) * 100 + Number(setId.slice(10));
    return trophies.map((node) => {
      const rawId = node.getAttribute("id") ?? "";
      const id = Number(rawId);
      const grade = grades[node.getAttribute("ttype") as keyof typeof grades];
      if (!/^\d+$/.test(rawId) || id >= MAX_TROPHIES || ids.has(id) || !grade)
        throw new Error("Invalid trophy definition");
      ids.add(id);
      const state = states.get(id);
      const icon = `local:${path.join(directory, `TROP${String(id).padStart(3, "0")}.PNG`)}`;
      return {
        name: `${setId}:${id}`,
        displayName: text(node, "name"),
        description: text(node, "detail"),
        hidden: /^y/i.test(node.getAttribute("hidden") ?? ""),
        icon,
        icongray: icon,
        trophyGrade: grade.grade,
        points: grade.points * RPCS3_TROPHY_POINTS_MULTIPLIER,
        globalUnlockPercentage: null,
        set: { id: setNumber, name: title, order: setNumber },
        externalSetId: setId,
        externalId: String(id),
        unlocked: state?.unlocked ?? false,
        unlockTime: state?.unlocked ? state.unlockTime : null,
        source: "rpcs3",
      };
    });
  } finally {
    dom.window.close();
  }
};

const readBounded = async (file: string) => {
  const handle = await fs.open(file, "r");
  try {
    if ((await handle.stat()).size > MAX_FILE_SIZE)
      throw new Error("Trophy file too large");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
};

export const readTrophySet = async (
  directory: string,
  setId: string,
  requireState = false
) => {
  const definitions = await readBounded(path.join(directory, "TROPCONF.SFM"));
  const data = await readBounded(path.join(directory, "TROPUSR.DAT")).catch(
    (error: NodeJS.ErrnoException) => {
      if (!requireState && error.code === "ENOENT") return null;
      throw error;
    }
  );
  return parseTrophyDefinitions(
    definitions,
    setId,
    directory,
    data ? parseTrophyStates(data) : new Map()
  );
};
