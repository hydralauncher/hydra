import { levelKeys, playLaterSublevel } from "@main/level";
import { getGameCatalogueIdentity } from "@shared";
import type { Game } from "@types";

/**
 * A game leaving the library has already left Play later when it entered it,
 * even if no window read the list in between (e.g. Big Picture).
 */
export const forgetPlayLaterGame = async (
  game: Pick<Game, "shop" | "objectId" | "catalogueGame">
) => {
  const catalogueGame = getGameCatalogueIdentity(game);
  const keys = new Set([
    levelKeys.game(game.shop, game.objectId),
    levelKeys.game(catalogueGame.shop, catalogueGame.objectId),
  ]);

  await playLaterSublevel.batch(
    [...keys].map((key) => ({ type: "del" as const, key }))
  );
};
