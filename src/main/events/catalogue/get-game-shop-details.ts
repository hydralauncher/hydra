import { getEpicStoreDetails } from "@main/services/epic-store-details";
import {
  getSteamAppDetails,
  getSteamLanguage,
  HydraApi,
  logger,
} from "@main/services";

import type {
  CatalogueGameIdentity,
  GameArtworkOptions,
  ShopDetails,
  GameShop,
  ShopAssets,
  ShopDetailsWithAssets,
} from "@types";

import { registerEvent } from "../register-event";
import {
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  levelKeys,
} from "@main/level";
import { composeAssetsWithArtwork } from "@shared";
import {
  getStoreDetailsWithFallback,
  formatEpicDescription,
  mapEpicShopDetails,
  STORE_DETAILS_TIMEOUT_MS,
  type EpicShopDetails,
  sanitizeEpicHtml,
} from "@main/services/store-shop-details";
import { resolveEpicDefaultArtwork } from "@main/services/game-artwork";

const applyArtworkToAssets = async (
  shop: GameShop,
  objectId: string,
  assets: ShopAssets | null,
  artworkIdentity?: CatalogueGameIdentity
): Promise<ShopAssets | null> => {
  if (!assets) return assets;
  if (shop === "epic") {
    const key = levelKeys.game(shop, objectId);
    assets = await resolveEpicDefaultArtwork(
      assets,
      await gamesShopAssetsSublevel.get(key)
    );
    await gamesShopAssetsSublevel.put(key, {
      ...assets,
      updatedAt: Date.now(),
    });
  }

  const selectedIdentity = artworkIdentity ?? { shop, objectId };
  const selection = await gamesArtworkSelectionSublevel.get(
    levelKeys.game(selectedIdentity.shop, selectedIdentity.objectId)
  );

  return composeAssetsWithArtwork(assets, selection);
};

interface LaunchboxBasic {
  objectId: string;
  title: string;
  iconUrl: string | null;
  libraryHeroImageUrl: string | null;
  libraryImageUrl: string | null;
  logoImageUrl: string | null;
  logoPosition: string | null;
  coverImageUrl: string | null;
  releaseDate: string | null;
  releaseYear: number | null;
  retroAchievementsGameId: number | null;
}

interface LaunchboxShopDetailsAssets {
  objectId: string;
  shop: GameShop;
  title: string;
  iconUrl: string | null;
  libraryHeroImageUrl: string | null;
  libraryImageUrl: string | null;
  logoImageUrl: string | null;
}

interface LaunchboxShopDetailsData {
  title: string;
  platform?: string | null;
  description: string | null;
  releaseDate: string | null;
  developers: string[];
  publishers: string[];
  genres: string[];
  headerImage: string | null;
  website: string | null;
  screenshots: string[];
  assets: LaunchboxShopDetailsAssets | null;
}

interface LaunchboxShopDetailsEntry {
  objectId: string;
  shop: GameShop;
  platform?: string | null;
  skus?: string[];
  data: LaunchboxShopDetailsData;
}

const mapLaunchboxToShopDetails = (
  objectId: string,
  basic: LaunchboxBasic | null,
  entry: LaunchboxShopDetailsEntry | null,
  cached: ShopDetailsWithAssets | null,
  language: string
): ShopDetails => {
  const data = entry?.data ?? null;
  const description = data?.description ?? "";

  return {
    objectId,
    descriptionLanguage: data ? language : undefined,
    name: data?.title ?? basic?.title ?? "",
    platform: entry?.platform ?? data?.platform ?? undefined,
    skus: entry?.skus ?? undefined,
    retroAchievementsGameId:
      basic?.retroAchievementsGameId ?? cached?.retroAchievementsGameId ?? null,
    steam_appid: 0,
    detailed_description: description,
    about_the_game: description,
    short_description: "",
    developers: data?.developers ?? [],
    publishers: data?.publishers ?? [],
    genres: (data?.genres ?? []).map((name, index) => ({
      id: String(index),
      name,
    })),
    movies: undefined,
    supported_languages: "",
    screenshots: (data?.screenshots ?? []).map((url, index) => ({
      id: index,
      path_thumbnail: url,
      path_full: url,
    })),
    pc_requirements: { minimum: "", recommended: "" },
    mac_requirements: { minimum: "", recommended: "" },
    linux_requirements: { minimum: "", recommended: "" },
    release_date: {
      coming_soon: false,
      date: data?.releaseDate ?? basic?.releaseDate ?? "",
    },
    content_descriptors: { ids: [] },
  };
};

