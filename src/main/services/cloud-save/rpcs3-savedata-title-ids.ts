import type { Game } from "@types";

import { readCachedCatalogueTitleIds } from "./catalogue-title-ids.js";
import {
  rpcs3SavedataTitleIdsForGame,
  rpcs3TitleIdsForGame,
} from "./rpcs3-title-ids.js";

export const getRpcs3SavedataTitleIds = async (
  game: Game,
  readCatalogue: (
    game: Game
  ) => Promise<Iterable<unknown>> = readCachedCatalogueTitleIds
): Promise<string[]> => {
  if (!rpcs3TitleIdsForGame(game).length) return [];
  // Cache access is optional. Local discovery must keep working without it.
  const catalogueIds = await readCatalogue(game).catch(() => []);
  return rpcs3SavedataTitleIdsForGame(game, catalogueIds);
};
