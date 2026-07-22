import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";
import fs from "node:fs";
import { WindowManager, logger } from "@main/services";

interface UpdateCustomGameParams {
  shop: GameShop;
  objectId: string;
  title: string;
  iconUrl?: string;
  logoImageUrl?: string;
  libraryHeroImageUrl?: string;
  customCoverImageUrl?: string;
  originalIconPath?: string;
  originalLogoPath?: string;
  originalHeroPath?: string;
  customOriginalCoverPath?: string;
}

const updateCustomGame = async (
  _event: Electron.IpcMainInvokeEvent,
  params: UpdateCustomGameParams
) => {
  const {
    shop,
    objectId,
    title,
    iconUrl,
    logoImageUrl,
    libraryHeroImageUrl,
    customCoverImageUrl,
    originalIconPath,
    originalLogoPath,
    originalHeroPath,
    customOriginalCoverPath,
  } = params;
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
    { existing: existingGame.customCoverImageUrl, new: customCoverImageUrl },
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
    customCoverImageUrl: customCoverImageUrl || null,
    originalIconPath: originalIconPath || existingGame.originalIconPath || null,
    originalLogoPath: originalLogoPath || existingGame.originalLogoPath || null,
    originalHeroPath: originalHeroPath || existingGame.originalHeroPath || null,
    customOriginalCoverPath:
      customOriginalCoverPath || existingGame.customOriginalCoverPath || null,
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
      coverImageUrl: customCoverImageUrl || iconUrl || "",
    };

    await gamesShopAssetsSublevel.put(gameKey, updatedAssets);
  }

  if (oldAssetPaths.length > 0) {
    for (const assetPath of oldAssetPaths) {
      try {
        if (fs.existsSync(assetPath)) {
          await fs.promises.unlink(assetPath);
        }
      } catch (error) {
        logger.warn(`Failed to delete old asset ${assetPath}:`, error);
      }
    }
  }

  WindowManager.sendToAppWindows("on-library-batch-complete");

  return updatedGame;
};

registerEvent("updateCustomGame", updateCustomGame);
