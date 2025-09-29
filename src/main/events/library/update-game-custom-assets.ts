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

  const oldAssetPaths: string[] = [];

  const assetPairs = [
    { existing: existingGame.customIconUrl, new: customIconUrl },
    { existing: existingGame.customLogoImageUrl, new: customLogoImageUrl },
    { existing: existingGame.customHeroImageUrl, new: customHeroImageUrl },
  ];

  assetPairs.forEach(({ existing, new: newUrl }) => {
    if (
      existing &&
      newUrl !== undefined &&
      existing !== newUrl &&
      existing.startsWith("local:")
    ) {
      oldAssetPaths.push(existing.replace("local:", ""));
    }
  });

  const updatedGame = {
    ...existingGame,
    title,
    ...(customIconUrl !== undefined && { customIconUrl }),
    ...(customLogoImageUrl !== undefined && { customLogoImageUrl }),
    ...(customHeroImageUrl !== undefined && { customHeroImageUrl }),
  };

  await gamesSublevel.put(gameKey, updatedGame);

  const existingAssets = await gamesShopAssetsSublevel.get(gameKey);
  if (existingAssets) {
    const updatedAssets = {
      ...existingAssets,
      title,
    };

    await gamesShopAssetsSublevel.put(gameKey, updatedAssets);
  }

  if (oldAssetPaths.length > 0) {
    const fs = await import("fs");
    for (const assetPath of oldAssetPaths) {
      try {
        if (fs.existsSync(assetPath)) {
          await fs.promises.unlink(assetPath);
        }
      } catch (error) {
        console.warn(`Failed to delete old custom asset ${assetPath}:`, error);
      }
    }
  }

  return updatedGame;
};

registerEvent("updateGameCustomAssets", updateGameCustomAssets);
