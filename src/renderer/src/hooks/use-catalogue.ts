import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { useAppDispatch } from "./redux";
import { setGenres, setTags } from "@renderer/features";
import type { DownloadSource } from "@types";

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
    });
  }, [dispatch]);

  const getSteamGenres = useCallback(() => {
    externalResourcesInstance.get("/steam-genres.json").then((response) => {
      dispatch(setGenres(response.data));
    });
  }, [dispatch]);

  const getSteamPublishers = useCallback(() => {
    externalResourcesInstance.get("/steam-publishers.json").then((response) => {
      setSteamPublishers(response.data);
    });
  }, []);

  const getSteamDevelopers = useCallback(() => {
    externalResourcesInstance.get("/steam-developers.json").then((response) => {
      setSteamDevelopers(response.data);
    });
  }, []);

  const getDownloadSources = useCallback(() => {
    window.electron.getDownloadSources().then((results) => {
      setDownloadSources(results.filter((source) => !!source.fingerprint));
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
