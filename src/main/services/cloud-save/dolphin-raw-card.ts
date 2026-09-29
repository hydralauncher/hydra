import { randomUUID, createHash } from "node:crypto";
import { constants } from "node:fs";
import { promises as fs } from "node:fs";

import type { Game, RestoreManifestFile } from "@types";

const BLOCK_SIZE = 0x2000;
const DATA_START = 5;
const DIR_ENTRIES = 127;
const ENTRY_SIZE = 0x40;
const BAT_MAP_OFFSET = 0x0a;
const RAW_PATH = /^<emulator>\/dolphin-raw\/([AB])\/([A-Z0-9]{6})$/;

export const dolphinRawCardPath = (slot: "A" | "B", gameId: string) =>
  `<emulator>/dolphin-raw/${slot}/${gameId}`;

export const parseDolphinRawCardPath = (rawPath: string) => {
  const match = RAW_PATH.exec(rawPath);
  return match ? { slot: match[1] as "A" | "B", gameId: match[2] } : null;
};

export const isDolphinRawCardPath = (rawPath: string) =>
  parseDolphinRawCardPath(rawPath) !== null;

const sumWords = (buffer: Buffer, start: number, end: number) => {
  let sum = 0;
  let inverse = 0;
  for (let offset = start; offset < end; offset += 2) {
    const word = buffer.readUInt16BE(offset);
    sum = (sum + word) & 0xffff;
    inverse = (inverse + (word ^ 0xffff)) & 0xffff;
  }
  return [sum === 0xffff ? 0 : sum, inverse === 0xffff ? 0 : inverse];
};

const checksumsMatch = (
  buffer: Buffer,
  block: number,
  start: number,
  end: number,
  sumOffset: number,
  inverseOffset: number
) => {
  const base = block * BLOCK_SIZE;
  const [sum, inverse] = sumWords(buffer, base + start, base + end);
  return (
    buffer.readUInt16BE(base + sumOffset) === sum &&
    buffer.readUInt16BE(base + inverseOffset) === inverse
  );
};

const fixChecksums = (
  buffer: Buffer,
  block: number,
  start: number,
  end: number,
  sumOffset: number,
  inverseOffset: number
) => {
  const base = block * BLOCK_SIZE;
  const [sum, inverse] = sumWords(buffer, base + start, base + end);
  buffer.writeUInt16BE(sum, base + sumOffset);
  buffer.writeUInt16BE(inverse, base + inverseOffset);
};

const entryIdentity = (entry: Buffer) =>
  createHash("sha256")
    .update(entry.subarray(0, 6))
    .update(entry.subarray(8, 0x28))
    .digest("hex")
    .slice(0, 24);

export const dolphinGciFileName = (entry: Buffer) =>
  `${entryIdentity(entry)}.gci`;

const gameIdOfEntry = (entry: Buffer) => {
  const gameId = entry.subarray(0, 6).toString("ascii").toUpperCase();
  return /^[A-Z0-9]{6}$/.test(gameId) ? gameId : null;
};

const serialBoundName = (entry: Buffer) => {
  const name = entry.subarray(8, 0x28);
  const end = name.findIndex((byte) => byte === 0 || byte === 0xff);
  const normalized = name
    .subarray(0, end < 0 ? name.length : end)
    .toString("ascii")
    .toUpperCase();
  return (
    normalized === "F_ZERO.DAT" ||
    normalized === "PSO_SYSTEM" ||
    normalized === "PSO3_SYSTEM"
  );
};

const parseGci = (buffer: Buffer) => {
  if (buffer.length < ENTRY_SIZE) throw new Error("dolphin_gci_invalid_size");
  const entry = buffer.subarray(0, ENTRY_SIZE);
  const gameId = gameIdOfEntry(entry);
  const count = entry.readUInt16BE(0x38);
  if (
    !gameId ||
    count === 0 ||
    count > 2043 ||
    buffer.length !== ENTRY_SIZE + count * BLOCK_SIZE
  ) {
    throw new Error("dolphin_gci_invalid_content");
  }
  return { entry, gameId, count, identity: entryIdentity(entry) };
};

interface CardEntry {
  index: number;
  gameId: string;
  identity: string;
  entry: Buffer;
  blocks: number[];
}

interface ParsedCard {
  buffer: Buffer;
  dirBlock: number;
  batBlock: number;
  entries: CardEntry[];
  freeBlocks: number;
}

