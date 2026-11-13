import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { DownloadSource } from "@types";
import { useAppDispatch } from "./redux";
import { setGenres, setTags } from "@renderer/features";
import { logger } from "@renderer/logger";

const SUPPORTED_STEAM_METADATA_LANGUAGES = new Set([
  "en",
  "es",
  "pt",
  "ru",
  "fr",
]);

async function getLocalizedSteamMetadata<T>(endpoint: string, locale: string) {
  const language = locale.split("-")[0] || "en";
  const requestLanguage = SUPPORTED_STEAM_METADATA_LANGUAGES.has(language)
    ? language
    : "en";
  const languages = requestLanguage === "en" ? ["en"] : ["en", requestLanguage];
  const entries = await Promise.all(
    languages.map(async (currentLanguage) => {
      const data = await window.electron.hydraApi.get<T>(endpoint, {
        params: { language: currentLanguage },
        needsAuth: false,
      });

      return [currentLanguage, data] as const;
    })
  );
  const metadata = Object.fromEntries(entries) as Record<string, T>;

  metadata[language] ??= metadata[requestLanguage];

  return metadata;
}

// Last loaded lists, kept for the session. Revisiting the catalogue starts
// from them instead of empty lists, so the filter sections don't pop in.
// null means "not loaded yet", so filter sections can hold their space.
const catalogueCache: {
  publishers: string[] | null;
  developers: string[] | null;
  downloadSources: DownloadSource[] | null;
} = { publishers: null, developers: null, downloadSources: null };

export function useCatalogue() {
  const dispatch = useAppDispatch();
  const { i18n } = useTranslation();

  const [steamPublishers, setSteamPublishers] = useState<string[] | null>(
    catalogueCache.publishers
  );
  const [steamDevelopers, setSteamDevelopers] = useState<string[] | null>(
    catalogueCache.developers
  );
  const [downloadSources, setDownloadSources] = useState<
    DownloadSource[] | null
  >(catalogueCache.downloadSources);

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

  const getSteamPublishers = useCallback(() => {
    window.electron
      .getCatalogueNames("publishers")
      .then((publishers) => {
        catalogueCache.publishers = publishers;
        setSteamPublishers(publishers);
      })
      .catch((error) => {
        logger.error("Failed to load Steam publishers", error);
        setSteamPublishers((current) => current ?? []);
      });
  }, []);

  const getSteamDevelopers = useCallback(() => {
    window.electron
      .getCatalogueNames("developers")
      .then((developers) => {
        catalogueCache.developers = developers;
        setSteamDevelopers(developers);
      })
      .catch((error) => {
        logger.error("Failed to load Steam developers", error);
        setSteamDevelopers((current) => current ?? []);
      });
  }, []);

  const getDownloadSources = useCallback(() => {
    levelDBService.values("downloadSources").then((results) => {
      const sources = (results as DownloadSource[]).filter(
        (source) => !!source.fingerprint
      );
      catalogueCache.downloadSources = sources;
      setDownloadSources(sources);
    });
  }, []);

  useEffect(() => {
    getSteamFilters();
    getSteamPublishers();
    getSteamDevelopers();
    getDownloadSources();
  }, [
    getSteamFilters,
    getSteamPublishers,
    getSteamDevelopers,
    getDownloadSources,
  ]);

  return {
    steamPublishers: steamPublishers ?? [],
    downloadSources: downloadSources ?? [],
    steamDevelopers: steamDevelopers ?? [],
    loadingLists: {
      publishers: steamPublishers === null,
      developers: steamDevelopers === null,
      downloadSources: downloadSources === null,
    },
  };
}
