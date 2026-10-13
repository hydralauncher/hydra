import type {
  ArtworkItem,
  ArtworkKind,
  ArtworkPage,
  GameShop,
  ShopAssets,
} from "@types";
import {
  composeEpicDefaultArtworkPages,
  preserveEpicDefaultArtwork,
} from "@shared";

import { HydraApi } from "./hydra-api";

export const ARTWORK_PAGE_SIZE = 50;

const PORTRAIT_GRID_DIMENSIONS = "600x900,342x482,660x930";
const LANDSCAPE_GRID_DIMENSIONS = "460x215,920x430";
export const EPIC_ARTWORK_CACHE_DURATION_MS = 8 * 60 * 60 * 1000;
const EPIC_DEFAULT_ARTWORK_TIMEOUT_MS = 5_000;
const EPIC_DEFAULT_ARTWORK_LIMIT = 10;
type EpicArtworkType = keyof NonNullable<
  ShopAssets["epicArtworkUpdatedAtByType"]
>;
const epicArtworkRequests = new Map<
  string,
  Promise<Partial<Record<EpicArtworkType, ArtworkPage>>>
>();

const KIND_PARAMS: Record<ArtworkKind, Record<string, string>> = {
  grids: {
    nsfw: "false",
    dimensions: PORTRAIT_GRID_DIMENSIONS,
    mimes: "image/png,image/jpeg,image/webp",
  },
  heroes: { nsfw: "false", mimes: "image/png,image/jpeg,image/webp" },
  logos: { nsfw: "false", mimes: "image/png,image/webp" },
  icons: { nsfw: "false", mimes: "image/png,image/vnd.microsoft.icon" },
};

interface ArtworkResponse {
  success: boolean;
  data: ArtworkItem[];
}

const emptyPage = (): ArtworkPage => ({
  items: [],
  cache: "fresh",
  hasMore: false,
});

export const fetchGameArtwork = async (
  shop: GameShop,
  objectId: string,
  kind: ArtworkKind,
  page = 0,
  parameters: Record<string, string> = {},
  timeout?: number
): Promise<ArtworkPage> => {
  const response = await HydraApi.getResponse<ArtworkResponse>(
    `/games/${shop}/${objectId}/artwork/${kind}`,
    { ...KIND_PARAMS[kind], limit: ARTWORK_PAGE_SIZE, page, ...parameters },
    {
      ...(timeout !== undefined && {
        timeout,
        signal: AbortSignal.timeout(timeout),
      }),
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 404,
    }
  );

  if (response.status === 404) return emptyPage();
  if (
    timeout !== undefined &&
    (response.data?.success !== true || !Array.isArray(response.data.data))
  ) {
    throw new Error("Invalid Epic default artwork response");
  }

  const items = response.data?.data ?? [];

  return {
    items,
    cache: response.headers["x-hydra-cache"] === "stale" ? "stale" : "fresh",
    hasMore: items.length === ARTWORK_PAGE_SIZE,
  };
};

export async function resolveEpicDefaultArtwork(
  assets: ShopAssets,
  cached?: ShopAssets | null
): Promise<ShopAssets> {
  if (assets.shop !== "epic") return assets;
  const preserved = preserveEpicDefaultArtwork(assets, cached);
  const now = Date.now();
  const isFresh = (type: EpicArtworkType) => {
    const timestamp = cached?.epicArtworkUpdatedAtByType?.[type];
    return (
      timestamp !== undefined &&
      timestamp <= now &&
      timestamp + EPIC_ARTWORK_CACHE_DURATION_MS > now
    );
  };
  if (
    ["icon", "portrait", "landscape"].every((type) =>
      isFresh(type as EpicArtworkType)
    )
  )
    return preserved;
  let pending = epicArtworkRequests.get(assets.objectId);
  if (!pending) {
    const defaults: Array<{
      type: EpicArtworkType;
      kind: ArtworkKind;
      parameters: Record<string, string>;
    }> = [
      {
        type: "icon",
        kind: "icons",
        parameters: { dimensions: "32,48,64,96,128" },
      },
      {
        type: "portrait",
        kind: "grids",
        parameters: { dimensions: PORTRAIT_GRID_DIMENSIONS, styles: "no_logo" },
      },
      {
        type: "landscape",
        kind: "grids",
        parameters: {
          dimensions: LANDSCAPE_GRID_DIMENSIONS,
          styles: "no_logo",
        },
      },
    ];
    const missing = defaults.filter(({ type }) => !isFresh(type));
    pending = Promise.allSettled(
      missing.map(({ kind, parameters }) =>
        fetchGameArtwork(
          "epic",
          assets.objectId,
          kind,
          0,
          {
            types: "static",
            limit: String(EPIC_DEFAULT_ARTWORK_LIMIT),
            humor: "false",
            epilepsy: "false",
            ...parameters,
          },
          EPIC_DEFAULT_ARTWORK_TIMEOUT_MS
        )
      )
    )
      .then((responses) => {
        const pages: Partial<Record<EpicArtworkType, ArtworkPage>> = {};
        responses.forEach((response, index) => {
          if (response.status === "fulfilled")
            pages[missing[index].type] = response.value;
        });
        return pages;
      })
      .finally(() => epicArtworkRequests.delete(assets.objectId));
    epicArtworkRequests.set(assets.objectId, pending);
  }
  const pages = await pending;
  return composeEpicDefaultArtworkPages(
    preserved,
    {
      ...(pages.icon && { icon: pages.icon.items }),
      ...(pages.portrait && { portrait: pages.portrait.items }),
      ...(pages.landscape && { landscape: pages.landscape.items }),
    },
    Date.now()
  );
}
