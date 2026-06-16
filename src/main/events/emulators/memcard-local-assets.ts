import { normalizeSku } from "@main/services/emulators";
import type { LaunchboxShopDetailsAssetsResponse } from "@main/services/emulators";
import { gamesShopAssetsSublevel, gamesShopCacheSublevel } from "@main/level";

/**
 * Build a sku → assets index from games already in the local Hydra library.
 *
 * The remote shop-details endpoint occasionally misses a serial the user has
 * already imported (its art is cached locally from a prior ROM scan), so memory
 * card scans fall back to this index before marking a save unmatched. Shared by
 * the PS1 and PS2 scanners. Lives in the events layer because it joins the level
 * sublevels with the emulators service — keeping it out of `@main/services`
 * avoids a services↔level import cycle.
 */
export const buildLocalLaunchboxAssetIndex = async (): Promise<
  Map<string, LaunchboxShopDetailsAssetsResponse>
> => {
  const index = new Map<string, LaunchboxShopDetailsAssetsResponse>();

  // sku → objectId, from cached LaunchBox shop-details.
  const skuToObjectId = new Map<string, string>();
  for (const [key, details] of await gamesShopCacheSublevel.iterator().all()) {
    if (!key.startsWith("launchbox:") || !details?.objectId || !details.skus) {
      continue;
    }
    for (const sku of details.skus) {
      skuToObjectId.set(normalizeSku(sku), details.objectId);
    }
  }
  if (skuToObjectId.size === 0) return index;

  // objectId → cached assets.
  const assetsByObjectId = new Map(
    (await gamesShopAssetsSublevel.iterator().all())
      .filter(
        ([key, assets]) => key.startsWith("launchbox:") && assets?.objectId
      )
      .map(([, assets]) => [assets.objectId, assets] as const)
  );

  for (const [normSku, objectId] of skuToObjectId) {
    const assets = assetsByObjectId.get(objectId);
    if (!assets) continue;
    index.set(normSku, {
      objectId,
      shop: "launchbox",
      title: assets.title,
      iconUrl: assets.iconUrl,
      libraryImageUrl: assets.libraryImageUrl,
      libraryHeroImageUrl: assets.libraryHeroImageUrl,
      logoImageUrl: assets.logoImageUrl,
    });
  }
  return index;
};
