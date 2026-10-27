import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { DownloadSource } from "@types";
import { useAppDispatch } from "./redux";
import { setGenres, setTags } from "@renderer/features";

const SUPPORTED_STEAM_METADATA_LANGUAGES = new Set([
  "en",
  "es",
  "pt",
  "ru",
  "fr",
]);

const metadataCache = new Map<string, Promise<unknown>>();

function fetchCached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = metadataCache.get(key);
  if (cached !== undefined) return cached as Promise<T>;

  const promise = fetcher().catch((error) => {
    metadataCache.delete(key);
    throw error;
  });
  metadataCache.set(key, promise);
  return promise;
}

const steamListCache: Record<"publishers" | "developers", string[] | null> = {
  publishers: null,
  developers: null,
};

function fetchSteamList(kind: "publishers" | "developers") {
  return fetchCached(`steam-${kind}`, () =>
    window.electron.hydraApi
      .get<string[]>(`/catalogue/steam/${kind}`, { needsAuth: false })
      .then((list) => {
        steamListCache[kind] = list;
        return list;
      })
  );
}

async function getLocalizedSteamMetadata<T>(endpoint: string, locale: string) {
  const language = locale.split("-")[0] || "en";
  const requestLanguage = SUPPORTED_STEAM_METADATA_LANGUAGES.has(language)
    ? language
    : "en";
  const languages = requestLanguage === "en" ? ["en"] : ["en", requestLanguage];
  const entries = await Promise.all(
    languages.map(async (currentLanguage) => {
      const data = await fetchCached(`${endpoint}:${currentLanguage}`, () =>
        window.electron.hydraApi.get<T>(endpoint, {
          params: { language: currentLanguage },
          needsAuth: false,
        })
      );

      return [currentLanguage, data] as const;
    })
  );
  const metadata = Object.fromEntries(entries) as Record<string, T>;

  metadata[language] ??= metadata[requestLanguage];

  return metadata;
}

export function useCatalogue() {
  const dispatch = useAppDispatch();
  const { i18n } = useTranslation();

  const [steamPublishers, setSteamPublishers] = useState<string[]>(
    () => steamListCache.publishers ?? []
  );
  const [steamDevelopers, setSteamDevelopers] = useState<string[]>(
    () => steamListCache.developers ?? []
  );
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [hasLoadedDownloadSources, setHasLoadedDownloadSources] =
    useState(false);

  const getSteamFilters = useCallback(async () => {
    const [tags, genres] = await Promise.all([
      getLocalizedSteamMetadata<Record<string, number>>(
        "/catalogue/steam/tags",
        i18n.language
      ),
      getLocalizedSteamMetadata<string[]>(
        "/catalogue/steam/genres",
        i18n.language
      ),
    ]);

    dispatch(setTags(tags));
    dispatch(setGenres(genres));
  }, [dispatch, i18n.language]);

  const getDownloadSources = useCallback(() => {
    void levelDBService
      .values("downloadSources")
      .then((results) => {
        const sources = results as DownloadSource[];
        setDownloadSources(sources.filter((source) => !!source.fingerprint));
      })
      .finally(() => setHasLoadedDownloadSources(true));
  }, []);

  useEffect(() => {
    getSteamFilters();
    getDownloadSources();
  }, [getSteamFilters, getDownloadSources]);

  useEffect(() => {
    let cancelled = false;

    if (!steamListCache.publishers) {
      fetchSteamList("publishers")
        .then((list) => {
          if (!cancelled) setSteamPublishers(list);
        })
        .catch(() => {});
    }

    if (!steamListCache.developers) {
      fetchSteamList("developers")
        .then((list) => {
          if (!cancelled) setSteamDevelopers(list);
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    steamPublishers,
    downloadSources,
    steamDevelopers,
    hasLoadedDownloadSources,
  };
}
