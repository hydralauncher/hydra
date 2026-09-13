import type { GameShop } from "@types";

export const SIMILAR_GAMES_LIMIT = 9;

export type SimilarGamesSectionState = "hidden" | "loading" | "ready" | "empty";

export const getSimilarGamesSectionState = (
  isEligible: boolean,
  isLoading: boolean,
  gameCount: number
): SimilarGamesSectionState => {
  if (!isEligible) return "hidden";
  if (isLoading) return "loading";
  if (gameCount > 0) return "ready";

  return "empty";
};

export interface SimilarGamesQuery {
  objectId: string;
  shop: GameShop;
}

export interface SimilarGame {
  objectId: string;
  shop: Exclude<GameShop, "custom">;
  title: string;
  iconUrl: string | null;
  libraryHeroImageUrl: string | null;
  libraryImageUrl: string | null;
  coverImageUrl: string | null;
  logoImageUrl: string | null;
  downloadSources: string[];
}

interface SimilarGamesRequestOptions {
  params: {
    take: number;
    downloadSourceIds: string[];
  };
  needsAuth: false;
}

export type SimilarGamesGet = (
  path: string,
  options: SimilarGamesRequestOptions
) => Promise<unknown>;

const isSupportedShop = (
  shop: GameShop
): shop is Exclude<GameShop, "custom"> => {
  return shop === "steam" || shop === "launchbox";
};

const optionalString = (value: unknown) => {
  return typeof value === "string" ? value : null;
};

const normalizeDownloadSources = (value: unknown) => {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (source): source is string =>
      typeof source === "string" && source.trim().length > 0
  );
};

const normalizeSimilarGame = (value: unknown): SimilarGame | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.objectId !== "string" ||
    (candidate.shop !== "steam" && candidate.shop !== "launchbox") ||
    typeof candidate.title !== "string"
  ) {
    return null;
  }

  const objectId = candidate.objectId.trim();
  const title = candidate.title.trim();

  if (!objectId || !title) return null;

  return {
    objectId,
    shop: candidate.shop,
    title,
    iconUrl: optionalString(candidate.iconUrl),
    libraryHeroImageUrl: optionalString(candidate.libraryHeroImageUrl),
    libraryImageUrl: optionalString(candidate.libraryImageUrl),
    coverImageUrl: optionalString(candidate.coverImageUrl),
    logoImageUrl: optionalString(candidate.logoImageUrl),
    downloadSources: normalizeDownloadSources(candidate.downloadSources),
  };
};

export const normalizeSimilarGamesResponse = (
  response: unknown,
  query: SimilarGamesQuery
) => {
  if (!Array.isArray(response)) {
    throw new TypeError("Invalid similar games response");
  }

  const seen = new Set<string>();

  return response
    .flatMap((candidate) => {
      const game = normalizeSimilarGame(candidate);

      return game ? [game] : [];
    })
    .filter((game) => {
      const key = `${game.shop}:${game.objectId}`;
      const isValid =
        game.shop === query.shop && game.objectId !== query.objectId;

      if (!isValid || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, SIMILAR_GAMES_LIMIT);
};

export const fetchSimilarGames = async (
  query: SimilarGamesQuery,
  get: SimilarGamesGet,
  downloadSourceIds: string[] = []
) => {
  if (!isSupportedShop(query.shop) || !query.objectId) return [];

  const response = await get(
    `/catalogue/${query.shop}/${encodeURIComponent(query.objectId)}/similar`,
    {
      params: { take: SIMILAR_GAMES_LIMIT, downloadSourceIds },
      needsAuth: false,
    }
  );

  return normalizeSimilarGamesResponse(response, query);
};
