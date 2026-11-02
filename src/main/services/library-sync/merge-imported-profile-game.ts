import type { Game, GameShop, LibraryCatalogueMetadata } from "@types";
import { mergeLocalAndRemotePlayTime } from "../../../shared/playtime.js";
import { mergeLibraryCatalogueMetadata } from "../../../shared/library-catalogue.js";
import { resolveLibraryIsDeleted } from "./resolve-library-source.js";

export interface ImportedProfileGame extends LibraryCatalogueMetadata {
  id: string;
  source?: string;
  objectId: string;
  shop: GameShop;
  createdAt?: Date | string | null;
  lastTimePlayed?: Date | string | null;
  playTimeInSeconds?: number | null;
  playTimeInMilliseconds?: number | null;
  runtime?: number | null;
  runtimeByPlatform?: {
    hydra?: number | null;
    epic?: number;
    steam?: number | null;
  } | null;
  hasManuallyUpdatedPlaytime?: boolean;
  hasActiveSteamImport?: boolean;
  hasActiveEpicImport?: boolean;
  isFavorite?: boolean;
  isPinned?: boolean;
  collectionIds?: string[];
}

const parseDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const latestDate = (
  local: Date | null,
  remote: Date | string | null | undefined
): Date | null => {
  const remoteDate = parseDate(remote);
  if (!remoteDate) return local;
  if (!local || remoteDate > local) return remoteDate;
  return local;
};

export const mergeImportedProfileGame = (
  localGame: Game,
  remoteGame: ImportedProfileGame
): Game => ({
  ...localGame,
  ...mergeLibraryCatalogueMetadata(localGame, remoteGame),
  remoteId:
    localGame.source === "hydra" &&
    localGame.remoteId === null &&
    remoteGame.source === "epic"
      ? null
      : remoteGame.id,
  addedToLibraryAt:
    localGame.addedToLibraryAt ?? parseDate(remoteGame.createdAt),
  lastTimePlayed: latestDate(
    localGame.lastTimePlayed,
    remoteGame.lastTimePlayed
  ),
  ...mergeLocalAndRemotePlayTime(localGame, remoteGame),
  hasActiveSteamImport: remoteGame.hasActiveSteamImport === true,
  hasActiveEpicImport:
    remoteGame.hasActiveEpicImport ?? localGame.hasActiveEpicImport ?? false,
  isDeleted: resolveLibraryIsDeleted(
    localGame.isDeleted,
    undefined,
    remoteGame.hasActiveSteamImport === true,
    remoteGame.hasActiveEpicImport === true
  ),
  hasManuallyUpdatedPlaytime:
    remoteGame.hasManuallyUpdatedPlaytime ??
    localGame.hasManuallyUpdatedPlaytime,
  favorite: remoteGame.isFavorite ?? localGame.favorite,
  isPinned: remoteGame.isPinned ?? localGame.isPinned,
  collectionIds: remoteGame.collectionIds ?? localGame.collectionIds,
});
