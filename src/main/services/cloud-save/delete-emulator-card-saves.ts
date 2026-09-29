import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { promises as fs } from "node:fs";

import type { Game, LocalGameSnapshotSourceFile } from "@types";

import {
  buildMcsBuffer,
  parseMcsBuffer,
  readPs1SaveContents,
  removeMcsFromCardBuffer,
} from "../emulators/ps1-memory-card/index.js";
import {
  buildPsuBuffer,
  extractSkuFromSaveFolder,
  listSaves,
  parsePsuBuffer,
  readSaveContents,
  removePsuFromCard,
} from "../emulators/ps2-memory-card/index.js";
import {
  extractDolphinRawCardGame,
  parseDolphinRawCard,
  parseDolphinRawCardPath,
  removeDolphinRawCardGcis,
} from "./dolphin-raw-card.js";
import { resolveDolphinRawCardTarget } from "./dolphin-save-provider.js";
import {
  parseDuckstationCardRawPath,
  resolveDuckstationCardTarget,
} from "./duckstation-save-provider.js";
import {
  isPcsx2CardRawPath,
  resolvePcsx2CardTarget,
} from "./pcsx2-save-provider.js";
import { serialsForGame, sha256 } from "./playstation-save-common.js";

type CardKind = "ps1" | "ps2" | "dolphin";
export type CardItem = {
  kind: CardKind;
  target: string;
  source: LocalGameSnapshotSourceFile;
  bytes: Buffer;
};
type PendingCard = {
  target: string;
  original: Buffer;
  prepared: Buffer | null;
  backup: string;
  temp: string;
};

const cardKind = (rawPath: string): CardKind | null =>
  parseDuckstationCardRawPath(rawPath)
    ? "ps1"
    : isPcsx2CardRawPath(rawPath)
      ? "ps2"
      : parseDolphinRawCardPath(rawPath)
        ? "dolphin"
        : null;

const cardTarget = async (
  game: Game,
  source: LocalGameSnapshotSourceFile,
  kind: CardKind
) => {
  if (kind === "ps1") return resolveDuckstationCardTarget(game, source);
  if (kind === "ps2") return resolvePcsx2CardTarget(game, source);
  return resolveDolphinRawCardTarget(game, source);
};

const checkedFile = async (file: string) => {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error("cloud_save_memory_card_target_unavailable");
  }
  return stat;
};

const validateSource = async (
  game: Game,
  source: LocalGameSnapshotSourceFile,
  kind: CardKind
): Promise<CardItem> => {
  await checkedFile(source.absolutePath);
  const bytes = await fs.readFile(source.absolutePath);
  if (bytes.length !== source.sizeBytes || sha256(bytes) !== source.hash) {
    throw new Error("cloud_save_memory_card_export_changed");
  }
  const target = await cardTarget(game, source, kind);
  if (!target) throw new Error("cloud_save_memory_card_target_unavailable");
  await checkedFile(target);
  const gameSerials = serialsForGame(game);
  if (kind === "ps1") {
    const identity = parseDuckstationCardRawPath(source.rawPath)!;
    const save = parseMcsBuffer(bytes);
    if (
      !save ||
      !gameSerials.has(identity.serial) ||
      extractSkuFromSaveFolder(save.identifier) !== identity.serial ||
      !/^[a-f0-9]{64}\.mcs$/.test(source.relativePath) ||
      source.relativePath !== `${sha256(save.identifier)}.mcs`
    ) {
      throw new Error("cloud_save_memory_card_save_mismatch");
    }
  } else if (kind === "ps2") {
    const identity = /^<emulator>\/pcsx2-card\/([A-Z]{4}-\d{5})\//.exec(
      source.rawPath
    );
    const save = parsePsuBuffer(bytes);
    if (
      !identity ||
      !save ||
      !gameSerials.has(identity[1]) ||
      extractSkuFromSaveFolder(save.folderName) !== identity[1] ||
      source.relativePath !== `${sha256(save.folderName)}.psu`
    ) {
      throw new Error("cloud_save_memory_card_save_mismatch");
    }
  } else if (!/^[a-f0-9]{24}\.gci$/.test(source.relativePath)) {
    throw new Error("dolphin_card_delete_identity_invalid");
  }
  return { kind, target, source, bytes };
};

const preparePs1 = async (
  target: string,
  original: Buffer,
  items: CardItem[]
) => {
  let output = original;
  for (const item of items) {
    const save = parseMcsBuffer(item.bytes)!;
    const current = await readPs1SaveContents(target, save.identifier);
    if (!current || !buildMcsBuffer(current).equals(item.bytes)) {
      throw new Error("cloud_save_memory_card_save_changed");
    }
    output = removeMcsFromCardBuffer(output, item.bytes);
  }
  return output;
};

const preparePs2 = async (
  target: string,
  original: Buffer,
  items: CardItem[],
  temp: string
) => {
  const before = await listSaves(target);
  if (!before) throw new Error("cloud_save_ps2_card_invalid");
  const existing = new Map<string, Buffer>();
  for (const save of before.saves) {
    if (existing.has(save.folderName))
      throw new Error("cloud_save_ps2_card_save_ambiguous");
    const contents = await readSaveContents(target, save.folderName);
    if (!contents) throw new Error("cloud_save_ps2_card_save_unreadable");
    existing.set(save.folderName, buildPsuBuffer(contents));
  }
  const deleted = new Set<string>();
  for (const item of items) {
    const save = parsePsuBuffer(item.bytes)!;
    if (
      deleted.has(save.folderName) ||
      !existing.get(save.folderName)?.equals(item.bytes)
    ) {
      throw new Error("cloud_save_memory_card_save_changed");
    }
    deleted.add(save.folderName);
  }
  await fs.writeFile(temp, original, { flag: "wx" });
  for (const name of deleted) await removePsuFromCard(temp, name);
  const after = await listSaves(temp);
  if (
    !after ||
    after.saves.some((save) => deleted.has(save.folderName)) ||
    after.saves.length !== existing.size - deleted.size
  ) {
    throw new Error("cloud_save_ps2_card_delete_verification_failed");
  }
  for (const save of after.saves) {
    const contents = await readSaveContents(temp, save.folderName);
    if (
      !contents ||
      !existing.get(save.folderName)?.equals(buildPsuBuffer(contents))
    ) {
      throw new Error("cloud_save_ps2_card_other_save_changed");
    }
  }
};

