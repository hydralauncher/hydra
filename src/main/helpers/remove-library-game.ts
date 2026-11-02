import { HydraApi, logger } from "@main/services";
import {
  gamesSublevel,
  gamesShopAssetsSublevel,
  gamesArtworkSelectionSublevel,
  levelKeys,
} from "@main/level";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import type { GameShop, Game } from "@types";
import {
  isClassicsGameForEmulator,
  type ClassicsEmulatorTarget,
} from "@shared";
import fs from "node:fs";
import { groupedSouvenirWorker } from "@main/services/achievements/grouped-souvenir-worker";

const collectAssetPathsToDelete = (game: Game): string[] => {
  const assetPathsToDelete: string[] = [];

  const assetUrls =
    game.shop === "custom"
      ? [
          game.iconUrl,
          game.logoImageUrl,
          game.libraryHeroImageUrl,
          game.customCoverImageUrl,
        ]
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

const deleteAssetFiles = async (
  assetPathsToDelete: string[]
): Promise<void> => {
  if (assetPathsToDelete.length === 0) return;

  await Promise.all(
    assetPathsToDelete.map(async (assetPath) => {
      try {
        if (fs.existsSync(assetPath)) {
          await fs.promises.unlink(assetPath);
        }
      } catch (error) {
        logger.warn(`Failed to delete asset ${assetPath}:`, error);
      }
    })
  );
};

export const removeLibraryGame = async (shop: GameShop, objectId: string) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  const assetPathsToDelete = collectAssetPathsToDelete(game);

  await updateGameAsDeleted(game, gameKey);
  void groupedSouvenirWorker.trigger().catch((error) => {
    logger.warn(
      "Failed to stop souvenir synchronization for a removed game",
      error
    );
  });

  if (game.shop !== "custom") {
    await resetShopAssets(gameKey);
  }

  await gamesArtworkSelectionSublevel.del(gameKey).catch(() => {});

  if (game.remoteId) {
    HydraApi.delete(`/profile/games/${game.remoteId}`).catch(() => {});
  }

  await deleteAssetFiles(assetPathsToDelete);
};

export const removeClassicsEmulatorGames = async (
  target: ClassicsEmulatorTarget
) => {
  const games = await gamesSublevel.values().all();
  const matches = games.filter((game) =>
    isClassicsGameForEmulator(game, target)
  );

  await Promise.all(
    matches.map((game) => removeLibraryGame(game.shop, game.objectId))
  );

  return matches.length;
};
