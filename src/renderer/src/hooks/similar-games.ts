import type {
  CatalogueSearchPayload,
  CatalogueSearchResult,
  GameShop,
} from "@types";
import { platformToSystem } from "../../../shared/platform-to-system.js";

export const SIMILAR_GAMES_LIMIT = 9;
const SIMILAR_GAMES_SEARCH_SIZE = 24;

export type GenresByLanguage = Record<string, string[]>;

export interface SimilarGamesQuery {
  objectId: string;
  shop: GameShop;
  genres: string[];
  platform?: string | null;
  language: string;
}

export interface SimilarGamesSearchResponse {
  edges: CatalogueSearchResult[];
  count: number;
}

export type SimilarGamesSearch = (
  payload: CatalogueSearchPayload & {
    take: number;
    skip: number;
    downloadSourceIds: string[];
  }
) => Promise<SimilarGamesSearchResponse>;

const normalizeValue = (value: string) => value.trim().toLocaleLowerCase();

const uniqueGenres = (genres: string[]) => {
  const seen = new Set<string>();

  return genres.filter((genre) => {
    const normalized = normalizeValue(genre);
    if (!normalized || seen.has(normalized)) return false;

    seen.add(normalized);
    return true;
  });
};

export const extractSimilarGameGenres = (genres: readonly unknown[]) => {
  return uniqueGenres(
    genres.map((genre) => {
      if (typeof genre === "string") return genre.trim();
      if (!genre || typeof genre !== "object") return "";

      const { name, description } = genre as {
        name?: unknown;
        description?: unknown;
      };
      const value = typeof name === "string" ? name : description;

      return typeof value === "string" ? value.trim() : "";
    })
  );
};

const getLanguageGenres = (
  genresByLanguage: GenresByLanguage,
  language: string
) => {
  const normalizedLanguage = language.replace("_", "-");
  const baseLanguage = normalizedLanguage.split("-")[0];

  return (
    genresByLanguage[normalizedLanguage] ??
    genresByLanguage[language] ??
    genresByLanguage[baseLanguage]
  );
};

export const canonicalizeLocalizedGenres = (
  genres: string[],
  language: string,
  genresByLanguage: GenresByLanguage
) => {
  const englishGenres = genresByLanguage.en ?? [];
  const localizedGenres = getLanguageGenres(genresByLanguage, language);

  return uniqueGenres(
    genres.map((genre) => {
      if (!localizedGenres) return genre;

      const normalizedGenre = normalizeValue(genre);
      const localizedIndex = localizedGenres.findIndex(
        (localizedGenre) => normalizeValue(localizedGenre) === normalizedGenre
      );

      return englishGenres[localizedIndex] ?? genre;
    })
  );
};

export const getSimilarGameCoverImageUrl = (
  game: Pick<CatalogueSearchResult, "objectId" | "shop" | "libraryImageUrl">
) => {
  if (game.shop === "steam") {
    return `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/library_600x900_2x.jpg`;
  }

  return game.libraryImageUrl;
};

const matchesPlatform = (
  game: CatalogueSearchResult,
  shop: GameShop,
  platform?: string | null
) => {
  if (shop !== "launchbox" || !platform) return true;
  if (!game.platform) return false;

  const platformSystem = platformToSystem(platform);
  if (platformSystem) {
    return platformToSystem(game.platform) === platformSystem;
  }

  return normalizeValue(game.platform) === normalizeValue(platform);
};

export const rankSimilarGames = (
  candidates: CatalogueSearchResult[],
  query: Pick<SimilarGamesQuery, "objectId" | "shop" | "genres" | "platform">,
  limit = SIMILAR_GAMES_LIMIT
) => {
  const currentGenres = new Set(query.genres.map(normalizeValue));
  const seen = new Set<string>();

  return candidates
    .map((game, index) => ({ game, index }))
    .filter(({ game }) => {
      const key = `${game.shop}:${game.objectId}`;
      const isValidCandidate =
        game.shop === query.shop &&
        game.objectId !== query.objectId &&
        matchesPlatform(game, query.shop, query.platform);

      if (!isValidCandidate || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ game, index }) => {
      const candidateGenres = new Set(
        (game.genres ?? []).map(normalizeValue).filter(Boolean)
      );
      const sharedGenreCount = Array.from(candidateGenres).filter((genre) =>
        currentGenres.has(genre)
      ).length;

      return {
        game,
        index,
        sharedGenreCount,
        sharedGenreRatio:
          candidateGenres.size > 0
            ? sharedGenreCount / candidateGenres.size
            : 0,
      };
    })
    .filter(({ sharedGenreCount }) => sharedGenreCount > 0)
    .sort((first, second) => {
      return (
        second.sharedGenreCount - first.sharedGenreCount ||
        second.sharedGenreRatio - first.sharedGenreRatio ||
        first.index - second.index
      );
    })
    .slice(0, limit)
    .map(({ game }) => game);
};

const buildSearchPayload = (
  query: SimilarGamesQuery,
  genres: string[]
): Parameters<SimilarGamesSearch>[0] => {
  const platformKey = platformToSystem(query.platform);

  return {
    title: "",
    sortBy: "popularity",
    sortOrder: "desc",
    downloadSourceFingerprints: [],
    tags: [],
    publishers: [],
    genres,
    developers: [],
    protondbSupportBadges: [],
    deckCompatibility: [],
    ...(query.shop === "launchbox"
      ? {
          shops: ["launchbox"],
          ...(platformKey ? { platforms: [platformKey] } : {}),
        }
      : {}),
    take: SIMILAR_GAMES_SEARCH_SIZE,
    skip: 0,
    downloadSourceIds: [],
  };
};

const getResponseEdges = (response: SimilarGamesSearchResponse) => {
  if (!Array.isArray(response?.edges)) {
    throw new TypeError("Invalid similar games catalogue response");
  }

  return response.edges;
};

export const fetchSimilarGames = async (
  query: SimilarGamesQuery,
  search: SimilarGamesSearch,
  genresByLanguage?: GenresByLanguage
) => {
  if (query.shop === "custom" || query.genres.length === 0) return [];

  const canonicalGenres =
    query.shop === "steam"
      ? canonicalizeLocalizedGenres(
          query.genres,
          query.language,
          genresByLanguage ?? {}
        )
      : uniqueGenres(query.genres);

  if (canonicalGenres.length === 0) return [];

  const canonicalQuery = { ...query, genres: canonicalGenres };
  const initialResponse = await search(
    buildSearchPayload(canonicalQuery, canonicalGenres)
  );
  const initialCandidates = getResponseEdges(initialResponse);
  let rankedGames = rankSimilarGames(initialCandidates, canonicalQuery);

  if (rankedGames.length < SIMILAR_GAMES_LIMIT && canonicalGenres.length > 1) {
    const fallbackResponse = await search(
      buildSearchPayload(canonicalQuery, [canonicalGenres[0]])
    );
    rankedGames = rankSimilarGames(
      [...initialCandidates, ...getResponseEdges(fallbackResponse)],
      canonicalQuery
    );
  }

  return rankedGames;
};
