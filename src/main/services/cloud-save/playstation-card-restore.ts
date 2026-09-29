import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Game, RestoreManifestFile } from "@types";

import {
  buildMcsBuffer,
  importMcsIntoCard,
  parseMcsBuffer,
  readPs1SaveContents,
} from "../emulators/ps1-memory-card/index.js";
import {
  buildPsuBuffer,
  extractSkuFromSaveFolder,
  importPsuIntoCard,
  parsePsuBuffer,
  readSaveContents,
} from "../emulators/ps2-memory-card/index.js";
import { parseDuckstationCardRawPath } from "./duckstation-save-provider.js";
import { isPcsx2CardRawPath } from "./pcsx2-save-provider.js";
import {
  isRegularFile,
  serialsForGame,
  sha256,
} from "./playstation-save-common.js";

export interface PlaystationCardRestoreItem {
  file: RestoreManifestFile;
  stagedPath: string;
  targetPath: string;
}

export const isPlaystationCardRawPath = (rawPath: string) =>
  Boolean(parseDuckstationCardRawPath(rawPath)) || isPcsx2CardRawPath(rawPath);

type ValidatedItem = PlaystationCardRestoreItem & {
  format: "mcs" | "psu";
  saveName: string;
  bytes: Buffer;
};

const validateItem = async (
  game: Game,
  item: PlaystationCardRestoreItem
): Promise<ValidatedItem> => {
  if (!(await isRegularFile(item.targetPath))) {
    throw new Error("cloud_save_memory_card_target_unavailable");
  }
  const bytes = await fs.readFile(item.stagedPath);
  const duckstation = parseDuckstationCardRawPath(item.file.rawPath);
  if (duckstation) {
    const save = parseMcsBuffer(bytes);
    if (
      !save ||
      !serialsForGame(game).has(duckstation.serial) ||
      extractSkuFromSaveFolder(save.identifier) !== duckstation.serial ||
      item.file.relativePath !== `${sha256(save.identifier)}.mcs`
    ) {
      throw new Error("cloud_save_memory_card_save_mismatch");
    }
    return { ...item, format: "mcs", saveName: save.identifier, bytes };
  }
  const pcsx2 =
    /^<emulator>\/pcsx2-card\/([A-Z]{4}-\d{5})\/(?:1|2|m[12]s[123])$/.exec(
      item.file.rawPath
    );
  const save = parsePsuBuffer(bytes);
  if (
    !pcsx2 ||
    !save ||
    !serialsForGame(game).has(pcsx2[1]) ||
    extractSkuFromSaveFolder(save.folderName) !== pcsx2[1] ||
    item.file.relativePath !== `${sha256(save.folderName)}.psu`
  ) {
    throw new Error("cloud_save_memory_card_save_mismatch");
  }
  return { ...item, format: "psu", saveName: save.folderName, bytes };
};

const alreadyMatches = async (item: ValidatedItem) => {
  if (item.format === "mcs") {
    const current = await readPs1SaveContents(item.targetPath, item.saveName);
    return current ? buildMcsBuffer(current).equals(item.bytes) : false;
  }
  const current = await readSaveContents(item.targetPath, item.saveName);
  return current ? buildPsuBuffer(current).equals(item.bytes) : false;
};

export const applyPlaystationCardRestore = async (
  game: Game,
  items: PlaystationCardRestoreItem[]
): Promise<void> => {
  if (items.length === 0) return;
  // Validate every import before touching any card. A remote .mcs/.psu must
  // contain the save named by its cloud key and belong to this game.
  const validated = await Promise.all(
    items.map((item) => validateItem(game, item))
  );
  const toApply: ValidatedItem[] = [];
  for (const item of validated) {
    if (!(await alreadyMatches(item))) toApply.push(item);
  }
  if (toApply.length === 0) return;

  const backupRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), `hydra-cloud-v2-card-${randomUUID()}-`)
  );
  const cards = [...new Set(toApply.map((item) => item.targetPath))];
  const backups = new Map<string, string>();
  const originals = new Map<string, Buffer>();
  const appliedBytes = new Map<string, Buffer>();
  let preserveBackups = false;
  try {
    for (const card of cards) {
      const backup = path.join(backupRoot, `${sha256(card)}.bak`);
      await fs.copyFile(card, backup);
      backups.set(card, backup);
      const original = await fs.readFile(backup);
      originals.set(card, original);
      if (!(await fs.readFile(card)).equals(original)) {
        throw new Error("cloud_save_memory_card_changed_before_restore");
      }
    }
    for (const item of toApply) {
      const expected =
        appliedBytes.get(item.targetPath) ?? originals.get(item.targetPath)!;
      if (!(await fs.readFile(item.targetPath)).equals(expected)) {
        throw new Error("cloud_save_memory_card_changed_before_restore");
      }
      const temp = `${item.targetPath}.hydra-import-${randomUUID()}`;
      try {
        await fs.copyFile(item.targetPath, temp, constants.COPYFILE_EXCL);
        const result =
          item.format === "mcs"
            ? await importMcsIntoCard(temp, item.bytes)
            : await importPsuIntoCard(temp, item.bytes);
        if (!result.ok) {
          throw new Error(
            result.error ?? "cloud_save_memory_card_import_failed"
          );
        }
        const prepared = await fs.readFile(temp);
        if (!(await fs.readFile(item.targetPath)).equals(expected)) {
          throw new Error("cloud_save_memory_card_changed_before_restore");
        }
        await fs.rename(temp, item.targetPath);
        appliedBytes.set(item.targetPath, prepared);
      } finally {
        await fs.rm(temp, { force: true }).catch(() => undefined);
        await fs
          .rm(`${temp}.hydra-bak`, { force: true })
          .catch(() => undefined);
      }
    }
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const [card, expected] of appliedBytes) {
      const backup = backups.get(card)!;
      const rollbackTemp = `${card}.hydra-rollback-${randomUUID()}`;
      try {
        if (!(await fs.readFile(card)).equals(expected)) {
          throw new Error("cloud_save_memory_card_changed_during_rollback");
        }
        await fs.copyFile(backup, rollbackTemp, constants.COPYFILE_EXCL);
        await fs.rename(rollbackTemp, card);
      } catch {
        rollbackFailures.push(card);
      } finally {
        await fs.rm(rollbackTemp, { force: true }).catch(() => undefined);
      }
    }
    if (rollbackFailures.length) {
      preserveBackups = true;
      throw new Error(
        `cloud_save_memory_card_rollback_failed:${rollbackFailures
          .map((card) => backups.get(card))
          .join(",")}`,
        { cause: error }
      );
    }
    throw error;
  } finally {
    if (!preserveBackups) {
      await fs
        .rm(backupRoot, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }
};
