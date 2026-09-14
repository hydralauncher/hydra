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
>;

const hasLocalSteamInstall = (game: ImportedSteamGame): boolean =>
  Boolean(game.executablePath) ||
  Boolean(game.installedSizeInBytes) ||
  Boolean(game.trackingExecutablePaths?.length);

export const shouldRemoveImportedSteamGame = (
  game: ImportedSteamGame,
  steamOnlyObjectIds: Set<string>
): boolean => {
  if (game.shop !== "steam" || game.isDeleted) return false;
  if (hasLocalSteamInstall(game)) return false;
  if (game.source === "steam") return true;
  return steamOnlyObjectIds.has(game.objectId);
};

export const collectSteamOnlyObjectIds = (
  games: { objectId: string; source?: string | null }[]
): string[] =>
  games.filter((game) => game.source === "steam").map((game) => game.objectId);
