import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { DownloadSource } from "@types";
import { useAppDispatch } from "./redux";
import { setGenres, setTags } from "@renderer/features";
import {
  getLocalizedGenres,
  getLocalizedSteamMetadata,
} from "./localized-steam-metadata";

export function useCatalogue() {
  const dispatch = useAppDispatch();
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
      getLocalizedGenres(i18n.language),
    ]);

    dispatch(setTags(tags));
    dispatch(setGenres(genres));
  }, [dispatch, i18n.language]);

  const getSteamPublishers = useCallback(() => {
    window.electron.hydraApi
      .get<string[]>("/catalogue/steam/publishers", { needsAuth: false })
      .then(setSteamPublishers);
  }, []);

  const getSteamDevelopers = useCallback(() => {
    window.electron.hydraApi
      .get<string[]>("/catalogue/steam/developers", { needsAuth: false })
      .then(setSteamDevelopers);
  }, []);

  const getDownloadSources = useCallback(() => {
    levelDBService.values("downloadSources").then((results) => {
      const sources = results as DownloadSource[];
      setDownloadSources(sources.filter((source) => !!source.fingerprint));
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

  return { steamPublishers, downloadSources, steamDevelopers };
}