const mapOffset = (block: number) => BAT_MAP_OFFSET + (block - DATA_START) * 2;

export const parseDolphinRawCard = (buffer: Buffer): ParsedCard => {
  if (
    buffer.length < BLOCK_SIZE * 6 ||
    buffer.length % BLOCK_SIZE !== 0 ||
    buffer.length > 4096 * BLOCK_SIZE
  )
    throw new Error("dolphin_card_invalid_size");
  const validDirs = [1, 2].filter((block) =>
    checksumsMatch(buffer, block, 0, 0x1ffc, 0x1ffc, 0x1ffe)
  );
  const validBats = [3, 4].filter((block) =>
    checksumsMatch(buffer, block, 4, BLOCK_SIZE, 0, 2)
  );
  // A damaged copy may be repaired by Dolphin, but Hydra must not modify a
  // shared card whose redundancy or ownership cannot be verified.
  if (validDirs.length !== 2 || validBats.length !== 2) {
    throw new Error("dolphin_card_metadata_invalid");
  }
  const newest = (blocks: number[], counterOffset: number) =>
    buffer.readInt16BE(blocks[0] * BLOCK_SIZE + counterOffset) >=
    buffer.readInt16BE(blocks[1] * BLOCK_SIZE + counterOffset)
      ? blocks[0]
      : blocks[1];
  const dirBlock = newest(validDirs, 0x1ffa);
  const batBlock = newest(validBats, 4);
  const batBase = batBlock * BLOCK_SIZE;
  const totalBlocks = buffer.length / BLOCK_SIZE;
  const entries: CardEntry[] = [];
  const claimed = new Set<number>();
  for (let index = 0; index < DIR_ENTRIES; index++) {
    const offset = dirBlock * BLOCK_SIZE + index * ENTRY_SIZE;
    const entry = buffer.subarray(offset, offset + ENTRY_SIZE);
    if (entry.subarray(0, 4).every((byte) => byte === 0xff)) continue;
    const gameId = gameIdOfEntry(entry);
    const count = entry.readUInt16BE(0x38);
    let current = entry.readUInt16BE(0x36);
    if (!gameId || count === 0 || count >= totalBlocks) {
      throw new Error("dolphin_card_entry_invalid");
    }
    const blocks: number[] = [];
    for (let number = 0; number < count; number++) {
      if (
        current < DATA_START ||
        current >= totalBlocks ||
        claimed.has(current)
      ) {
        throw new Error("dolphin_card_block_chain_invalid");
      }
      claimed.add(current);
      blocks.push(current);
      const next = buffer.readUInt16BE(batBase + mapOffset(current));
      if (
        number === count - 1 ? next !== 0xffff : next === 0xffff || next === 0
      ) {
        throw new Error("dolphin_card_block_chain_invalid");
      }
      current = next;
    }
    entries.push({
      index,
      gameId,
      identity: entryIdentity(entry),
      entry,
      blocks,
    });
  }
  let freeBlocks = 0;
  for (let block = DATA_START; block < totalBlocks; block++) {
    if (buffer.readUInt16BE(batBase + mapOffset(block)) === 0) freeBlocks++;
  }
  if (freeBlocks !== buffer.readUInt16BE(batBase + 6)) {
    throw new Error("dolphin_card_free_count_invalid");
  }
  return { buffer, dirBlock, batBlock, entries, freeBlocks };
};

export const extractDolphinRawCardGame = (card: ParsedCard, gameId: string) =>
  card.entries
    .filter((entry) => entry.gameId === gameId)
    .map((entry) => ({
      fileName: dolphinGciFileName(entry.entry),
      serialBound: serialBoundName(entry.entry),
      buffer: Buffer.concat([
        entry.entry,
        ...entry.blocks.map((block) =>
          card.buffer.subarray(block * BLOCK_SIZE, (block + 1) * BLOCK_SIZE)
        ),
      ]),
    }));

