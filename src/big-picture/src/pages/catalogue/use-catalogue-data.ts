import type { CatalogueSearchPayload, CatalogueSearchResult, DownloadSource } from "@types";
import { levelDBService } from "@renderer/services/leveldb.service";
import axios from "axios";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

export const PAGE_SIZE = 20;

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
  [FilterType.Tags]?: number[];
  [FilterType.Genres]?: string[];
  [FilterType.Publishers]?: string[];
  [FilterType.Developers]?: string[];
  [FilterType.DownloadSourceFingerprints]?: string[];
}

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

function parseParam<T>(value: string | null): T | undefined {
  if (!value) return undefined;

  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}

export function useCatalogueData() {
  const [searchParams, setSearchParams] = useSearchParams();
  const deferredTitle = useDeferredValue(searchParams.get("title") ?? "");

  const [steamGenres, setSteamGenres] = useState<string[] | null>(null);
  const [steamTags, setSteamTags] = useState<Record<string, number> | null>(
    null
  );
  const [steamDevelopers, setSteamDevelopers] = useState<string[] | null>(null);
  const [steamPublishers, setSteamPublishers] = useState<string[] | null>(null);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [searchData, setSearchData] = useState<SearchGamesResponseData>();
  const [isLoadingSearch, setIsLoadingSearch] = useState(true);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(true);
  const [searchError, setSearchError] = useState<Error | null>(null);
  const [metadataError, setMetadataError] = useState<Error | null>(null);

  const values = useMemo<SearchGamesFormValues>(
    () => ({
      title: searchParams.get("title") ?? "",
      tags: parseParam<number[]>(searchParams.get("tags")) ?? [],
      genres: parseParam<string[]>(searchParams.get("genres")) ?? [],
      publishers: parseParam<string[]>(searchParams.get("publishers")) ?? [],
      developers: parseParam<string[]>(searchParams.get("developers")) ?? [],
      downloadSourceFingerprints:
        parseParam<string[]>(searchParams.get("downloadSourceFingerprints")) ??
        [],
    }),
    [searchParams]
  );

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
      try {
        const [
          genresResponse,
          tagsResponse,
          developersResponse,
          publishersResponse,
          rawDownloadSources,
        ] = await Promise.all([
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

        setSteamGenres(genresResponse.data.en);
        setSteamTags(tagsResponse.data.en);
        setSteamDevelopers(developersResponse.data);
        setSteamPublishers(publishersResponse.data);
        setDownloadSources(
          (rawDownloadSources as DownloadSource[]).filter(
            (source) => !!source.fingerprint
          )
        );
        setMetadataError(null);
      } catch (error) {
        if (cancelled) return;

        setMetadataError(
          error instanceof Error
            ? error
            : new Error("Failed to load catalogue metadata.")
        );
      } finally {
        if (!cancelled) {
          setIsLoadingMetadata(false);
        }
      }
    };

    loadMetadata();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingSearch(true);

    const timeoutId = globalThis.window.setTimeout(async () => {
      try {
        const payload: CatalogueSearchPayload = {
          title: deferredTitle,
          sortBy: "popularity",
          sortOrder: "desc",
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
                take: PAGE_SIZE,
                skip: 0,
              },
              needsAuth: false,
            }
          );

        if (cancelled) return;

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
        if (!cancelled) {
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
    values.tags,
  ]);

  const downloadSourcesAndFingerprints = useMemo(() => {
    return downloadSources.reduce<Record<string, string>>((acc, source) => {
      acc[source.name] = source.fingerprint!;
      return acc;
    }, {});
  }, [downloadSources]);

  const catalogueData = useMemo<CatalogueData | undefined>(() => {
    if (
      !steamGenres ||
      !steamTags ||
      !steamDevelopers ||
      !steamPublishers
    ) {
      return undefined;
    }

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

  return {
    values,
    updateSearchParams,
    catalogueData,
    search: {
      data: searchData,
      isLoading: isLoadingSearch || isLoadingMetadata,
      isError: Boolean(searchError || metadataError),
      error: searchError ?? metadataError,
      isEmpty: !searchData || searchData.edges.length === 0,
    },
  };
}

