import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { DownloadSource } from "@types";
import { useAppDispatch } from "./redux";
import { setGenres, setTags } from "@renderer/features";

const EXTERNAL_RESOURCES_BASE_URL =
  import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL ||
  "https://assets.hydralauncher.gg";

export const externalResourcesInstance = axios.create({
  baseURL: EXTERNAL_RESOURCES_BASE_URL,
});

export function useCatalogue() {
  const dispatch = useAppDispatch();

  const [steamPublishers, setSteamPublishers] = useState<string[]>([]);
  const [steamDevelopers, setSteamDevelopers] = useState<string[]>([]);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);

  const getSteamUserTags = useCallback(() => {
    if (!EXTERNAL_RESOURCES_BASE_URL) return;
    externalResourcesInstance
      .get("/steam-user-tags.json")
      .then((response) => {
        if (response.data && typeof response.data === "object") {
          dispatch(setTags(response.data));
        }
      })
      .catch(() => {});
  }, [dispatch]);

  const getSteamGenres = useCallback(() => {
    if (!EXTERNAL_RESOURCES_BASE_URL) return;
    externalResourcesInstance
      .get("/steam-genres.json")
      .then((response) => {
        if (response.data && typeof response.data === "object") {
          dispatch(setGenres(response.data));
        }
      })
      .catch(() => {});
  }, [dispatch]);

  const getSteamPublishers = useCallback(() => {
    if (!EXTERNAL_RESOURCES_BASE_URL) return;
    externalResourcesInstance
      .get("/steam-publishers.json")
      .then((response) => {
        if (Array.isArray(response.data)) {
          setSteamPublishers(response.data);
        }
      })
      .catch(() => {});
  }, []);

  const getSteamDevelopers = useCallback(() => {
    if (!EXTERNAL_RESOURCES_BASE_URL) return;
    externalResourcesInstance
      .get("/steam-developers.json")
      .then((response) => {
        if (Array.isArray(response.data)) {
          setSteamDevelopers(response.data);
        }
      })
      .catch(() => {});
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