const replaceEntry = (card: ParsedCard, gci: Buffer) => {
  const parsed = parseGci(gci);
  if (serialBoundName(parsed.entry)) {
    throw new Error("dolphin_card_serial_bound_save_requires_dolphin_import");
  }
  const existing = card.entries.find(
    (item) => item.identity === parsed.identity
  );
  const buffer = card.buffer;
  const dirBase = card.dirBlock * BLOCK_SIZE;
  const batBase = card.batBlock * BLOCK_SIZE;
  let entryIndex = existing?.index ?? -1;
  if (entryIndex < 0) {
    for (let index = 0; index < DIR_ENTRIES; index++) {
      const offset = dirBase + index * ENTRY_SIZE;
      if (buffer.subarray(offset, offset + 4).every((byte) => byte === 0xff)) {
        entryIndex = index;
        break;
      }
    }
  }
  if (entryIndex < 0) throw new Error("dolphin_card_directory_full");
  for (const block of existing?.blocks ?? []) {
    buffer.writeUInt16BE(0, batBase + mapOffset(block));
  }
  const available: number[] = [];
  for (
    let block = DATA_START;
    block < buffer.length / BLOCK_SIZE && available.length < parsed.count;
    block++
  ) {
    if (buffer.readUInt16BE(batBase + mapOffset(block)) === 0)
      available.push(block);
  }
  if (available.length !== parsed.count)
    throw new Error("dolphin_card_no_space");
  for (let index = 0; index < available.length; index++) {
    const block = available[index];
    buffer.writeUInt16BE(
      available[index + 1] ?? 0xffff,
      batBase + mapOffset(block)
    );
    gci.copy(
      buffer,
      block * BLOCK_SIZE,
      ENTRY_SIZE + index * BLOCK_SIZE,
      ENTRY_SIZE + (index + 1) * BLOCK_SIZE
    );
  }
  const entryOffset = dirBase + entryIndex * ENTRY_SIZE;
  parsed.entry.copy(buffer, entryOffset);
  buffer.writeUInt16BE(available[0], entryOffset + 0x36);
  buffer[entryOffset + 0x35] = (buffer[entryOffset + 0x35] + 1) & 0xff;
  buffer.writeUInt16BE(
    card.freeBlocks + (existing?.blocks.length ?? 0) - parsed.count,
    batBase + 6
  );
  buffer.writeUInt16BE(available.at(-1)!, batBase + 8);
  card.freeBlocks += (existing?.blocks.length ?? 0) - parsed.count;
  card.entries = parseDolphinRawCard(withUpdatedMetadata(card)).entries;
};

const withUpdatedMetadata = (card: ParsedCard) => {
  const { buffer, dirBlock, batBlock } = card;
  for (const [
    active,
    copies,
    counterOffset,
    sumStart,
    sumEnd,
    sumOffset,
    inverseOffset,
  ] of [
    [dirBlock, [1, 2], 0x1ffa, 0, 0x1ffc, 0x1ffc, 0x1ffe],
    [batBlock, [3, 4], 4, 4, BLOCK_SIZE, 0, 2],
  ] as const) {
    const counter =
      (buffer.readUInt16BE(active * BLOCK_SIZE + counterOffset) + 1) & 0xffff;
    buffer.writeUInt16BE(counter, active * BLOCK_SIZE + counterOffset);
    fixChecksums(buffer, active, sumStart, sumEnd, sumOffset, inverseOffset);
    for (const copy of copies) {
      if (copy !== active)
        buffer.copy(
          buffer,
          copy * BLOCK_SIZE,
          active * BLOCK_SIZE,
          (active + 1) * BLOCK_SIZE
        );
    }
  }
  return buffer;
};

export const mergeDolphinRawCard = (
  original: Buffer,
  gameId: string,
  gcis: Buffer[]
) => {
  const card = parseDolphinRawCard(Buffer.from(original));
  for (const gci of gcis) {
    const parsed = parseGci(gci);
    if (parsed.gameId !== gameId) throw new Error("dolphin_card_wrong_game");
    replaceEntry(card, gci);
  }
  const merged = withUpdatedMetadata(card);
  parseDolphinRawCard(merged);
  return merged;
};

const safeCardFile = async (cardPath: string) => {
  const stat = await fs.lstat(cardPath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    !/\.(?:raw|gcp)$/i.test(cardPath)
  ) {
    throw new Error("dolphin_card_unsafe_path");
  }
  return stat;
};

export const readDolphinRawCard = async (cardPath: string) => {
  await safeCardFile(cardPath);
  return parseDolphinRawCard(await fs.readFile(cardPath));
};

