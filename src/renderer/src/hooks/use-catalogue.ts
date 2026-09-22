import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { DownloadSource } from "@types";
import { useAppDispatch, useAppSelector } from "./redux";
import { setGenres, setTags } from "@renderer/features";

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

  const [steamPublishers, setSteamPublishers] = useState<string[]>([]);
  const [steamDevelopers, setSteamDevelopers] = useState<string[]>([]);
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
    setSteamPublishers([]);
    setSteamDevelopers([]);
    setPublishedGenres([]);
    const shops = pcShop === "all" ? (["steam", "epic"] as const) : [pcShop];

    Promise.all(
      shops.map(async (shop) => {
        const [genres, developers, publishers] = await Promise.all([
          window.electron.hydraApi.get<string[]>(`/catalogue/${shop}/genres`, {
            needsAuth: false,
          }),
          window.electron.hydraApi.get<string[]>(
            `/catalogue/${shop}/developers`,
            { needsAuth: false }
          ),
          window.electron.hydraApi.get<string[]>(
            `/catalogue/${shop}/publishers`,
            { needsAuth: false }
          ),
        ]);

        return { genres, developers, publishers };
      })
    )
      .then((filtersByShop) => {
        if (!current) return;
        const merge = (key: "genres" | "developers" | "publishers") => [
          ...new Set(filtersByShop.flatMap((filters) => filters[key])),
        ];

        setSteamPublishers(merge("publishers"));
        setSteamDevelopers(merge("developers"));
        setPublishedGenres(merge("genres"));
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

  return { steamPublishers, downloadSources, steamDevelopers, publishedGenres };
}
