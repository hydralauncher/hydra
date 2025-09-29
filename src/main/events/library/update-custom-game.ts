import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

const updateCustomGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  title: string,
  iconUrl?: string,
  logoImageUrl?: string,
  libraryHeroImageUrl?: string
) => {
  const gameKey = levelKeys.game(shop, objectId);

  const existingGame = await gamesSublevel.get(gameKey);
  if (!existingGame) {
    throw new Error("Game not found");
  }

  const oldAssetPaths: string[] = [];

  const assetPairs = [
    { existing: existingGame.iconUrl, new: iconUrl },
    { existing: existingGame.logoImageUrl, new: logoImageUrl },
    { existing: existingGame.libraryHeroImageUrl, new: libraryHeroImageUrl },
  ];

  for (const { existing, new: newUrl } of assetPairs) {
    if (existing?.startsWith("local:") && (!newUrl || existing !== newUrl)) {
      oldAssetPaths.push(existing.replace("local:", ""));
    }
  }

  const updatedGame = {
    ...existingGame,
    title,
    iconUrl: iconUrl || null,
    logoImageUrl: logoImageUrl || null,
    libraryHeroImageUrl: libraryHeroImageUrl || null,
  };

  await gamesSublevel.put(gameKey, updatedGame);

  const existingAssets = await gamesShopAssetsSublevel.get(gameKey);
  if (existingAssets) {
    const updatedAssets = {
      ...existingAssets,
      title,
      iconUrl: iconUrl || null,
      libraryHeroImageUrl: libraryHeroImageUrl || "",
      libraryImageUrl: iconUrl || "",
      logoImageUrl: logoImageUrl || "",
      coverImageUrl: iconUrl || "",
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
        console.warn(`Failed to delete old asset ${assetPath}:`, error);
      }
    }
  }

  return updatedGame;
};

registerEvent("updateCustomGame", updateCustomGame);
