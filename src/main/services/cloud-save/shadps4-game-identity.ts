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
  findShadps4SaveTitleIndex,
  isShadps4SyncedSaveFile,
  normalizeShadps4Serial,
  readShadps4DiscIds,
  shadps4GameFolders,
  type Shadps4DiscIds,
} from "./shadps4-save-layout.js";

const WRONG_GAME = "cloud_save_shadps4_save_wrong_game";

export const inspectShadps4DiscIdentity = async (
  game: Pick<Game, "discs">,
  readIds: (
    discPath: string
  ) => Promise<Shadps4DiscIds | null> = readShadps4DiscIds
): Promise<{ status: EmulatorDiscIdentityStatus; saveTitleIds: string[] }> => {
  const discs = shadps4GameFolders(game);
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
    saveTitleIds: [...saveTitleIds].sort((a, b) => a.localeCompare(b)),
  };
};

export const getShadps4DiscIdentityStatus = async (game: Game) =>
  (await inspectShadps4DiscIdentity(game)).status;

export const assertShadps4DiscIdentity = async (game: Game) => {
  const { status, saveTitleIds } = await inspectShadps4DiscIdentity(game);
  if (status.status !== "ready") {
    throw new Error(
      `cloud_save_shadps4_disc_${status.status.replaceAll("-", "_")}`
    );
  }
  return saveTitleIds;
};

const saveTitleIdForSegments = (segments: string[]) => {
  const index = findShadps4SaveTitleIndex(segments);
  return index >= 0 && isShadps4SyncedSaveFile(segments.slice(index + 2))
    ? segments[index + 1]
    : null;
};

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
