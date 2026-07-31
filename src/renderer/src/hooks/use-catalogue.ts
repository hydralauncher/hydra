import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { DownloadSource } from "@types";
import { useAppDispatch } from "./redux";
import { setGenres, setTags } from "@renderer/features";

export const externalResourcesInstance = axios.create({
  baseURL: import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL,
});

export function useCatalogue() {
  const dispatch = useAppDispatch();

  const [steamPublishers, setSteamPublishers] = useState<string[]>([]);
  const [steamDevelopers, setSteamDevelopers] = useState<string[]>([]);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);

  const getSteamUserTags = useCallback(() => {
    externalResourcesInstance.get("/steam-user-tags.json").then((response) => {
      dispatch(setTags(response.data));
    }).catch(() => {});
  }, [dispatch]);

  const getSteamGenres = useCallback(() => {
    externalResourcesInstance.get("/steam-genres.json").then((response) => {
      dispatch(setGenres(response.data));
    }).catch(() => {});
  }, [dispatch]);

  const getSteamPublishers = useCallback(() => {
    externalResourcesInstance.get("/steam-publishers.json").then((response) => {
      if (Array.isArray(response.data)) {
        setSteamPublishers(response.data);
      }
    }).catch(() => {});
  }, []);

  const getSteamDevelopers = useCallback(() => {
    externalResourcesInstance.get("/steam-developers.json").then((response) => {
      if (Array.isArray(response.data)) {
        setSteamDevelopers(response.data);
      }
    }).catch(() => {});
  }, []);

  const getDownloadSources = useCallback(() => {
    levelDBService.values("downloadSources").then((results) => {
      const sources = results as DownloadSource[];
      setDownloadSources(sources.filter((source) => !!source.fingerprint));
    });
  }, []);

  useEffect(() => {
    getSteamUserTags();
    getSteamGenres();
    getSteamPublishers();
    getSteamDevelopers();
    getDownloadSources();
  }, [
    getSteamUserTags,
    getSteamGenres,
    getSteamPublishers,
    getSteamDevelopers,
    getDownloadSources,
  ]);

  return { steamPublishers, downloadSources, steamDevelopers };
}
