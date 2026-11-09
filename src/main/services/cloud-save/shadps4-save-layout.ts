import { promises as fs } from "node:fs";
import path from "node:path";

import type { Game } from "@types";

import { parseParamSfoRawValue } from "../emulators/param-sfo.js";

const SERIAL = /^[A-Z]{4}\d{5}$/;

export const normalizeShadps4Serial = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return SERIAL.test(normalized) ? normalized : null;
};

export const SHADPS4_USER_ID = /^\d{1,10}$/;

// shadPS4 writes automatic backups as sibling folders of each save:
// sce_bu_<dir>, sce_bu_tmp_<dir> and sce_bu_old_<dir>. They are not synced.
export const isShadps4BackupDir = (name: string) => name.startsWith("sce_bu_");

// shadPS4 creates <save>/sce_sys/corrupted only while a save is mounted.
export const isShadps4MountMarker = (segments: readonly string[]) =>
  segments.length === 3 &&
  segments[1].toLowerCase() === "sce_sys" &&
  segments[2].toLowerCase() === "corrupted";

/** `segments` are relative to `savedata/<save title id>/`. */
export const isShadps4SyncedSaveFile = (segments: readonly string[]) =>
  segments.length >= 2 &&
  !isShadps4BackupDir(segments[0]) &&
  !isShadps4MountMarker(segments);

export interface Shadps4DiscIds {
  /** TITLE_ID from the game's param.sfo. */
  titleId: string;
  /** Folder name shadPS4 saves under: INSTALL_DIR_SAVEDATA, or the serial. */
  saveTitleId: string;
}

/**
 * Reads the IDs shadPS4 itself uses for a game folder. The serial comes from
 * CONTENT_ID when present (as in shadPS4), otherwise TITLE_ID.
 */
export const readShadps4DiscIds = async (
  discPath: string
): Promise<Shadps4DiscIds | null> => {
  const data = await fs
    .readFile(path.join(discPath, "sce_sys", "param.sfo"))
    .catch(() => null);
  if (!data) return null;
  const titleId = normalizeShadps4Serial(
    parseParamSfoRawValue(data, "TITLE_ID")
  );
  if (!titleId) return null;
  const contentSerial = normalizeShadps4Serial(
    parseParamSfoRawValue(data, "CONTENT_ID")?.slice(7, 16)
  );
  const saveTitleId =
    normalizeShadps4Serial(
      parseParamSfoRawValue(data, "INSTALL_DIR_SAVEDATA")
    ) ??
    contentSerial ??
    titleId;
  return { titleId, saveTitleId };
};

const gameDiscPaths = (game: Pick<Game, "discs">) =>
  (game.discs ?? []).map((disc) => disc.path).filter((p) => p.trim());

/** Save title IDs of every readable disc of the game, without verification. */
export const getShadps4SavedataTitleIds = async (
  game: Pick<Game, "discs">
): Promise<string[]> => {
  const ids = await Promise.all(gameDiscPaths(game).map(readShadps4DiscIds));
  return [
    ...new Set(ids.flatMap((entry) => (entry ? [entry.saveTitleId] : []))),
  ].sort((a, b) => a.localeCompare(b));
};

/** For custom tracked paths: is this file inside one of the game's saves? */
export const isShadps4GameSaveFile = (
  filePath: string,
  saveTitleIds: readonly string[]
) => {
  const segments = path.resolve(filePath).split(path.sep);
  const savedataIndex = segments.findLastIndex(
    (segment) => segment.toLowerCase() === "savedata"
  );
  return (
    savedataIndex >= 0 &&
    saveTitleIds.includes(segments[savedataIndex + 1]) &&
    isShadps4SyncedSaveFile(segments.slice(savedataIndex + 2))
  );
};
