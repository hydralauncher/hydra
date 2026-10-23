import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

export interface EpicLocalUnlock {
  externalId: string;
  unlockTime: number;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_NEMIRTINGAS_ROWS = 10_000;
const MAX_EXTERNAL_ID_LENGTH = 512;

const NORTHLIGHT_VERSION = 1;
const NORTHLIGHT_HEADER_BYTES = 8;
const NORTHLIGHT_RECORD_BYTES = 16;
const NORTHLIGHT_PROGRESS_RECORD = 2;

// Alan Wake 2 catalogue ids drift away from the record position. Each range
// lists the last position it covers and the offset added to get `m_id`.
const ALAN_WAKE_2_CATALOG_ID_RANGES = [
  { lastPosition: 38, idOffset: 0 },
  { lastPosition: 40, idOffset: 1 },
  { lastPosition: 66, idOffset: 3 },
  { lastPosition: 78, idOffset: 34 },
  { lastPosition: 88, idOffset: 122 },
] as const;

// Verified against the 88-entry Alan Wake 2 catalogue attached to LBX-1070.
// Every other known position unlocks after a single step.
const ALAN_WAKE_2_STEP_THRESHOLDS: Readonly<Record<number, number>> = {
  10: 5,
  11: 6,
  12: 8,
  20: 5,
  34: 13,
  59: 17,
  60: 43,
  63: 14,
  69: 3,
  73: 6,
  81: 5,
  85: 4,
  87: 37,
};

const getAlanWake2CatalogId = (position: number) => {
  const range = ALAN_WAKE_2_CATALOG_ID_RANGES.find(
    ({ lastPosition }) => position <= lastPosition
  );

  return range ? position + range.idOffset : null;
};

/**
 * Reads the whole file and returns null when it changes while being read,
 * since games rewrite these files in place on every flush.
 */
export const readStableFile = (
  filePath: string,
  maxBytes = MAX_FILE_BYTES
): Buffer | null => {
  let handle: number;

  try {
    handle = openSync(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
    );
  } catch {
    return null;
  }

  try {
    const before = fstatSync(handle);
    if (!before.isFile() || before.size > maxBytes) return null;

    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;

    while (length < bytes.length) {
      const count = readSync(
        handle,
        bytes,
        length,
        bytes.length - length,
        length
      );
      if (count === 0) break;
      length += count;
    }

    const after = fstatSync(handle);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      length !== after.size
    ) {
      return null;
    }

    return bytes.subarray(0, length);
  } catch {
    return null;
  } finally {
    closeSync(handle);
  }
};

const isValidExternalId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= MAX_EXTERNAL_ID_LENGTH &&
  ![...value].some((character) => (character.codePointAt(0) ?? 0) < 32);

const decodeJson = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
};

/** Null means the file is malformed or still being written. */
export const parseNemirtingasAchievements = (
  bytes: Uint8Array,
  nowMs = Date.now()
): EpicLocalUnlock[] | null => {
  const rows = decodeJson(bytes);
  if (!Array.isArray(rows) || rows.length > MAX_NEMIRTINGAS_ROWS) return null;

  const seen = new Set<string>();
  const unlocks: EpicLocalUnlock[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;

    const { AchievementId: externalId, UnlockTime: seconds } = row as Record<
      string,
      unknown
    >;

    if (
      !isValidExternalId(externalId) ||
      seen.has(externalId) ||
      typeof seconds !== "number" ||
      !Number.isSafeInteger(seconds) ||
      seconds < 0
    ) {
      return null;
    }

    seen.add(externalId);
    if (seconds === 0) continue;

    const unlockTime = seconds * 1000;
    if (unlockTime > nowMs) return null;

    unlocks.push({ externalId, unlockTime });
  }

  return unlocks;
};

/**
 * Northlight keeps one 16-byte progress record per catalogue entry. The Epic
 * id is the 1-based record position, never the stored catalogue id.
 */
export const parseAlanWake2Achievements = (
  bytes: Uint8Array,
  nowMs = Date.now()
): EpicLocalUnlock[] | null => {
  if (bytes.byteLength < NORTHLIGHT_HEADER_BYTES) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== NORTHLIGHT_VERSION) return null;

  const count = view.getUint32(4, true);
  if (
    bytes.byteLength !==
    NORTHLIGHT_HEADER_BYTES + count * NORTHLIGHT_RECORD_BYTES
  ) {
    return null;
  }

  const unlocks: EpicLocalUnlock[] = [];

  for (let index = 0; index < count; index++) {
    const offset = NORTHLIGHT_HEADER_BYTES + index * NORTHLIGHT_RECORD_BYTES;
    if (view.getUint32(offset, true) !== NORTHLIGHT_PROGRESS_RECORD)
      return null;

    const position = index + 1;
    const catalogId = getAlanWake2CatalogId(position);

    // Positions past the verified catalogue have no known threshold, and a
    // wrong unlock can never be taken back, so they are left out.
    if (catalogId === null) continue;
    if (view.getUint32(offset + 4, true) !== catalogId) return null;

    const stepsCurrent = view.getUint32(offset + 8, true);
    if (stepsCurrent >= (ALAN_WAKE_2_STEP_THRESHOLDS[position] ?? 1)) {
      unlocks.push({ externalId: String(position), unlockTime: nowMs });
    }
  }

  return unlocks;
};
