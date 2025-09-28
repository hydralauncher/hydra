import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

const updateGameCustomAssets = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  title: string,
  customIconUrl?: string | null,
  customLogoImageUrl?: string | null,
  customHeroImageUrl?: string | null
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const existingGame = await gamesSublevel.get(gameKey);
  if (!existingGame) {
    throw new Error("Game not found");
  }

  const updatedGame = {
    ...existingGame,
    title,
    ...(customIconUrl !== undefined && { customIconUrl }),
    ...(customLogoImageUrl !== undefined && { customLogoImageUrl }),
    ...(customHeroImageUrl !== undefined && { customHeroImageUrl }),
  };

  await gamesSublevel.put(gameKey, updatedGame);

  // Also update the shop assets for non-custom games
  const existingAssets = await gamesShopAssetsSublevel.get(gameKey);
  if (existingAssets) {
    const updatedAssets = {
      ...existingAssets,
      title, // Update the title in shop assets as well
    };

    await gamesShopAssetsSublevel.put(gameKey, updatedAssets);
  }

  return updatedGame;
};

registerEvent("updateGameCustomAssets", updateGameCustomAssets);
