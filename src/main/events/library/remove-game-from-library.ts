import { registerEvent } from "../register-event";
import { HydraApi, logger } from "@main/services";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import type { GameShop, Game } from "@types";
import fs from "node:fs";

const collectAssetPathsToDelete = (game: Game): string[] => {
  const assetPathsToDelete: string[] = [];

  const assetUrls =
    game.shop === "custom"
      ? [game.iconUrl, game.logoImageUrl, game.libraryHeroImageUrl]
      : [game.customIconUrl, game.customLogoImageUrl, game.customHeroImageUrl];

  for (const url of assetUrls) {
    if (url?.startsWith("local:")) {
      assetPathsToDelete.push(url.replace("local:", ""));
    }
  }

  return assetPathsToDelete;
};

const updateGameAsDeleted = async (
  game: Game,
  gameKey: string
): Promise<void> => {
  const updatedGame = {
    ...game,
    isDeleted: true,
    executablePath: null,
    ...(game.shop !== "custom" && {
      customIconUrl: null,
      customLogoImageUrl: null,
      customHeroImageUrl: null,
    }),
  };

  await gamesSublevel.put(gameKey, updatedGame);
};

const resetShopAssets = async (gameKey: string): Promise<void> => {
  const existingAssets = await gamesShopAssetsSublevel.get(gameKey);
  if (existingAssets) {
    const resetAssets = {
      ...existingAssets,
      title: existingAssets.title,
    };
    await gamesShopAssetsSublevel.put(gameKey, resetAssets);
  }
};

const deleteAssetFiles = async (
  assetPathsToDelete: string[]
): Promise<void> => {
  if (assetPathsToDelete.length === 0) return;

  for (const assetPath of assetPathsToDelete) {
    try {
      if (fs.existsSync(assetPath)) {
        await fs.promises.unlink(assetPath);
      }
    } catch (error) {
      logger.warn(`Failed to delete asset ${assetPath}:`, error);
    }
  }
};

const removeGameFromLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  const assetPathsToDelete = collectAssetPathsToDelete(game);

  await updateGameAsDeleted(game, gameKey);

  if (game.shop !== "custom") {
    await resetShopAssets(gameKey);
  }

  if (game?.remoteId) {
    HydraApi.delete(`/profile/games/${game.remoteId}`).catch(() => {});
  }

  await deleteAssetFiles(assetPathsToDelete);
};

registerEvent("removeGameFromLibrary", removeGameFromLibrary);
