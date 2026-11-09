import path from "node:path";

import type {
  CloudSaveCustomPath,
  CloudSaveFileIdentity,
  EmulatorDiscIdentityStatus,
  Game,
} from "@types";

import {
  parseShadps4SaveRawPath,
  safeRelativeSegments,
} from "./emulator-provider-identity.js";
import {
  isShadps4SyncedSaveFile,
  normalizeShadps4Serial,
  readShadps4DiscIds,
  type Shadps4DiscIds,
} from "./shadps4-save-layout.js";

const WRONG_GAME = "cloud_save_shadps4_save_wrong_game";

/**
 * PS4 games are identified from their own sce_sys/param.sfo. Unlike RPCS3,
 * there is no catalogue check, so "mismatch" and "catalogue-unavailable"
 * never happen here.
 */
export const inspectShadps4DiscIdentity = async (
  game: Pick<Game, "discs">,
  readIds: (
    discPath: string
  ) => Promise<Shadps4DiscIds | null> = readShadps4DiscIds
): Promise<{ status: EmulatorDiscIdentityStatus; saveTitleIds: string[] }> => {
  const discs = (game.discs ?? []).filter((disc) => disc.path.trim());
  if (!discs.length) {
    return {
      status: { status: "missing", path: null, titleId: null },
      saveTitleIds: [],
    };
  }
  const saveTitleIds = new Set<string>();
  for (const disc of discs) {
    const ids = await readIds(disc.path).catch(() => null);
    if (!ids) {
      return {
        status: { status: "unverified", path: disc.path, titleId: null },
        saveTitleIds: [],
      };
    }
    if (normalizeShadps4Serial(disc.sku) !== ids.titleId) {
      return {
        status: { status: "stale-sku", path: disc.path, titleId: ids.titleId },
        saveTitleIds: [],
      };
    }
    saveTitleIds.add(ids.saveTitleId);
  }
  return {
    status: { status: "ready", path: null, titleId: null },
    saveTitleIds: [...saveTitleIds].sort(),
  };
};

export const getShadps4DiscIdentityStatus = async (game: Game) =>
  (await inspectShadps4DiscIdentity(game)).status;

/** Returns the save title IDs once every disc is confirmed. */
export const assertShadps4DiscIdentity = async (game: Game) => {
  const { status, saveTitleIds } = await inspectShadps4DiscIdentity(game);
  if (status.status !== "ready") {
    throw new Error(
      `cloud_save_shadps4_disc_${status.status.replaceAll("-", "_")}`
    );
  }
  return saveTitleIds;
};

/** Save title ID of a path that runs through `.../savedata/<id>/<dir>/...`. */
const saveTitleIdForSegments = (segments: string[]) => {
  const savedataIndex = segments.findLastIndex(
    (segment) => segment.toLowerCase() === "savedata"
  );
  if (savedataIndex < 0) return null;
  const saveTitleId = normalizeShadps4Serial(segments[savedataIndex + 1]);
  return saveTitleId === segments[savedataIndex + 1] &&
    isShadps4SyncedSaveFile(segments.slice(savedataIndex + 2))
    ? saveTitleId
    : null;
};

/** Validate file identity before any merge can restore or delete it. */
export const assertShadps4SnapshotIdentity = (
  files: Pick<CloudSaveFileIdentity, "rawPath" | "relativePath">[],
  allowedSaveTitleIds: ReadonlySet<string>,
  customPaths: CloudSaveCustomPath[] = []
) => {
  for (const file of files) {
    const segments = safeRelativeSegments(file.relativePath);
    if (file.rawPath.startsWith("<custom>")) {
      const binding = customPaths.find((item) => item.rawPath === file.rawPath);
      const destination =
        binding && segments
          ? binding.kind === "file"
            ? binding.path
            : path.join(binding.path, ...segments)
          : null;
      const localId = destination
        ? saveTitleIdForSegments(path.resolve(destination).split(path.sep))
        : null;
      const rawId = segments
        ? saveTitleIdForSegments([
            ...file.rawPath.replaceAll("\\", "/").split("/"),
            ...segments,
          ])
        : null;
      if (localId && localId === rawId && allowedSaveTitleIds.has(localId)) {
        continue;
      }
      throw new Error(WRONG_GAME);
    }
    const save = parseShadps4SaveRawPath(file.rawPath);
    if (
      !save ||
      !allowedSaveTitleIds.has(save.saveTitleId) ||
      !segments ||
      !isShadps4SyncedSaveFile(segments)
    ) {
      throw new Error(WRONG_GAME);
    }
  }
};
