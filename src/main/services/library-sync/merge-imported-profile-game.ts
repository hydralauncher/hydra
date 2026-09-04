import type { Game, GameShop } from "@types";

export interface ImportedProfileGame {
  id: string;
  objectId: string;
  shop: GameShop;
  createdAt?: Date | string | null;
  lastTimePlayed?: Date | string | null;
  playTimeInSeconds?: number | null;
  runtime?: number | null;
  hasManuallyUpdatedPlaytime?: boolean;
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

const remotePlayTimeInMilliseconds = (
  remoteGame: ImportedProfileGame
): number => {
  const seconds = remoteGame.runtime ?? remoteGame.playTimeInSeconds ?? 0;
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return seconds * 1000;
};

export const mergeImportedProfileGame = (
  localGame: Game,
  remoteGame: ImportedProfileGame
): Game => ({
  ...localGame,
  remoteId: remoteGame.id,
  addedToLibraryAt:
    localGame.addedToLibraryAt ?? parseDate(remoteGame.createdAt),
  lastTimePlayed: latestDate(
    localGame.lastTimePlayed,
    remoteGame.lastTimePlayed
  ),
  playTimeInMilliseconds: Math.max(
    localGame.playTimeInMilliseconds,
    remotePlayTimeInMilliseconds(remoteGame)
  ),
  hasManuallyUpdatedPlaytime:
    remoteGame.hasManuallyUpdatedPlaytime ??
    localGame.hasManuallyUpdatedPlaytime,
  favorite: remoteGame.isFavorite ?? localGame.favorite,
  isPinned: remoteGame.isPinned ?? localGame.isPinned,
  collectionIds: remoteGame.collectionIds ?? localGame.collectionIds,
});
