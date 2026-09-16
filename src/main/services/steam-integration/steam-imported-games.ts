import type { Game } from "@types";

type ImportedSteamGame = Pick<
  Game,
  | "shop"
  | "isDeleted"
  | "objectId"
  | "source"
  | "executablePath"
  | "installedSizeInBytes"
  | "trackingExecutablePaths"
  | "hasActiveSteamImport"
  | "steamPlayTimeInMilliseconds"
  | "lastTimePlayed"
> & {
  playTimeInMilliseconds?: number | null;
};

const hasLocalSteamInstall = (game: ImportedSteamGame): boolean =>
  Boolean(game.executablePath) ||
  Boolean(game.installedSizeInBytes) ||
  Boolean(game.trackingExecutablePaths?.length);

const hasHydraPlaytime = (game: ImportedSteamGame): boolean =>
  (game.playTimeInMilliseconds ?? 0) > 0;

export const shouldRemoveImportedSteamGame = (
  game: ImportedSteamGame,
  steamOnlyObjectIds: Set<string>
): boolean => {
  if (game.shop !== "steam" || game.isDeleted) return false;
  if (hasHydraPlaytime(game)) return false;
  if (steamOnlyObjectIds.has(game.objectId)) return true;
  if (hasLocalSteamInstall(game)) return false;
  return game.source === "steam";
};

export const hasImportedSteamData = (
  game: ImportedSteamGame,
  steamOnlyObjectIds: Set<string>
) =>
  game.shop === "steam" &&
  (game.hasActiveSteamImport === true ||
    (game.steamPlayTimeInMilliseconds ?? 0) > 0 ||
    game.source === "steam" ||
    steamOnlyObjectIds.has(game.objectId));

export const getSteamImportedDataCleanupPlan = (game: ImportedSteamGame) => ({
  cleanup: {
    hasActiveSteamImport: false,
    steamPlayTimeInMilliseconds: 0,
    lastTimePlayed: null,
    source: game.source === "steam" ? ("hydra" as const) : game.source,
  },
  lastTimePlayedFallback: game.lastTimePlayed ?? null,
});

export const collectSteamOnlyObjectIds = (
  games: { objectId: string; source?: string | null }[]
): string[] =>
  games.filter((game) => game.source === "steam").map((game) => game.objectId);
