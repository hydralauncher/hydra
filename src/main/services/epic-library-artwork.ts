import { getGameAssets } from "../events/catalogue/get-game-assets";
import {
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  levelKeys,
} from "@main/level";
import { composeAssetsWithArtwork } from "@shared";
import { WindowManager } from "./window-manager";
import { HydraApi } from "./hydra-api";
import { EpicLibraryArtworkQueue } from "./epic-library-artwork-queue";

const displayedArtwork = (
  assets:
    | {
        iconUrl?: string | null;
        coverImageUrl?: string | null;
        libraryImageUrl?: string | null;
        libraryHeroImageUrl?: string | null;
      }
    | null
    | undefined
) =>
  JSON.stringify([
    assets?.iconUrl,
    assets?.coverImageUrl,
    assets?.libraryImageUrl,
    assets?.libraryHeroImageUrl,
  ]);

export const epicLibraryArtworkQueue = new EpicLibraryArtworkQueue(
  async (game) => {
    const context = HydraApi.getAuthContext();
    if (!context) return false;
    const identity = game.catalogueGame ?? game;
    const key = levelKeys.game(identity.shop, identity.objectId);
    const before = await gamesShopAssetsSublevel.get(key);
    const selection = await gamesArtworkSelectionSublevel.get(
      levelKeys.game(game.shop, game.objectId)
    );
    const assets = await getGameAssets(identity.objectId, identity.shop, {
      artworkIdentity: { shop: game.shop, objectId: game.objectId },
    });
    return (
      HydraApi.isAuthContextCurrent(context) &&
      displayedArtwork(composeAssetsWithArtwork(before ?? null, selection)) !==
        displayedArtwork(assets)
    );
  },
  () => WindowManager.sendToAppWindows("on-library-batch-complete")
);
