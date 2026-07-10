import { registerEvent } from "../register-event";
import { HydraApi, logger } from "@main/services";
import {
  gamesSublevel,
  gamesShopAssetsSublevel,
  gamesSgdbSelectionSublevel,
  gamesSgdbVariantsCacheSublevel,
  levelKeys,
} from "@main/level";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import type { GameShop, Game } from "@types";
import fs from "node:fs";

const collectAssetPathsToDelete = (game: Game): string[] => {
  const assetPathsToDelete: string[] = [];

  const assetUrls =
    game.shop === "custom"
      ? [game.iconUrl, game.logoImageUrl, game.libraryHeroImageUrl]
      : [
          game.customIconUrl,
          game.customLogoImageUrl,
          game.customHeroImageUrl,
          game.customCoverImageUrl,
        ];

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
    ...updateGameExecutablePath(game, null),
    isDeleted: true,
    ...(game.shop !== "custom" && {
      customIconUrl: null,
      customLogoImageUrl: null,
      customHeroImageUrl: null,
      customCoverImageUrl: null,
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

const cleanupSteamGridDb = async (gameKey: string): Promise<string[]> => {
  const selection = await gamesSgdbSelectionSublevel.get(gameKey);

  const cachedPaths: string[] = [];
  if (selection) {
    for (const asset of Object.values(selection.selected ?? {})) {
      if (asset?.url?.startsWith("local:")) {
        cachedPaths.push(asset.url.replace("local:", ""));
      }
    }
  }

  await gamesSgdbSelectionSublevel.del(gameKey).catch(() => {});
  await gamesSgdbVariantsCacheSublevel.del(gameKey).catch(() => {});

  return cachedPaths;
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

  const sgdbCachePaths = await cleanupSteamGridDb(gameKey);

  if (game.remoteId) {
    HydraApi.delete(`/profile/games/${game.remoteId}`).catch(() => {});
  }

  await deleteAssetFiles([...assetPathsToDelete, ...sgdbCachePaths]);
};

registerEvent("removeGameFromLibrary", removeGameFromLibrary);
