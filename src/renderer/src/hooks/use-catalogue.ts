import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { DownloadSource } from "@types";
import { useAppDispatch, useAppSelector } from "./redux";
import { setGenres, setTags } from "@renderer/features";
import { loadCatalogueStoreFilters } from "@shared";

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

export function useCatalogue() {
  const dispatch = useAppDispatch();
  const pcShop = useAppSelector((state) => state.catalogueSearch.pcShop);
  const [publishedGenres, setPublishedGenres] = useState<string[]>([]);
  const { i18n } = useTranslation();

  const [publishers, setPublishers] = useState<string[]>([]);
  const [developers, setDevelopers] = useState<string[]>([]);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);

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

  useEffect(() => {
    let current = true;
    setPublishers([]);
    setDevelopers([]);
    setPublishedGenres([]);
    loadCatalogueStoreFilters(
      pcShop,
      (path) =>
        window.electron.hydraApi.get<string[]>(path, { needsAuth: false }),
      (path, error) => console.error(`Failed to load ${path}`, error)
    )
      .then(({ genres, developers, publishers }) => {
        if (!current) return;
        setPublishers(publishers);
        setDevelopers(developers);
        setPublishedGenres(genres);
      })
      .catch(console.error);
    return () => {
      current = false;
    };
  }, [pcShop]);

  const getDownloadSources = useCallback(() => {
    levelDBService.values("downloadSources").then((results) => {
      const sources = results as DownloadSource[];
      setDownloadSources(sources.filter((source) => !!source.fingerprint));
    });
  }, []);

  useEffect(() => {
    getSteamFilters();
    getDownloadSources();
  }, [getSteamFilters, getDownloadSources]);

  return { publishers, downloadSources, developers, publishedGenres };
}