const getLaunchboxShopDetails = async (
  objectId: string,
  shop: GameShop,
  language: string
): Promise<ShopDetailsWithAssets | null> => {
  const [cachedData, cachedAssets] = await Promise.all([
    gamesShopCacheSublevel.get(
      levelKeys.gameShopCacheItem(shop, objectId, language)
    ),
    gamesShopAssetsSublevel.get(levelKeys.game(shop, objectId)),
  ]);

  const cacheHasNewFields =
    cachedData &&
    (cachedData.platform || cachedData.skus) &&
    typeof cachedData.retroAchievementsGameId === "number" &&
    cachedData.descriptionLanguage === language;
  if (cachedData && cacheHasNewFields) {
    return { ...cachedData, assets: cachedAssets ?? null };
  }

  const [basic, detailsResponse] = await Promise.all([
    HydraApi.get<LaunchboxBasic | null>(`/games/${shop}/${objectId}`, null, {
      needsAuth: false,
    }).catch((err) => {
      logger.error("Failed to fetch launchbox basic game info", err);
      return null;
    }),
    HydraApi.post<LaunchboxShopDetailsEntry[]>(
      `/games/shop-details`,
      { shop, objectIds: [objectId], language },
      { needsAuth: false }
    ).catch((err) => {
      logger.error("Failed to fetch launchbox shop details", err);
      return [] as LaunchboxShopDetailsEntry[];
    }),
  ]);

  const detailsEntry = Array.isArray(detailsResponse)
    ? (detailsResponse.find((entry) => entry.objectId === objectId) ?? null)
    : null;
  const data = detailsEntry?.data ?? null;

  if (!data && !basic) return null;

  const mapped = mapLaunchboxToShopDetails(
    objectId,
    basic,
    detailsEntry,
    cachedData ? { ...cachedData, assets: cachedAssets ?? null } : null,
    language
  );

  gamesShopCacheSublevel
    .put(levelKeys.gameShopCacheItem(shop, objectId, language), mapped)
    .catch((err) => {
      logger.error("Could not cache launchbox game details", err);
    });

  const assets: ShopAssets | null =
    data?.assets || basic
      ? {
          objectId,
          shop,
          title: data?.assets?.title ?? basic?.title ?? mapped.name,
          iconUrl: data?.assets?.iconUrl ?? basic?.iconUrl ?? null,
          libraryHeroImageUrl:
            data?.assets?.libraryHeroImageUrl ??
            basic?.libraryHeroImageUrl ??
            null,
          libraryImageUrl:
            data?.assets?.libraryImageUrl ?? basic?.libraryImageUrl ?? null,
          logoImageUrl:
            data?.assets?.logoImageUrl ?? basic?.logoImageUrl ?? null,
          logoPosition: basic?.logoPosition ?? null,
          coverImageUrl: basic?.coverImageUrl ?? null,
          downloadSources: [],
        }
      : (cachedAssets ?? null);

  if (assets) {
    gamesShopAssetsSublevel
      .put(levelKeys.game(shop, objectId), {
        ...assets,
        updatedAt: Date.now(),
      })
      .catch((err) => {
        logger.error("Could not cache launchbox assets", err);
      });
  }

  return { ...mapped, assets };
};

