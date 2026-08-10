import type { GameShop } from "@types";

export const SIMILAR_GAMES_LIMIT = 9;
export type SimilarGamesAlgorithm = "legacy" | "jaccard" | "balanced";

export interface SimilarGamesQuery {
  objectId: string;
  shop: GameShop;
  genres?: readonly unknown[];
  algorithm?: SimilarGamesAlgorithm;
}

export interface SimilarGame {
  objectId: string;
  shop: Exclude<GameShop, "custom">;
  title: string;
  genres: string[];
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

export const extractSimilarGameGenres = (genres: readonly unknown[]) => {
  const seen = new Set<string>();

  return genres
    .map((genre) => {
      if (typeof genre === "string") return genre.trim();
      if (!genre || typeof genre !== "object") return "";

      const { name, description } = genre as {
        name?: unknown;
        description?: unknown;
      };
      const value = typeof name === "string" ? name : description;

      return typeof value === "string" ? value.trim() : "";
    })
    .filter((genre) => {
      const normalizedGenre = genre.toLocaleLowerCase();
      if (!normalizedGenre || seen.has(normalizedGenre)) return false;

      seen.add(normalizedGenre);
      return true;
    });
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
    genres: Array.isArray(candidate.genres)
      ? candidate.genres.filter(
          (genre): genre is string => typeof genre === "string"
        )
      : [],
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

const normalizedGenreSet = (genres: readonly unknown[]) =>
  new Set(
    extractSimilarGameGenres(genres).map((genre) => genre.toLocaleLowerCase())
  );

export const rankSimilarGames = (
  games: SimilarGame[],
  currentGenres: readonly unknown[] = [],
  algorithm: SimilarGamesAlgorithm = "legacy"
) => {
  if (algorithm === "legacy" || games.length < 2) return games;

  const current = normalizedGenreSet(currentGenres);

  return games
    .map((game, index) => {
      const candidate = normalizedGenreSet(game.genres);
      const intersection = [...candidate].filter((genre) =>
        current.has(genre)
      ).length;
      const union = new Set([...current, ...candidate]).size;
      const jaccard = union === 0 ? 0 : intersection / union;
      const candidateCoverage =
        candidate.size === 0 ? 0 : intersection / candidate.size;
      const score =
        algorithm === "jaccard"
          ? jaccard
          : 0.75 * jaccard + 0.25 * candidateCoverage;

      return { game, index, score, intersection };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.intersection - left.intersection ||
        left.index - right.index
    )
    .map(({ game }) => game);
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

  const games = normalizeSimilarGamesResponse(response, query);
  return rankSimilarGames(games, query.genres, query.algorithm);
};
