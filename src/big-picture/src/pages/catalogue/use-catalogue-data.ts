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
  useRef,
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
  Platforms = "platforms",
  Genres = "genres",
  Tags = "tags",
  DownloadSourceFingerprints = "downloadSourceFingerprints",
  Publishers = "publishers",
  Developers = "developers",
}

export type CatalogueMode = "modern" | "classics";

export interface LaunchboxPlatform {
  key: string;
  name: string;
}

interface LaunchboxCatalogueFilters {
  platforms: LaunchboxPlatform[];
  genres: string[];
  developers: string[];
  publishers: string[];
}

export interface CatalogueData {
  [FilterType.Platforms]: {
    data: Record<string, string>;
    label: string;
    color: string;
  };
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
  mode?: CatalogueMode;
  title?: string;
  sortBy?: CatalogueSearchPayload["sortBy"];
  sortOrder?: CatalogueSearchPayload["sortOrder"];
  [FilterType.Platforms]?: string[];
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
const DEFAULT_LAUNCHBOX_FILTERS: LaunchboxCatalogueFilters = {
  platforms: [],
  genres: [],
  developers: [],
  publishers: [],
};

export const MODERN_CATALOGUE_FILTER_TYPES = [
  FilterType.Genres,
  FilterType.Tags,
  FilterType.DownloadSourceFingerprints,
  FilterType.Developers,
  FilterType.Publishers,
] as const;

export const CLASSICS_CATALOGUE_FILTER_TYPES = [
  FilterType.Platforms,
  FilterType.Genres,
  FilterType.Developers,
  FilterType.Publishers,
  FilterType.DownloadSourceFingerprints,
] as const;

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

interface LaunchboxFiltersResponse {
  platforms?: Array<string | LaunchboxPlatform>;
  genres?: string[];
  developers?: string[];
  publishers?: string[];
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

function getCatalogueMode(searchParams: URLSearchParams): CatalogueMode {
  return searchParams.get("mode") === "classics" ? "classics" : "modern";
}

function normalizeLaunchboxFilters(
  filters: LaunchboxFiltersResponse
): LaunchboxCatalogueFilters {
  return {
    platforms: (filters.platforms ?? [])
      .map((platform) =>
        typeof platform === "string"
          ? { key: platform, name: platform }
          : platform
      )
      .filter(
        (platform): platform is LaunchboxPlatform =>
          Boolean(platform.key) && Boolean(platform.name)
      ),
    genres: filters.genres ?? [],
    developers: filters.developers ?? [],
    publishers: filters.publishers ?? [],
  };
}

export function useCatalogueData() {
  const [searchParams, setSearchParams] = useSearchParams();
  const deferredTitle = useDeferredValue(searchParams.get("title") ?? "");
  const [pageSize, setPageSize] = useState(getCataloguePageSize);

  const [steamGenres, setSteamGenres] = useState<string[]>([]);
  const [steamTags, setSteamTags] = useState<Record<string, number>>({});
  const [steamDevelopers, setSteamDevelopers] = useState<string[]>([]);
  const [steamPublishers, setSteamPublishers] = useState<string[]>([]);
  const [launchboxFilters, setLaunchboxFilters] =
    useState<LaunchboxCatalogueFilters>(DEFAULT_LAUNCHBOX_FILTERS);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [searchData, setSearchData] = useState<SearchGamesResponseData>();
  const [isLoadingSearch, setIsLoadingSearch] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);
  const isFetchingSearchRef = useRef(false);
  const activeSearchKeyRef = useRef("");
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
    const mode = getCatalogueMode(searchParams);

