import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import type { GameShop, Game } from "@types";
import fs from "node:fs";
import { logger } from "@main/services";

const collectOldAssetPaths = (
  existingGame: Game,
  customIconUrl?: string | null,
  customLogoImageUrl?: string | null,
  customHeroImageUrl?: string | null
): string[] => {
  const oldAssetPaths: string[] = [];

  const assetPairs = [
    { existing: existingGame.customIconUrl, new: customIconUrl },
    { existing: existingGame.customLogoImageUrl, new: customLogoImageUrl },
    { existing: existingGame.customHeroImageUrl, new: customHeroImageUrl },
  ];

  for (const { existing, new: newUrl } of assetPairs) {
    if (
      existing &&
      newUrl !== undefined &&
      existing !== newUrl &&
      existing.startsWith("local:")
    ) {
      oldAssetPaths.push(existing.replace("local:", ""));
    }
  }

  return oldAssetPaths;
};

const updateGameData = async (
  gameKey: string,
  existingGame: Game,
  title: string,
  customIconUrl?: string | null,
  customLogoImageUrl?: string | null,
  customHeroImageUrl?: string | null
): Promise<Game> => {
  const updatedGame = {
    ...existingGame,
    title,
    ...(customIconUrl !== undefined && { customIconUrl }),
    ...(customLogoImageUrl !== undefined && { customLogoImageUrl }),
    ...(customHeroImageUrl !== undefined && { customHeroImageUrl }),
  };

  await gamesSublevel.put(gameKey, updatedGame);
  return updatedGame;
};

const updateShopAssets = async (gameKey: string, title: string): Promise<void> => {
  const existingAssets = await gamesShopAssetsSublevel.get(gameKey);
  if (existingAssets) {
    const updatedAssets = {
      ...existingAssets,
      title,
    };
    await gamesShopAssetsSublevel.put(gameKey, updatedAssets);
  }
};

const deleteOldAssetFiles = async (oldAssetPaths: string[]): Promise<void> => {
  if (oldAssetPaths.length === 0) return;

  for (const assetPath of oldAssetPaths) {
    try {
      if (fs.existsSync(assetPath)) {
        await fs.promises.unlink(assetPath);
      }
    } catch (error) {
      logger.warn(`Failed to delete old custom asset ${assetPath}:`, error);
    }
  }
};

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

  const oldAssetPaths = collectOldAssetPaths(
    existingGame,
    customIconUrl,
    customLogoImageUrl,
    customHeroImageUrl
  );

  const updatedGame = await updateGameData(
    gameKey,
    existingGame,
    title,
    customIconUrl,
    customLogoImageUrl,
    customHeroImageUrl
  );

  await updateShopAssets(gameKey, title);

  await deleteOldAssetFiles(oldAssetPaths);

  return updatedGame;
};

registerEvent("updateGameCustomAssets", updateGameCustomAssets);
