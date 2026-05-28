import type {
  CatalogueSearchPayload,
  CatalogueSearchResult,
  DownloadSource,
} from "@types";
import { levelDBService } from "@renderer/services/leveldb.service";
import axios from "axios";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";

const DEFAULT_PAGE_SIZE = 20;
const WIDE_PAGE_SIZE = 30;
const WIDE_GRID_MEDIA_QUERY = "(min-width: 1440px)";

function getCataloguePageSize() {
  return globalThis.window.matchMedia(WIDE_GRID_MEDIA_QUERY).matches
    ? WIDE_PAGE_SIZE
    : DEFAULT_PAGE_SIZE;
}

export enum FilterType {
  Genres = "genres",
  Tags = "tags",
  DownloadSourceFingerprints = "downloadSourceFingerprints",
  Publishers = "publishers",
  Developers = "developers",
}

export interface CatalogueData {
  [FilterType.Genres]: { data: string[]; label: string; color: string };
  [FilterType.Tags]: {
    data: Record<string, number>;
    label: string;
    color: string;
  };
  [FilterType.DownloadSourceFingerprints]: {
    data: Record<string, string>;
    label: string;
    color: string;
  };
  [FilterType.Developers]: {
    data: string[];
    label: string;
    color: string;
  };
  [FilterType.Publishers]: {
    data: string[];
    label: string;
    color: string;
  };
}

export interface SearchGamesFormValues {
  title?: string;
  sortBy?: CatalogueSearchPayload["sortBy"];
  sortOrder?: CatalogueSearchPayload["sortOrder"];
  [FilterType.Tags]?: number[];
  [FilterType.Genres]?: string[];
  [FilterType.Publishers]?: string[];
  [FilterType.Developers]?: string[];
  [FilterType.DownloadSourceFingerprints]?: string[];
}

export const CATALOGUE_SORT_OPTIONS = [
  {
    value: "popularity:desc",
    label: "Popularity",
    sortBy: "popularity",
    sortOrder: "desc",
  },
  {
    value: "releaseDate:desc",
    label: "Newest releases",
    sortBy: "releaseDate",
    sortOrder: "desc",
  },
  {
    value: "releaseDate:asc",
    label: "Oldest releases",
    sortBy: "releaseDate",
    sortOrder: "asc",
  },
  {
    value: "alphabetical:asc",
    label: "Title (A-Z)",
    sortBy: "alphabetical",
    sortOrder: "asc",
  },
  {
    value: "alphabetical:desc",
    label: "Title (Z-A)",
    sortBy: "alphabetical",
    sortOrder: "desc",
  },
  {
    value: "hydraScore:desc",
    label: "Highest rating",
    sortBy: "hydraScore",
    sortOrder: "desc",
  },
  {
    value: "hydraScore:asc",
    label: "Lowest rating",
    sortBy: "hydraScore",
    sortOrder: "asc",
  },
] as const satisfies ReadonlyArray<{
  value: string;
  label: string;
  sortBy: CatalogueSearchPayload["sortBy"];
  sortOrder: CatalogueSearchPayload["sortOrder"];
}>;

export type CatalogueSortValue =
  (typeof CATALOGUE_SORT_OPTIONS)[number]["value"];

const DEFAULT_CATALOGUE_SORT_OPTION = CATALOGUE_SORT_OPTIONS[0];

export interface SearchGamesResponseData {
  edges: CatalogueSearchResult[];
  count: number;
}

interface SteamGenresResponse {
  en: string[];
}

interface SteamTagsResponse {
  en: Record<string, number>;
}

const externalResourcesInstance = axios.create({
  baseURL: import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL,
});