    return {
      mode,
      title: searchParams.get("title") ?? "",
      sortBy: sortOption.sortBy,
      sortOrder: sortOption.sortOrder,
      platforms: parseStringArrayParam(searchParams.get("platforms")),
      tags: parseNumberArrayParam(searchParams.get("tags")),
      genres: parseStringArrayParam(searchParams.get("genres")),
      publishers: parseStringArrayParam(searchParams.get("publishers")),
      developers: parseStringArrayParam(searchParams.get("developers")),
      downloadSourceFingerprints: parseStringArrayParam(
        searchParams.get("downloadSourceFingerprints")
      ),
    };
  }, [searchParams]);

  const updateSearchParams = useCallback(
    (newValues: Partial<SearchGamesFormValues>) => {
      setSearchParams((currentSearchParams) => {
        const nextSearchParams = new URLSearchParams(currentSearchParams);

        Object.entries(newValues).forEach(([key, value]) => {
          if (key === "mode") {
            if (value === "classics") {
              nextSearchParams.set(key, value);
            } else {
              nextSearchParams.delete(key);
            }

            return;
          }

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

  const searchKey = useMemo(
    () =>
      JSON.stringify({
        mode: values.mode ?? "modern",
        title: deferredTitle,
        sortBy: values.sortBy ?? DEFAULT_CATALOGUE_SORT_OPTION.sortBy,
        sortOrder: values.sortOrder ?? DEFAULT_CATALOGUE_SORT_OPTION.sortOrder,
        downloadSourceFingerprints: values.downloadSourceFingerprints ?? [],
        platforms: values.platforms ?? [],
        tags: values.tags ?? [],
        publishers: values.publishers ?? [],
        genres: values.genres ?? [],
        developers: values.developers ?? [],
        downloadSourceIds,
        pageSize,
      }),
    [
      deferredTitle,
      values.developers,
      values.downloadSourceFingerprints,
      values.genres,
      values.mode,
      values.platforms,
      values.publishers,
      values.sortBy,
      values.sortOrder,
      values.tags,
      downloadSourceIds,
      pageSize,
    ]
  );

  useEffect(() => {
    let cancelled = false;

    const loadMetadata = async () => {
      const [
        genresResponse,
        tagsResponse,
        developersResponse,
        publishersResponse,
        launchboxFiltersResponse,
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
        globalThis.window.electron.hydraApi.get<LaunchboxFiltersResponse>(
          "/catalogue/filters?shop=launchbox",
          { needsAuth: false }
        ),
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

      if (launchboxFiltersResponse.status === "fulfilled") {
        setLaunchboxFilters(
          normalizeLaunchboxFilters(launchboxFiltersResponse.value)
        );
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

  const fetchCataloguePage = useCallback(
    async (
      skip: number,
      mode: "initial" | "more",
      requestSearchKey = searchKey
    ) => {
      if (isFetchingSearchRef.current) return;

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      isFetchingSearchRef.current = true;

      if (mode === "initial") {
        setIsLoadingSearch(true);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const catalogueMode = values.mode ?? "modern";
        const payload: Omit<CatalogueSearchPayload, "tags"> & {
          tags?: CatalogueSearchPayload["tags"];
          shops?: string[];
          platforms?: string[];
        } = {
          title: deferredTitle,
          sortBy: values.sortBy ?? DEFAULT_CATALOGUE_SORT_OPTION.sortBy,
          sortOrder:
            values.sortOrder ?? DEFAULT_CATALOGUE_SORT_OPTION.sortOrder,
          downloadSourceFingerprints: values.downloadSourceFingerprints ?? [],
          publishers: values.publishers ?? [],
          genres: values.genres ?? [],
          developers: values.developers ?? [],
          protondbSupportBadges: [],
          deckCompatibility: [],
        };

        if (catalogueMode === "modern") {
          payload.tags = values.tags ?? [];
        } else {
          payload.shops = ["launchbox"];
          payload.platforms = values.platforms ?? [];
        }

        const response =
          await globalThis.window.electron.hydraApi.post<SearchGamesResponseData>(
            "/catalogue/search",
            {
              data: {
                ...payload,
                downloadSourceIds,
                take: pageSize,
                skip,
              },
              needsAuth: false,
            }
          );

        if (
          requestIdRef.current !== requestId ||
          activeSearchKeyRef.current !== requestSearchKey
        ) {
          return;
        }

        setSearchData((currentData) => {
          if (mode === "initial") return response;

          const currentEdges = currentData?.edges ?? [];
          const currentIds = new Set(currentEdges.map((edge) => edge.id));
          const nextEdges = response.edges.filter(
            (edge) => !currentIds.has(edge.id)
          );

          return {
            count: response.count,
            edges: [...currentEdges, ...nextEdges],
          };
        });
        setSearchError(null);
      } catch (error) {
        if (
          requestIdRef.current !== requestId ||
          activeSearchKeyRef.current !== requestSearchKey
        ) {
          return;
        }

        setSearchError(
          error instanceof Error
            ? error
            : new Error("Failed to search catalogue.")
        );
      } finally {
        if (
          requestIdRef.current === requestId &&
          activeSearchKeyRef.current === requestSearchKey
        ) {
          isFetchingSearchRef.current = false;
          setIsLoadingSearch(false);
          setIsLoadingMore(false);
        }
      }
    },
    [
      deferredTitle,
      values.developers,
      values.downloadSourceFingerprints,
      values.genres,
      values.mode,
      values.platforms,
      values.publishers,
      values.sortBy,
      values.sortOrder,
      values.tags,
      downloadSourceIds,
      pageSize,
      searchKey,
    ]
  );

  useEffect(() => {
    requestIdRef.current += 1;
    activeSearchKeyRef.current = searchKey;
    isFetchingSearchRef.current = false;
    setSearchData(undefined);
    setSearchError(null);
    setIsLoadingSearch(true);
    setIsLoadingMore(false);

    const timeoutId = globalThis.window.setTimeout(() => {
      void fetchCataloguePage(0, "initial", searchKey);
    }, 200);

    return () => {
      requestIdRef.current += 1;
      isFetchingSearchRef.current = false;
      globalThis.window.clearTimeout(timeoutId);
    };
  }, [fetchCataloguePage, searchKey]);

  const hasNextPage =
    Boolean(searchData) && searchData!.edges.length < searchData!.count;

  const loadMore = useCallback(() => {
    if (
      !searchData ||
      !hasNextPage ||
      isLoadingSearch ||
      isLoadingMore ||
      searchError ||
      isFetchingSearchRef.current
    ) {
      return;
    }

    void fetchCataloguePage(searchData.edges.length, "more");
  }, [
    fetchCataloguePage,
    hasNextPage,
    isLoadingMore,
    isLoadingSearch,
    searchData,
    searchError,
  ]);

  const downloadSourcesAndFingerprints = useMemo(() => {
    return downloadSources.reduce<Record<string, string>>((acc, source) => {
      acc[source.name] = source.fingerprint!;
      return acc;
    }, {});
  }, [downloadSources]);

  const catalogueData = useMemo<CatalogueData>(() => {
    const isClassicsMode = values.mode === "classics";
    const launchboxPlatforms = launchboxFilters.platforms.reduce<
      Record<string, string>
    >((acc, platform) => {
      acc[platform.name] = platform.key;
      return acc;
    }, {});

    return {
      [FilterType.Platforms]: {
        data: launchboxPlatforms,
        label: "Platforms",
        color: "teal",
      },
      [FilterType.Genres]: {
        data: isClassicsMode ? launchboxFilters.genres : steamGenres,
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
        data: isClassicsMode ? launchboxFilters.developers : steamDevelopers,
        label: "Developers",
        color: "cyan",
      },
      [FilterType.Publishers]: {
        data: isClassicsMode ? launchboxFilters.publishers : steamPublishers,
        label: "Publishers",
        color: "lime",
      },
    };
  }, [
    downloadSourcesAndFingerprints,
    launchboxFilters,
    steamDevelopers,
    steamGenres,
    steamPublishers,
    steamTags,
    values.mode,
  ]);

  const filterTypes = useMemo(
    () =>
      values.mode === "classics"
        ? [...CLASSICS_CATALOGUE_FILTER_TYPES]
        : [...MODERN_CATALOGUE_FILTER_TYPES],
    [values.mode]
  );

  return {
    mode: values.mode ?? "modern",
    filterTypes,
    pageSize,
    hasNextPage,
    loadMore,
    values,
    updateSearchParams,
    catalogueData,
    search: {
      key: searchKey,
      data: searchData,
      isLoading: isLoadingSearch,
      isLoadingMore,
      isError: Boolean(searchError),
      error: searchError,
      isEmpty: !isLoadingSearch && (searchData?.edges.length ?? 0) === 0,
    },
  };
}