const getGameShopDetails = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  language: string,
  options?: GameArtworkOptions
): Promise<ShopDetailsWithAssets | null> => {
  if (shop === "custom") return null;

  if (shop === "launchbox") {
    const details = await getLaunchboxShopDetails(objectId, shop, language);
    if (!details) return details;

    return {
      ...details,
      assets: await applyArtworkToAssets(
        shop,
        objectId,
        details.assets,
        options?.artworkIdentity
      ),
    };
  }

  if (shop === "steam") {
    const steamLanguage = getSteamLanguage(language);

    const [cachedData, cachedAssets] = await Promise.all([
      gamesShopCacheSublevel.get(
        levelKeys.gameShopCacheItem(shop, objectId, steamLanguage)
      ),
      gamesShopAssetsSublevel.get(levelKeys.game(shop, objectId)),
    ]);

    const appDetails = getSteamAppDetails(objectId, language).then((result) => {
      if (result) {
        result.name = cachedAssets?.title ?? result.name;

        gamesShopCacheSublevel
          .put(
            levelKeys.gameShopCacheItem(shop, objectId, steamLanguage),
            result
          )
          .catch((err) => {
            logger.error("Could not cache game details", err);
          });

        return {
          ...result,
          assets: cachedAssets ?? null,
        };
      }

      return null;
    });

    const details = cachedData
      ? { ...cachedData, assets: cachedAssets ?? null }
      : await appDetails;

    if (!details) return details;

    return {
      ...details,
      assets: await applyArtworkToAssets(
        shop,
        objectId,
        details.assets,
        options?.artworkIdentity
      ),
    };
  }

  if (shop === "epic") {
    const cacheLanguage = language;
    const path = `/games/${shop}/${encodeURIComponent(objectId)}/shop-details`;
    const [cachedData, cachedAssets] = await Promise.all([
      gamesShopCacheSublevel.get(
        levelKeys.gameShopCacheItem(shop, objectId, cacheLanguage)
      ),
      gamesShopAssetsSublevel.get(levelKeys.game(shop, objectId)),
    ]);

    const appDetails = (async () => {
      const details = await getStoreDetailsWithFallback<ShopDetailsWithAssets>(
        async () => {
          const data = await getEpicStoreDetails(objectId, language).catch(
            (error) => {
              logger.error("Could not fetch Epic store details", error);
              return null;
            }
          );
          const result = data
            ? mapEpicShopDetails(objectId, data, language)
            : null;
          if (!result) return null;
          return {
            ...result,
            name: result.name,
            assets: result.assets ?? cachedAssets ?? null,
          };
        },
        async () => {
          const data = await HydraApi.get<EpicShopDetails | null>(
            path,
            { language },
            {
              needsAuth: false,
              signal: AbortSignal.timeout(STORE_DETAILS_TIMEOUT_MS),
            }
          );
          if (!data) return null;
          return mapEpicShopDetails(objectId, data, language);
        },
        null
      );

      if (!details) return details;

      const { assets: freshAssets, ...payload } = details;
      let assets = freshAssets
        ? {
            ...freshAssets,
            coverImageUrl:
              freshAssets.coverImageUrl ?? cachedAssets?.coverImageUrl ?? null,
            iconUrl: freshAssets.iconUrl ?? cachedAssets?.iconUrl ?? null,
            libraryImageUrl:
              freshAssets.libraryImageUrl ??
              cachedAssets?.libraryImageUrl ??
              null,
            libraryHeroImageUrl:
              freshAssets.libraryHeroImageUrl ??
              cachedAssets?.libraryHeroImageUrl ??
              null,
            logoImageUrl:
              freshAssets.logoImageUrl ?? cachedAssets?.logoImageUrl ?? null,
            logoPosition:
              cachedAssets?.logoPosition ?? freshAssets.logoPosition,
            downloadSources:
              cachedAssets?.downloadSources ?? freshAssets.downloadSources,
          }
        : (cachedAssets ?? null);
      if (assets)
        assets = await resolveEpicDefaultArtwork(assets, cachedAssets);
      gamesShopCacheSublevel
        .put(
          levelKeys.gameShopCacheItem(shop, objectId, cacheLanguage),
          payload
        )
        .catch((error) => logger.error("Could not cache game details", error));
      if (assets)
        gamesShopAssetsSublevel
          .put(levelKeys.game(shop, objectId), {
            ...assets,
            updatedAt: Date.now(),
          })
          .catch((error) => logger.error("Could not cache game assets", error));

      return {
        ...details,
        assets,
      };
    })();
    const selected = cachedData
      ? { ...cachedData, assets: cachedAssets ?? null }
      : await appDetails;
    if (!selected) return null;
    return {
      ...selected,
      detailed_description: formatEpicDescription(
        selected.detailed_description
      ),
      about_the_game: formatEpicDescription(selected.about_the_game),
      short_description: sanitizeEpicHtml(selected.short_description),
      assets: await applyArtworkToAssets(
        shop,
        objectId,
        selected.assets,
        options?.artworkIdentity
      ),
    };
  }

  throw new Error("Not implemented");
};

registerEvent("getGameShopDetails", getGameShopDetails);
