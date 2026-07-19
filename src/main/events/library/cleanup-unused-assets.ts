import { ipcMain } from "electron";
import fs from "fs";
import path from "path";
import { ASSETS_PATH } from "@main/constants";

const getCustomGamesAssetsPath = () => {
  return path.join(ASSETS_PATH, "custom-games");
};

const readAssetDir = async (assetsPath: string): Promise<string[]> => {
  if (!fs.existsSync(assetsPath)) {
    return [];
  }

  const files = await fs.promises.readdir(assetsPath);
  return files.map((file) => path.join(assetsPath, file));
};

const toLocalPath = (url: string | null | undefined): string | null => {
  if (!url?.startsWith("local:")) return null;
  return url.replace("local:", "");
};

const getUsedCustomGamePaths = async (): Promise<Set<string>> => {
  const { gamesSublevel } = await import("@main/level");
  const allGames = await gamesSublevel.iterator().all();

  const usedPaths = new Set<string>();

  allGames
    .map(([_key, game]) => game)
    .filter((game) => !game.isDeleted)
    .forEach((game) => {
      const candidates = [
        game.iconUrl,
        game.logoImageUrl,
        game.libraryHeroImageUrl,
        game.customIconUrl,
        game.customLogoImageUrl,
        game.customHeroImageUrl,
        game.customCoverImageUrl,
      ];

      candidates.forEach((candidate) => {
        const localPath = toLocalPath(candidate);
        if (localPath) usedPaths.add(localPath);
      });
    });

  return usedPaths;
};

const sweepDir = async (
  assets: string[],
  usedPaths: Set<string>
): Promise<{ deletedCount: number; errors: string[] }> => {
  const errors: string[] = [];
  let deletedCount = 0;

  for (const assetPath of assets) {
    if (!usedPaths.has(assetPath)) {
      try {
        await fs.promises.unlink(assetPath);
        deletedCount++;
      } catch (error) {
        errors.push(`Failed to delete ${assetPath}: ${error}`);
      }
    }
  }

  return { deletedCount, errors };
};

export const cleanupUnusedAssets = async (): Promise<{
  deletedCount: number;
  errors: string[];
}> => {
  try {
    const [customAssets, usedCustomPaths] = await Promise.all([
      readAssetDir(getCustomGamesAssetsPath()),
      getUsedCustomGamePaths(),
    ]);

    return sweepDir(customAssets, usedCustomPaths);
  } catch (error) {
    throw new Error(`Failed to cleanup unused assets: ${error}`);
  }
};

ipcMain.handle("cleanupUnusedAssets", cleanupUnusedAssets);
