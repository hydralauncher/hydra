import type { ShopAssets } from "@types";

export type HomeFeedRow = ShopAssets & {
  genres?: string[] | null;
  shortUrl?: string;
};

export type HomeCategory =
  | "hot"
  | "weekly"
  | "achievements"
  | "most-played"
  | "acclaimed"
  | "hidden-gems"
  | "recently-added"
  | "retro"
  | "spotlight";

const DEFAULT_TAKE = 96;

interface CategoryQuery {
  take?: number;
  skip?: number;
  seed?: number;
}

export function fetchCategoryRow(
  category: HomeCategory,
  downloadSourceIds: string[],
  query: CategoryQuery = {}
): Promise<HomeFeedRow[]> {
  const params: Record<string, unknown> = {
    take: query.take ?? DEFAULT_TAKE,
    skip: query.skip ?? 0,
    downloadSourceIds,
  };
  if (typeof query.seed === "number") params.seed = query.seed;

  return window.electron.hydraApi
    .get<HomeFeedRow[]>(`/catalogue/${category}`, {
      params,
      needsAuth: false,
    })
    .catch(() => [] as HomeFeedRow[]);
}

export interface ShelfQuery {
  genre?: string;
  tag?: string;
  platform?: string;
  take?: number;
  skip?: number;
}

export function fetchShelfRow(
  shelf: ShelfQuery,
  downloadSourceIds: string[]
): Promise<HomeFeedRow[]> {
  const params: Record<string, unknown> = {
    take: shelf.take ?? DEFAULT_TAKE,
    skip: shelf.skip ?? 0,
    downloadSourceIds,
  };
  if (shelf.genre) params.genre = shelf.genre;
  if (shelf.tag) params.tag = shelf.tag;
  if (shelf.platform) params.platform = shelf.platform;

  return window.electron.hydraApi
    .get<HomeFeedRow[]>("/catalogue/shelf", {
      params,
      needsAuth: false,
    })
    .catch(() => [] as HomeFeedRow[]);
}

export function fetchSimilarRow(
  shop: string,
  objectId: string,
  downloadSourceIds: string[],
  options: { take?: number; needsAuth?: boolean } = {}
): Promise<HomeFeedRow[]> {
  return window.electron.hydraApi
    .get<HomeFeedRow[]>(`/catalogue/similar/${shop}/${objectId}`, {
      params: {
        take: options.take ?? DEFAULT_TAKE,
        skip: 0,
        downloadSourceIds,
      },
      needsAuth: options.needsAuth ?? false,
    })
    .catch(() => [] as HomeFeedRow[]);
}

export function batchDownloadSources(
  games: { shop: string; objectId: string }[],
  downloadSourceIds: string[]
): Promise<Record<string, string[]>> {
  if (games.length === 0 || downloadSourceIds.length === 0) {
    return Promise.resolve({});
  }

  return window.electron.hydraApi
    .post<Record<string, string[]>>("/catalogue/download-sources/batch", {
      data: { games, downloadSourceIds },
      needsAuth: false,
    })
    .catch(() => ({}) as Record<string, string[]>);
}