function parseJsonParam(value: string | null): unknown {
  if (!value) return undefined;

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseStringArrayParam(value: string | null) {
  const parsed = parseJsonParam(value);

  if (!Array.isArray(parsed)) return [];

  return parsed.filter((item): item is string => typeof item === "string");
}

function parseNumberArrayParam(value: string | null) {
  const parsed = parseJsonParam(value);

  if (!Array.isArray(parsed)) return [];

  return parsed.filter(
    (item): item is number => typeof item === "number" && Number.isFinite(item)
  );
}

function getCatalogueSortOption(searchParams: URLSearchParams) {
  const value = `${searchParams.get("sortBy")}:${searchParams.get("sortOrder")}`;

  return (
    CATALOGUE_SORT_OPTIONS.find((option) => option.value === value) ??
    DEFAULT_CATALOGUE_SORT_OPTION
  );
}

export function useCatalogueData() {
  const [searchParams, setSearchParams] = useSearchParams();
  const deferredTitle = useDeferredValue(searchParams.get("title") ?? "");
  const [pageSize, setPageSize] = useState(getCataloguePageSize);
  const [page, setPage] = useState(1);

  const [steamGenres, setSteamGenres] = useState<string[]>([]);
  const [steamTags, setSteamTags] = useState<Record<string, number>>({});
  const [steamDevelopers, setSteamDevelopers] = useState<string[]>([]);
  const [steamPublishers, setSteamPublishers] = useState<string[]>([]);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [searchData, setSearchData] = useState<SearchGamesResponseData>();
  const [isLoadingSearch, setIsLoadingSearch] = useState(true);
  const [searchError, setSearchError] = useState<Error | null>(null);
  const downloadSourceIds = useMemo(
    () => downloadSources.map((source) => source.id),
    [downloadSources]
  );

  useEffect(() => {
    const mediaQuery = globalThis.window.matchMedia(WIDE_GRID_MEDIA_QUERY);
    const updatePageSize = () => setPageSize(getCataloguePageSize());

    mediaQuery.addEventListener("change", updatePageSize);

    return () => {
      mediaQuery.removeEventListener("change", updatePageSize);
    };
  }, []);

  const values = useMemo<SearchGamesFormValues>(() => {
    const sortOption = getCatalogueSortOption(searchParams);

    return {
      title: searchParams.get("title") ?? "",
      sortBy: sortOption.sortBy,
      sortOrder: sortOption.sortOrder,
      tags: parseNumberArrayParam(searchParams.get("tags")),
      genres: parseStringArrayParam(searchParams.get("genres")),
      publishers: parseStringArrayParam(searchParams.get("publishers")),
      developers: parseStringArrayParam(searchParams.get("developers")),
      downloadSourceFingerprints: parseStringArrayParam(
        searchParams.get("downloadSourceFingerprints")
      ),
    };
  }, [searchParams]);

  useEffect(() => {
    setPage(1);
  }, [
    values.title,
    values.developers,
    values.downloadSourceFingerprints,
    values.genres,
    values.publishers,
    values.sortBy,
    values.sortOrder,
    values.tags,
    pageSize,
  ]);

  const updateSearchParams = useCallback(
    (newValues: Partial<SearchGamesFormValues>) => {
      setSearchParams((currentSearchParams) => {
        const nextSearchParams = new URLSearchParams(currentSearchParams);

        Object.entries(newValues).forEach(([key, value]) => {
          if (typeof value === "string") {
            if (value.trim().length > 0) {
              nextSearchParams.set(key, value);
            } else {
              nextSearchParams.delete(key);
            }

            return;
          }

          if (Array.isArray(value) && value.length > 0) {
            nextSearchParams.set(key, JSON.stringify(value));
          } else {
            nextSearchParams.delete(key);
          }
        });

        return nextSearchParams;
      });
    },
    [setSearchParams]
  );

  useEffect(() => {
    let cancelled = false;

    const loadMetadata = async () => {
      const [
        genresResponse,
        tagsResponse,
        developersResponse,
        publishersResponse,
        rawDownloadSources,
      ] = await Promise.allSettled([
        externalResourcesInstance.get<SteamGenresResponse>(
          "/steam-genres.json"
        ),
        externalResourcesInstance.get<SteamTagsResponse>(
          "/steam-user-tags.json"
        ),
        externalResourcesInstance.get<string[]>("/steam-developers.json"),
        externalResourcesInstance.get<string[]>("/steam-publishers.json"),
        levelDBService.values("downloadSources"),
      ]);

      if (cancelled) return;

      if (genresResponse.status === "fulfilled") {
        setSteamGenres(genresResponse.value.data.en);
      }

      if (tagsResponse.status === "fulfilled") {
        setSteamTags(tagsResponse.value.data.en);
      }

      if (developersResponse.status === "fulfilled") {
        setSteamDevelopers(developersResponse.value.data);
      }

      if (publishersResponse.status === "fulfilled") {
        setSteamPublishers(publishersResponse.value.data);
      }

      if (rawDownloadSources.status === "fulfilled") {
        setDownloadSources(
          (rawDownloadSources.value as DownloadSource[]).filter(
            (source) => !!source.fingerprint
          )
        );
      }
    };

    loadMetadata();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let isRedirectingToAvailablePage = false;
    setIsLoadingSearch(true);

    const timeoutId = globalThis.window.setTimeout(async () => {
      try {
        const payload: CatalogueSearchPayload = {
          title: deferredTitle,
          sortBy: values.sortBy ?? DEFAULT_CATALOGUE_SORT_OPTION.sortBy,
          sortOrder:
            values.sortOrder ?? DEFAULT_CATALOGUE_SORT_OPTION.sortOrder,
          downloadSourceFingerprints: values.downloadSourceFingerprints ?? [],
          tags: values.tags ?? [],
          publishers: values.publishers ?? [],
          genres: values.genres ?? [],
          developers: values.developers ?? [],
          protondbSupportBadges: [],
          deckCompatibility: [],
        };

        const response =
          await globalThis.window.electron.hydraApi.post<SearchGamesResponseData>(
            "/catalogue/search",
            {
              data: {
                ...payload,
                downloadSourceIds,
                take: pageSize,
                skip: (page - 1) * pageSize,
              },
              needsAuth: false,
            }
          );

        if (cancelled) return;

        const lastAvailablePage = Math.max(
          1,
          Math.ceil(response.count / pageSize)
        );

        if (page > lastAvailablePage) {
          isRedirectingToAvailablePage = true;
          setPage(lastAvailablePage);
          return;
        }

        setSearchData(response);
        setSearchError(null);
      } catch (error) {
        if (cancelled) return;

        setSearchError(
          error instanceof Error
            ? error
            : new Error("Failed to search catalogue.")
        );
      } finally {
        if (!cancelled && !isRedirectingToAvailablePage) {
          setIsLoadingSearch(false);
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      globalThis.window.clearTimeout(timeoutId);
    };
  }, [
    deferredTitle,
    values.developers,
    values.downloadSourceFingerprints,
    values.genres,
    values.publishers,
    values.sortBy,
    values.sortOrder,
    values.tags,
    downloadSourceIds,
    page,
    pageSize,
  ]);

  const downloadSourcesAndFingerprints = useMemo(() => {
    return downloadSources.reduce<Record<string, string>>((acc, source) => {
      acc[source.name] = source.fingerprint!;
      return acc;
    }, {});
  }, [downloadSources]);

  const catalogueData = useMemo<CatalogueData>(() => {
    return {
      [FilterType.Genres]: {
        data: steamGenres,
        label: "Genres",
        color: "magenta",
      },
      [FilterType.Tags]: {
        data: steamTags,
        label: "Tags",
        color: "yellow",
      },
      [FilterType.DownloadSourceFingerprints]: {
        data: downloadSourcesAndFingerprints,
        label: "Download Sources",
        color: "red",
      },
      [FilterType.Developers]: {
        data: steamDevelopers,
        label: "Developers",
        color: "cyan",
      },
      [FilterType.Publishers]: {
        data: steamPublishers,
        label: "Publishers",
        color: "lime",
      },
    };
  }, [
    downloadSourcesAndFingerprints,
    steamDevelopers,
    steamGenres,
    steamPublishers,
    steamTags,
  ]);
  const totalPages = Math.ceil((searchData?.count ?? 0) / pageSize);

  const changePage = useCallback((nextPage: number) => {
    setIsLoadingSearch(true);
    setPage(nextPage);
  }, []);

  return {
    page,
    pageSize,
    totalPages,
    changePage,
    values,
    updateSearchParams,
    catalogueData,
    search: {
      data: searchData,
      isLoading: isLoadingSearch,
      isError: Boolean(searchError),
      error: searchError,
      isEmpty: !searchData || searchData.edges.length === 0,
    },
  };
}
