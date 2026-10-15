import { getGameAssets } from "../events/catalogue/get-game-assets";
import { gamesShopAssetsSublevel, levelKeys } from "@main/level";
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
    const assets = await getGameAssets(identity.objectId, identity.shop, {
      artworkIdentity: { shop: game.shop, objectId: game.objectId },
    });
    return (
      HydraApi.isAuthContextCurrent(context) &&
      displayedArtwork(before) !== displayedArtwork(assets)
    );
  },
  () => WindowManager.sendToAppWindows("on-library-batch-complete")
);
