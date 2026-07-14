import type { ArtworkItem, ArtworkKind, ArtworkPage, GameShop } from "@types";

import { HydraApi } from "./hydra-api";

export const ARTWORK_PAGE_SIZE = 50;

const PORTRAIT_GRID_DIMENSIONS = "600x900,342x482,660x930";

const KIND_PARAMS: Record<ArtworkKind, Record<string, string>> = {
  grids: { nsfw: "false", dimensions: PORTRAIT_GRID_DIMENSIONS },
  heroes: { nsfw: "false" },
  logos: { nsfw: "false" },
  icons: { nsfw: "false" },
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
  page = 0
): Promise<ArtworkPage> => {
  const response = await HydraApi.getResponse<ArtworkResponse>(
    `/games/${shop}/${objectId}/artwork/${kind}`,
    { ...KIND_PARAMS[kind], limit: ARTWORK_PAGE_SIZE, page },
    {
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 404,
    }
  );

  if (response.status === 404) return emptyPage();

  const items = response.data?.data ?? [];

  return {
    items,
    cache: response.headers["x-hydra-cache"] === "stale" ? "stale" : "fresh",
    hasMore: items.length === ARTWORK_PAGE_SIZE,
  };
};