const prepareDolphin = (original: Buffer, items: CardItem[]) => {
  const before = parseDolphinRawCard(original);
  const byGame = new Map<string, string[]>();
  for (const item of items) {
    const identity = parseDolphinRawCardPath(item.source.rawPath)!;
    const current = extractDolphinRawCardGame(before, identity.gameId).find(
      (entry) => entry.fileName === item.source.relativePath
    );
    if (!current?.buffer.equals(item.bytes)) {
      throw new Error("dolphin_card_delete_entry_changed");
    }
    byGame.set(identity.gameId, [
      ...(byGame.get(identity.gameId) ?? []),
      item.source.relativePath,
    ]);
  }
  let output = original;
  for (const [gameId, names] of byGame) {
    output = removeDolphinRawCardGcis(output, gameId, names);
  }
  return output;
};

/** Card writes and ordinary file deletion either both finish or card backups remain. */
export const deleteEmulatorCardSaves = async <T>(
  game: Game | null | undefined,
  sources: LocalGameSnapshotSourceFile[],
  deleteOtherFiles: () => Promise<T>,
  assertEnvironmentCurrent?: () => Promise<void>
): Promise<T> => {
  const cardSources = sources.flatMap((source) => {
    const kind = cardKind(source.rawPath);
    return kind ? [{ source, kind }] : [];
  });
  if (cardSources.length === 0) return deleteOtherFiles();
  if (!game) throw new Error("cloud_save_memory_card_game_unavailable");
  const items = await Promise.all(
    cardSources.map(({ source, kind }) => validateSource(game, source, kind))
  );
  return deleteResolvedEmulatorCardSaves(
    items,
    deleteOtherFiles,
    assertEnvironmentCurrent
  );
};

/** Resolved form also lets tests exercise the filesystem transaction directly. */
export const deleteResolvedEmulatorCardSaves = async <T>(
  items: CardItem[],
  deleteOtherFiles: () => Promise<T>,
  assertEnvironmentCurrent?: () => Promise<void>
): Promise<T> => {
  const grouped = new Map<string, CardItem[]>();
  for (const item of items) {
    const group = grouped.get(item.target) ?? [];
    if (group.some((member) => member.kind !== item.kind)) {
      throw new Error("cloud_save_memory_card_type_ambiguous");
    }
    group.push(item);
    grouped.set(item.target, group);
  }

  const pending: PendingCard[] = [];
  const replaced: PendingCard[] = [];
  const retained = new Set<string>();
  try {
    for (const [target, group] of grouped) {
      await assertEnvironmentCurrent?.();
      const stat = await checkedFile(target);
      const original = await fs.readFile(target);
      const temp = `${target}.hydra-delete-${randomUUID()}`;
      const backup = `${target}.hydra-backup-${randomUUID()}`;
      const pendingCard: PendingCard = {
        target,
        original,
        prepared: null,
        temp,
        backup,
      };
      pending.push(pendingCard);
      const kind = group[0].kind;
      if (kind === "ps2") {
        await preparePs2(target, original, group, temp);
      } else {
        const next =
          kind === "ps1"
            ? await preparePs1(target, original, group)
            : prepareDolphin(original, group);
        await fs.writeFile(temp, next, { flag: "wx", mode: stat.mode });
      }
      await fs.chmod(temp, stat.mode);
      await fs.copyFile(target, backup, constants.COPYFILE_EXCL);
      pendingCard.prepared = await fs.readFile(temp);
    }
    for (const item of pending) {
      await assertEnvironmentCurrent?.();
      await checkedFile(item.target);
      if (!(await fs.readFile(item.target)).equals(item.original)) {
        throw new Error("cloud_save_memory_card_changed_during_delete");
      }
      await fs.rename(item.temp, item.target);
      replaced.push(item);
    }
    await assertEnvironmentCurrent?.();
    return await deleteOtherFiles();
  } catch (error) {
    const rollbackErrors: Error[] = [];
    for (const item of replaced.reverse()) {
      const rollback = `${item.target}.hydra-rollback-${randomUUID()}`;
      try {
        const current = await fs.readFile(item.target);
        if (!item.prepared || !current.equals(item.prepared)) {
          throw new Error("cloud_save_memory_card_changed_during_rollback");
        }
        await fs.copyFile(item.backup, rollback, constants.COPYFILE_EXCL);
        await fs.rename(rollback, item.target);
      } catch (rollbackError) {
        retained.add(item.backup);
        rollbackErrors.push(rollbackError as Error);
      } finally {
        await fs.rm(rollback, { force: true }).catch(() => undefined);
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `cloud_save_memory_card_rollback_failed: ${[...retained].join(", ")}`
      );
    }
    throw error;
  } finally {
    for (const item of pending) {
      await fs.rm(item.temp, { force: true }).catch(() => undefined);
      if (!retained.has(item.backup)) {
        await fs.rm(item.backup, { force: true }).catch(() => undefined);
      }
    }
  }
};
