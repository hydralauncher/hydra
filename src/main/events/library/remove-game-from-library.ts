import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";

const removeGameFromLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (game) {
    // Collect asset paths that need to be cleaned up before marking as deleted
    const assetPathsToDelete: string[] = [];

    const assetUrls =
      game.shop === "custom"
        ? [game.iconUrl, game.logoImageUrl, game.libraryHeroImageUrl]
        : [
            game.customIconUrl,
            game.customLogoImageUrl,
            game.customHeroImageUrl,
          ];

    assetUrls.forEach((url) => {
      if (url?.startsWith("local:")) {
        assetPathsToDelete.push(url.replace("local:", ""));
      }
    });

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

    if (game.shop !== "custom") {
      const existingAssets = await gamesShopAssetsSublevel.get(gameKey);
      if (existingAssets) {
        const resetAssets = {
          ...existingAssets,
          title: existingAssets.title,
        };
        await gamesShopAssetsSublevel.put(gameKey, resetAssets);
      }
    }

    if (game?.remoteId) {
      HydraApi.delete(`/profile/games/${game.remoteId}`).catch(() => {});
    }

    if (assetPathsToDelete.length > 0) {
      const fs = await import("fs");
      for (const assetPath of assetPathsToDelete) {
        try {
          if (fs.existsSync(assetPath)) {
            await fs.promises.unlink(assetPath);
          }
        } catch (error) {
          console.warn(`Failed to delete asset ${assetPath}:`, error);
        }
      }
    }
  }
};

registerEvent("removeGameFromLibrary", removeGameFromLibrary);
