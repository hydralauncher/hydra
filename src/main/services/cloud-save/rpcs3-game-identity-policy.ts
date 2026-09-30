import path from "node:path";

import type {
  CloudSaveFileIdentity,
  CloudSaveCustomPath,
  Game,
  Rpcs3DiscIdentityStatus,
} from "@types";

import {
  parseRpcs3SaveRawPath,
  parseRpcs3SavestateRawPath,
  safeRelativeSegments,
} from "./emulator-provider-identity.js";
import {
  rpcs3SavestateFileBelongsToTitle,
  rpcs3SlotBelongsToTitle,
} from "./rpcs3-save-layout.js";

const TITLE_ID = /^[A-Z]{4}\d{5}$/;
export const normalizeRpcs3TitleId = (value: string | null | undefined) => {
  const normalized = value?.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return normalized && TITLE_ID.test(normalized) ? normalized : null;
};

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

const rpcs3TitleIdForLocalSavePath = (filePath: string) => {
  const segments = path.resolve(filePath).split(path.sep);
  const fileName = segments.at(-1) ?? "";
  const stateId = /^([A-Z]{4}\d{5})_/.exec(fileName)?.[1];
  if (stateId && rpcs3SavestateFileBelongsToTitle(fileName, stateId)) {
    return stateId;
  }
  const savedataIndex = segments.lastIndexOf("savedata");
  const slot = segments[savedataIndex + 1];
  const saveId = slot && /^([A-Z]{4}\d{5})/.exec(slot)?.[1];
  return savedataIndex >= 0 && saveId && rpcs3SlotBelongsToTitle(slot, saveId)
    ? saveId
    : null;
};

const rpcs3TitleIdForCustomRawPath = (
  rawPath: string,
  relativePath: string
) => {
  const relative = safeRelativeSegments(relativePath);
  if (!relative) return null;
  const segments = [...rawPath.replaceAll("\\", "/").split("/"), ...relative];
  const savedataIndex = segments.findLastIndex(
    (segment) => segment.toLowerCase() === "savedata"
  );
  const slot = segments[savedataIndex + 1];
  const saveId = slot && /^([A-Z]{4}\d{5})/.exec(slot)?.[1];
  if (savedataIndex >= 0 && saveId && rpcs3SlotBelongsToTitle(slot, saveId)) {
    return saveId;
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
    ? stateId
    : null;
};

/** Validate file identity before any merge can restore or delete it. */
export const assertRpcs3SnapshotIdentity = (
  files: Pick<CloudSaveFileIdentity, "rawPath" | "relativePath">[],
  allowedTitleIds: ReadonlySet<string>,
  customPaths: CloudSaveCustomPath[] = []
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
      const localTitleId = destination
        ? rpcs3TitleIdForLocalSavePath(destination)
        : null;
      if (
        localTitleId &&
        allowedTitleIds.has(localTitleId) &&
        localTitleId ===
          rpcs3TitleIdForCustomRawPath(file.rawPath, file.relativePath)
      ) {
        continue;
      }
      throw new Error("cloud_save_rpcs3_save_wrong_game");
    }
    const save = parseRpcs3SaveRawPath(file.rawPath);
    const state = parseRpcs3SavestateRawPath(file.rawPath);
    const segments = safeRelativeSegments(file.relativePath);
    const titleId = save?.titleId ?? state?.titleId;
    if (
      !titleId ||
      !allowedTitleIds.has(titleId) ||
      !segments ||
      (save &&
        (segments.length < 2 ||
          !rpcs3SlotBelongsToTitle(segments[0], titleId))) ||
      (state &&
        (segments.length !== 1 ||
          !rpcs3SavestateFileBelongsToTitle(segments[0], titleId)))
    ) {
      throw new Error("cloud_save_rpcs3_save_wrong_game");
    }
  }
};
