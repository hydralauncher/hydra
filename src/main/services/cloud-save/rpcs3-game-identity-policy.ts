import path from "node:path";

import type {
  CloudSaveFileIdentity,
  CloudSaveCustomPath,
  Game,
  Rpcs3DiscIdentityStatus,
} from "@types";

import {
  parseRpcs3GamedataRawPath,
  parseRpcs3SaveRawPath,
  parseRpcs3SavestateRawPath,
  safeRelativeSegments,
} from "./emulator-provider-identity.js";
import {
  rpcs3GamedataFolderBelongsToTitle,
  rpcs3SavestateFileBelongsToTitle,
  rpcs3SlotBelongsToTitle,
} from "./rpcs3-save-layout.js";
import {
  expandRpcs3SavedataTitleIds,
  normalizeRpcs3TitleId,
} from "./rpcs3-title-ids.js";

export { normalizeRpcs3TitleId } from "./rpcs3-title-ids.js";

const TITLE_ID = /^[A-Z]{4}\d{5}$/;

export interface Rpcs3CatalogueEntry {
  objectId: string;
  shop: string;
  skus?: string[];
}

export const rpcs3TitleIdsFromCatalogue = (
  entries: Rpcs3CatalogueEntry[],
  objectId: string
) => {
  const entry = Array.isArray(entries)
    ? entries.find(
        (item) => item.objectId === objectId && item.shop === "launchbox"
      )
    : null;
  return new Set(
    (Array.isArray(entry?.skus) ? entry.skus : [])
      .map(normalizeRpcs3TitleId)
      .filter((id): id is string => id !== null)
  );
};

export const inspectRpcs3DiscIdentity = async (
  game: Game,
  allowedTitleIds: ReadonlySet<string>,
  readTitleId: (path: string) => Promise<string | null>
): Promise<Rpcs3DiscIdentityStatus> => {
  const discs = (game.discs ?? []).filter((disc) => disc.path.trim());
  if (!discs.length) return { status: "missing", path: null, titleId: null };
  for (const disc of discs) {
    const titleId = normalizeRpcs3TitleId(
      await readTitleId(disc.path).catch(() => null)
    );
    if (!titleId) {
      return { status: "unverified", path: disc.path, titleId: null };
    }
    if (!allowedTitleIds.has(titleId)) {
      return { status: "mismatch", path: disc.path, titleId };
    }
    if (normalizeRpcs3TitleId(disc.sku) !== titleId) {
      return { status: "stale-sku", path: disc.path, titleId };
    }
  }
  return { status: "ready", path: null, titleId: null };
};

interface Rpcs3LocalSaveIdentity {
  titleId: string;
  kind: "savedata" | "savestate" | "gamedata";
}

const GAMEDATA_FOLDER_TITLE_ID = /^([A-Z]{4}\d{5})_USER\d+$/;

const rpcs3GamedataIdentity = (
  segments: string[]
): Rpcs3LocalSaveIdentity | null => {
  const gameIndex = segments.lastIndexOf("game");
  const folder = segments[gameIndex + 1];
  const titleId = folder && GAMEDATA_FOLDER_TITLE_ID.exec(folder)?.[1];
  return gameIndex >= 0 && gameIndex < segments.length - 2 && titleId
    ? { titleId, kind: "gamedata" }
    : null;
};

const rpcs3IdentityForLocalSavePath = (
  filePath: string
): Rpcs3LocalSaveIdentity | null => {
  const segments = path.resolve(filePath).split(path.sep);
  const fileName = segments.at(-1) ?? "";
  const stateId = /^([A-Z]{4}\d{5})_/.exec(fileName)?.[1];
  if (stateId && rpcs3SavestateFileBelongsToTitle(fileName, stateId)) {
    return { titleId: stateId, kind: "savestate" };
  }
  const savedataIndex = segments.lastIndexOf("savedata");
  const slot = segments[savedataIndex + 1];
  const saveId = slot && /^([A-Z]{4}\d{5})/.exec(slot)?.[1];
  return savedataIndex >= 0 && saveId && rpcs3SlotBelongsToTitle(slot, saveId)
    ? { titleId: saveId, kind: "savedata" }
    : rpcs3GamedataIdentity(segments);
};

