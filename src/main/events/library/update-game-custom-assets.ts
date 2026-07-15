import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import {
  WindowManager,
  logger,
  uploadCustomArtwork,
  deleteCustomArtwork,
} from "@main/services";
import type { ArtworkAssetType, GameShop, Game } from "@types";
import fs from "node:fs";

type CustomAssetField =
  | "customIconUrl"
  | "customLogoImageUrl"
  | "customHeroImageUrl"
  | "customCoverImageUrl";

const ASSET_CLOUD_SYNC_FIELDS = [
  { field: "customIconUrl", type: "icon" },
  { field: "customLogoImageUrl", type: "logo" },
  { field: "customHeroImageUrl", type: "hero" },
  { field: "customCoverImageUrl", type: "grid" },
] as const satisfies ReadonlyArray<{
  field: CustomAssetField;
  type: ArtworkAssetType;
}>;

const collectOldAssetPaths = (
  existingGame: Game,
  customIconUrl?: string | null,
  customLogoImageUrl?: string | null,
  customHeroImageUrl?: string | null,
  customCoverImageUrl?: string | null
): string[] => {
  const oldAssetPaths: string[] = [];

  const assetPairs = [
    { existing: existingGame.customIconUrl, new: customIconUrl },
    { existing: existingGame.customLogoImageUrl, new: customLogoImageUrl },
    { existing: existingGame.customHeroImageUrl, new: customHeroImageUrl },
    { existing: existingGame.customCoverImageUrl, new: customCoverImageUrl },
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

interface UpdateGameDataParams {
  gameKey: string;
  existingGame: Game;
  title: string;
  customIconUrl?: string | null;
  customLogoImageUrl?: string | null;
  customHeroImageUrl?: string | null;
  customCoverImageUrl?: string | null;
  customOriginalIconPath?: string | null;
  customOriginalLogoPath?: string | null;
  customOriginalHeroPath?: string | null;
  customOriginalCoverPath?: string | null;
}

const updateGameData = async (params: UpdateGameDataParams): Promise<Game> => {
  const {
    gameKey,
    existingGame,
    title,
    customIconUrl,
    customLogoImageUrl,
    customHeroImageUrl,
    customCoverImageUrl,
    customOriginalIconPath,
    customOriginalLogoPath,
    customOriginalHeroPath,
    customOriginalCoverPath,
  } = params;
  const updatedGame = {
    ...existingGame,
    title,
    ...(customIconUrl !== undefined && { customIconUrl }),
    ...(customLogoImageUrl !== undefined && { customLogoImageUrl }),
    ...(customHeroImageUrl !== undefined && { customHeroImageUrl }),
    ...(customCoverImageUrl !== undefined && { customCoverImageUrl }),
    ...(customOriginalIconPath !== undefined && { customOriginalIconPath }),
    ...(customOriginalLogoPath !== undefined && { customOriginalLogoPath }),
    ...(customOriginalHeroPath !== undefined && { customOriginalHeroPath }),
    ...(customOriginalCoverPath !== undefined && { customOriginalCoverPath }),
  };

  await gamesSublevel.put(gameKey, updatedGame);
  return updatedGame;
};

const updateShopAssets = async (
  gameKey: string,
  title: string
): Promise<void> => {
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

interface UpdateGameCustomAssetsParams {
  shop: GameShop;
  objectId: string;
  title: string;
  customIconUrl?: string | null;
  customLogoImageUrl?: string | null;
  customHeroImageUrl?: string | null;
  customCoverImageUrl?: string | null;
  customOriginalIconPath?: string | null;
  customOriginalLogoPath?: string | null;
  customOriginalHeroPath?: string | null;
  customOriginalCoverPath?: string | null;
}

const syncCustomAssetsToCloud = (
  shop: GameShop,
  objectId: string,
  existingGame: Game,
  params: UpdateGameCustomAssetsParams
): void => {
  for (const { field, type } of ASSET_CLOUD_SYNC_FIELDS) {
    const newValue = params[field];
    if (newValue === undefined || newValue === existingGame[field]) continue;

    if (newValue === null) {
      if (existingGame[field]) {
        deleteCustomArtwork(shop, objectId, type).catch(() => {});
      }
    } else if (newValue.startsWith("local:")) {
      uploadCustomArtwork(shop, objectId, type, newValue).catch(() => {});
    }
  }
};

const updateGameCustomAssets = async (
  _event: Electron.IpcMainInvokeEvent,
  params: UpdateGameCustomAssetsParams
) => {
  const {
    shop,
    objectId,
    title,
    customIconUrl,
    customLogoImageUrl,
    customHeroImageUrl,
    customCoverImageUrl,
    customOriginalIconPath,
    customOriginalLogoPath,
    customOriginalHeroPath,
    customOriginalCoverPath,
  } = params;
  const gameKey = levelKeys.game(shop, objectId);

  const existingGame = await gamesSublevel.get(gameKey);
  if (!existingGame) {
    throw new Error("Game not found");
  }

  const oldAssetPaths = collectOldAssetPaths(
    existingGame,
    customIconUrl,
    customLogoImageUrl,
    customHeroImageUrl,
    customCoverImageUrl
  );

  const updatedGame = await updateGameData({
    gameKey,
    existingGame,
    title,
    customIconUrl,
    customLogoImageUrl,
    customHeroImageUrl,
    customCoverImageUrl,
    customOriginalIconPath,
    customOriginalLogoPath,
    customOriginalHeroPath,
    customOriginalCoverPath,
  });

  await updateShopAssets(gameKey, title);

  await deleteOldAssetFiles(oldAssetPaths);

  WindowManager.sendToAppWindows("on-library-batch-complete");

  syncCustomAssetsToCloud(shop, objectId, existingGame, params);

  return updatedGame;
};

registerEvent("updateGameCustomAssets", updateGameCustomAssets);
