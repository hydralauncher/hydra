import crypto from "node:crypto";
import type { Game } from "@types";

export const LOCAL_API_DEFAULT_PORT = 17577;
export const LOCAL_API_VERSION = 1;

export const generateLocalApiToken = () =>
  crypto.randomBytes(32).toString("hex");

export const isAuthorizedLocalApiRequest = (
  authorizationHeader: string | string[] | undefined,
  token: string
) => {
  if (!token || Array.isArray(authorizationHeader)) return false;
  if (!authorizationHeader?.startsWith("Bearer ")) return false;

  const credentials = authorizationHeader.slice("Bearer ".length);
  const expected = Buffer.from(token);
  const provided = Buffer.from(credentials);

  return (
    provided.length === expected.length &&
    crypto.timingSafeEqual(provided, expected)
  );
};

export interface LocalApiGame {
  shop: Game["shop"];
  objectId: string;
  title: string;
  playTimeInMilliseconds: number;
  steamPlayTimeInMilliseconds: number;
  epicPlayTimeInMilliseconds: number;
  lastTimePlayed: string | null;
  addedToLibraryAt: string | null;
  favorite: boolean;
}

// LevelDB stores values as JSON, so dates come back as ISO strings, not Date
// instances. Both shapes are accepted here.
const toIsoString = (
  value: Date | string | null | undefined
): string | null => {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
};

export const buildLocalApiGamesResponse = (games: Game[]) => ({
  games: games
    .filter((game) => !game.isDeleted && Boolean(game.objectId))
    .map(
      (game): LocalApiGame => ({
        shop: game.shop,
        objectId: game.objectId,
        title: game.title,
        playTimeInMilliseconds: game.playTimeInMilliseconds ?? 0,
        steamPlayTimeInMilliseconds: game.steamPlayTimeInMilliseconds ?? 0,
        epicPlayTimeInMilliseconds: game.epicPlayTimeInMilliseconds ?? 0,
        lastTimePlayed: toIsoString(game.lastTimePlayed),
        addedToLibraryAt: toIsoString(game.addedToLibraryAt),
        favorite: game.favorite ?? false,
      })
    ),
});
