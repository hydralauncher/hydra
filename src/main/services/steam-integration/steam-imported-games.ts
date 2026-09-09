import type { Game } from "@types";

export const shouldRemoveImportedSteamGame = (
  game: Pick<Game, "shop" | "isDeleted" | "objectId" | "source">,
  steamOnlyObjectIds: Set<string>
): boolean => {
  if (game.shop !== "steam" || game.isDeleted) return false;
  if (game.source === "steam") return true;
  return steamOnlyObjectIds.has(game.objectId);
};

export const collectSteamOnlyObjectIds = (
  games: { objectId: string; source?: string | null }[]
): string[] =>
  games.filter((game) => game.source === "steam").map((game) => game.objectId);
