import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { ASSETS_PATH } from "@main/constants";

const getCustomGamesAssetsPath = () => {
  return path.join(ASSETS_PATH, "custom-games");
};

const getAllCustomGameAssets = async (): Promise<string[]> => {
  const assetsPath = getCustomGamesAssetsPath();

  if (!fs.existsSync(assetsPath)) {
    return [];
  }

  const files = await fs.promises.readdir(assetsPath);
  return files.map((file) => path.join(assetsPath, file));
};

const getUsedAssetPaths = async (): Promise<Set<string>> => {
  const { gamesSublevel } = await import("@main/level");
  const allGames = await gamesSublevel.iterator().all();

  const customGames = allGames
    .map(([_key, game]) => game)
    .filter((game) => game.shop === "custom" && !game.isDeleted);

  const usedPaths = new Set<string>();

  customGames.forEach((game) => {
    if (game.iconUrl?.startsWith("local:")) {
      usedPaths.add(game.iconUrl.replace("local:", ""));
    }
    if (game.logoImageUrl?.startsWith("local:")) {
      usedPaths.add(game.logoImageUrl.replace("local:", ""));
    }
    if (game.libraryHeroImageUrl?.startsWith("local:")) {
      usedPaths.add(game.libraryHeroImageUrl.replace("local:", ""));
    }
  });

  return usedPaths;
};

export const cleanupUnusedAssets = async (): Promise<{
  deletedCount: number;
  errors: string[];
}> => {
  try {
    const allAssets = await getAllCustomGameAssets();
    const usedAssets = await getUsedAssetPaths();

    const errors: string[] = [];
    let deletedCount = 0;

    for (const assetPath of allAssets) {
      if (!usedAssets.has(assetPath)) {
        try {
          await fs.promises.unlink(assetPath);
          deletedCount++;
        } catch (error) {
          errors.push(`Failed to delete ${assetPath}: ${error}`);
        }
      }
    }

    return { deletedCount, errors };
  } catch (error) {
    throw new Error(`Failed to cleanup unused assets: ${error}`);
  }
};

ipcMain.handle("cleanupUnusedAssets", cleanupUnusedAssets);