export const validateDolphinManualRawCard = async (
  game: Game,
  cardPath: string
): Promise<boolean> => {
  const gameIds = new Set(
    (game.discs ?? [])
      .map((disc) => disc.sku?.replace(/[^A-Za-z0-9]/g, "").toUpperCase())
      .filter((id): id is string => !!id && /^[A-Z0-9]{6}$/.test(id))
  );
  if (!gameIds.size) return false;
  try {
    const card = await readDolphinRawCard(cardPath);
    return (
      card.entries.length === 0 ||
      card.entries.some((entry) => gameIds.has(entry.gameId))
    );
  } catch {
    return false;
  }
};

export interface DolphinRawRestoreItem {
  file: RestoreManifestFile;
  stagedPath: string;
  targetPath: string;
}

export const applyDolphinRawCardRestore = async (
  game: Game,
  items: DolphinRawRestoreItem[]
) => {
  const gameIds = new Set(
    (game.discs ?? [])
      .map((disc) => disc.sku?.replace(/[^A-Za-z0-9]/g, "").toUpperCase())
      .filter((id): id is string => !!id && /^[A-Z0-9]{6}$/.test(id))
  );
  const grouped = new Map<string, { gameId: string; gcis: Buffer[] }>();
  for (const item of items) {
    const parsedPath = parseDolphinRawCardPath(item.file.rawPath);
    if (
      !parsedPath ||
      !gameIds.has(parsedPath.gameId) ||
      !/^[a-f0-9]{24}\.gci$/.test(item.file.relativePath)
    ) {
      throw new Error("dolphin_card_restore_identity_invalid");
    }
    const gci = await fs.readFile(item.stagedPath);
    const parsedGci = parseGci(gci);
    if (
      parsedGci.gameId !== parsedPath.gameId ||
      dolphinGciFileName(parsedGci.entry) !== item.file.relativePath
    ) {
      throw new Error("dolphin_card_restore_content_mismatch");
    }
    const group = grouped.get(item.targetPath) ?? {
      gameId: parsedPath.gameId,
      gcis: [],
    };
    if (group.gameId !== parsedPath.gameId)
      throw new Error("dolphin_card_restore_slot_conflict");
    group.gcis.push(gci);
    grouped.set(item.targetPath, group);
  }
  const pending: {
    target: string;
    backup: string;
    temp: string;
    original: Buffer;
  }[] = [];
  const replaced: typeof pending = [];
  const retainedBackups = new Set<string>();
  try {
    for (const [target, group] of grouped) {
      const before = await safeCardFile(target);
      const original = await fs.readFile(target);
      const merged = mergeDolphinRawCard(original, group.gameId, group.gcis);
      const current = await safeCardFile(target);
      if (current.size !== before.size || current.mtimeMs !== before.mtimeMs) {
        throw new Error("dolphin_card_changed_during_restore");
      }
      const backup = `${target}.hydra-backup-${randomUUID()}`;
      const temp = `${target}.hydra-restore-${randomUUID()}`;
      pending.push({ target, backup, temp, original });
      await fs.copyFile(target, backup, constants.COPYFILE_EXCL);
      const handle = await fs.open(temp, "wx", before.mode);
      try {
        await handle.writeFile(merged);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    for (const item of pending) {
      const current = await safeCardFile(item.target);
      if (
        current.size !== item.original.length ||
        !(await fs.readFile(item.target)).equals(item.original)
      ) {
        throw new Error("dolphin_card_changed_during_restore");
      }
      await fs.rename(item.temp, item.target);
      replaced.push(item);
    }
  } catch (error) {
    const rollbackErrors: Error[] = [];
    for (const item of replaced.reverse()) {
      const rollbackTemp = `${item.target}.hydra-rollback-${randomUUID()}`;
      try {
        await fs.copyFile(item.backup, rollbackTemp, constants.COPYFILE_EXCL);
        await fs.rename(rollbackTemp, item.target);
      } catch (rollbackError) {
        retainedBackups.add(item.backup);
        rollbackErrors.push(rollbackError as Error);
      } finally {
        await fs.rm(rollbackTemp, { force: true }).catch(() => undefined);
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `dolphin_card_restore_rollback_failed: ${[...retainedBackups].join(", ")}`
      );
    }
    throw error;
  } finally {
    for (const item of pending) {
      await fs.rm(item.temp, { force: true }).catch(() => undefined);
      if (!retainedBackups.has(item.backup)) {
        await fs.rm(item.backup, { force: true }).catch(() => undefined);
      }
    }
  }
};
