import { promises as fs } from "node:fs";
import path from "node:path";

import type { ClassicsDisc, Game } from "@types";

import { parseParamSfoRawValue } from "../emulators/param-sfo.js";
import { getShadps4CatalogueTitleIds } from "./shadps4-catalogue-title-ids.js";

const SERIAL = /^[A-Z]{4}\d{5}$/;

export const SHADPS4_BACKUP_DIR_PREFIX = "sce_bu_";

export const normalizeShadps4Serial = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return SERIAL.test(normalized) ? normalized : null;
};

export const SHADPS4_USER_ID = /^\d{1,10}$/;

export const isShadps4BackupDir = (name: string) =>
  name.startsWith(SHADPS4_BACKUP_DIR_PREFIX);

export const isShadps4MountMarker = (segments: readonly string[]) =>
  segments.length === 3 &&
  segments[1].toLowerCase() === "sce_sys" &&
  segments[2].toLowerCase() === "corrupted";

export const isShadps4SyncedSaveFile = (segments: readonly string[]) =>
  segments.length >= 2 &&
  !isShadps4BackupDir(segments[0]) &&
  !isShadps4MountMarker(segments);

export const findShadps4SaveTitleIndex = (segments: readonly string[]) =>
  segments.findLastIndex(
    (segment, index) =>
      segment.toLowerCase() === "savedata" &&
      normalizeShadps4Serial(segments[index + 1]) === segments[index + 1]
  );

export interface Shadps4DiscIds {
  titleId: string;
  saveTitleId: string;
}

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
  const installDir = parseParamSfoRawValue(data, "INSTALL_DIR_SAVEDATA");
  if (installDir !== null) {
    const saveTitleId = normalizeShadps4Serial(installDir);
    return saveTitleId ? { titleId, saveTitleId } : null;
  }
  const contentSerial = normalizeShadps4Serial(
    parseParamSfoRawValue(data, "CONTENT_ID")?.slice(7, 16)
  );
  return { titleId, saveTitleId: contentSerial ?? titleId };
};

export const shadps4GameFolders = (game: Pick<Game, "discs">) =>
  (game.discs ?? []).filter(
    (disc: ClassicsDisc) =>
      disc.path.trim() && !disc.isExecutable && !disc.recompilationSlug
  );

/**
 * The save folders of the game: the installed disc's, plus those of the game's
 * other versions, so a save made on another region is kept and restored too.
 * Without a readable disc there are none.
 */
export const withShadps4OtherVersionIds = async (
  game: Game,
  discSaveTitleIds: readonly string[],
  readCatalogue: (game: Game) => Promise<string[]> = getShadps4CatalogueTitleIds
): Promise<string[]> => {
  if (!discSaveTitleIds.length) return [];
  const catalogue = await readCatalogue(game).catch(() => []);
  return [
    ...new Set([
      ...discSaveTitleIds,
      ...catalogue.flatMap((id) => {
        const serial = normalizeShadps4Serial(id);
        return serial ? [serial] : [];
      }),
    ]),
  ].sort((a, b) => a.localeCompare(b));
};

export const getShadps4SavedataTitleIds = async (
  game: Game,
  readCatalogue?: (game: Game) => Promise<string[]>
): Promise<string[]> => {
  const ids = await Promise.all(
    shadps4GameFolders(game).map((disc) => readShadps4DiscIds(disc.path))
  );
  return withShadps4OtherVersionIds(
    game,
    ids.flatMap((entry) => (entry ? [entry.saveTitleId] : [])),
    readCatalogue
  );
};

export const isShadps4GameSaveFile = (
  filePath: string,
  saveTitleIds: readonly string[]
) => {
  const segments = path.resolve(filePath).split(path.sep);
  const index = findShadps4SaveTitleIndex(segments);
  return (
    index >= 0 &&
    saveTitleIds.includes(segments[index + 1]) &&
    isShadps4SyncedSaveFile(segments.slice(index + 2))
  );
};