const rpcs3IdentityForCustomRawPath = (
  rawPath: string,
  relativePath: string
): Rpcs3LocalSaveIdentity | null => {
  const relative = safeRelativeSegments(relativePath);
  if (!relative) return null;
  const segments = [...rawPath.replaceAll("\\", "/").split("/"), ...relative];
  const savedataIndex = segments.findLastIndex(
    (segment) => segment.toLowerCase() === "savedata"
  );
  const slot = segments[savedataIndex + 1];
  const saveId = slot && /^([A-Z]{4}\d{5})/.exec(slot)?.[1];
  if (savedataIndex >= 0 && saveId && rpcs3SlotBelongsToTitle(slot, saveId)) {
    return { titleId: saveId, kind: "savedata" };
  }
  const statesIndex = segments.findLastIndex(
    (segment) => segment.toLowerCase() === "savestates"
  );
  const stateId = segments[statesIndex + 1];
  const fileName = segments.at(-1) ?? "";
  return statesIndex >= 0 &&
    stateId &&
    TITLE_ID.test(stateId) &&
    rpcs3SavestateFileBelongsToTitle(fileName, stateId)
    ? { titleId: stateId, kind: "savestate" }
    : rpcs3GamedataIdentity(segments);
};

/** Validate file identity before any merge can restore or delete it. */
export const assertRpcs3SnapshotIdentity = (
  files: Pick<CloudSaveFileIdentity, "rawPath" | "relativePath">[],
  allowedTitleIds: ReadonlySet<string>,
  customPaths: CloudSaveCustomPath[] = [],
  allowedSavedataTitleIds: ReadonlySet<string> = new Set(
    expandRpcs3SavedataTitleIds(allowedTitleIds)
  )
) => {
  for (const file of files) {
    if (file.rawPath.startsWith("<custom>")) {
      const binding = customPaths.find((item) => item.rawPath === file.rawPath);
      const segments = safeRelativeSegments(file.relativePath);
      const destination =
        binding && segments
          ? binding.kind === "file"
            ? binding.path
            : path.join(binding.path, ...segments)
          : null;
      const localIdentity = destination
        ? rpcs3IdentityForLocalSavePath(destination)
        : null;
      const rawIdentity = rpcs3IdentityForCustomRawPath(
        file.rawPath,
        file.relativePath
      );
      const allowedIds =
        localIdentity?.kind === "savestate"
          ? allowedTitleIds
          : allowedSavedataTitleIds;
      if (
        localIdentity &&
        rawIdentity &&
        allowedIds.has(localIdentity.titleId) &&
        localIdentity.titleId === rawIdentity.titleId &&
        localIdentity.kind === rawIdentity.kind
      ) {
        continue;
      }
      throw new Error("cloud_save_rpcs3_save_wrong_game");
    }
    const save = parseRpcs3SaveRawPath(file.rawPath);
    const state = parseRpcs3SavestateRawPath(file.rawPath);
    const gamedata = parseRpcs3GamedataRawPath(file.rawPath);
    const segments = safeRelativeSegments(file.relativePath);
    const titleId = save?.titleId ?? state?.titleId ?? gamedata?.titleId;
    const allowedIds = state ? allowedTitleIds : allowedSavedataTitleIds;
    if (
      !titleId ||
      !allowedIds.has(titleId) ||
      !segments ||
      (save &&
        (segments.length < 2 ||
          !rpcs3SlotBelongsToTitle(segments[0], titleId))) ||
      (gamedata &&
        (segments.length < 2 ||
          !rpcs3GamedataFolderBelongsToTitle(segments[0], titleId))) ||
      (state &&
        (segments.length !== 1 ||
          !rpcs3SavestateFileBelongsToTitle(segments[0], titleId)))
    ) {
      throw new Error("cloud_save_rpcs3_save_wrong_game");
    }
  }
};
