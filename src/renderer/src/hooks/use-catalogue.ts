import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { DownloadSource } from "@types";
import { useAppDispatch } from "./redux";
import { setGenres, setTags } from "@renderer/features";

export const externalResourcesInstance = axios.create({
  baseURL: import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL,
});

// Silently degrade optional metadata fetches (tags/genres/publishers/
// developers) so a temporary CDN outage doesn't trigger the renderer
// error boundary. Only genuine connectivity failures (network errors,
// aborts, or "no response received") are swallowed - HTTP 4xx/5xx are
// re-thrown so misconfiguration and permission problems stay
// diagnosable. Every consumer reads `response.data` as an array, so
// returning `{ data: [] }` in a full AxiosResponse shape keeps the
// callsites happy and the app usable while the CDN is unreachable.
externalResourcesInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const isNetworkOrTimeout =
      axios.isAxiosError(error) &&
      (error.code === "ERR_NETWORK" ||
        error.code === "ECONNABORTED" ||
        error.response == null);

    if (!isNetworkOrTimeout) return Promise.reject(error);

    console.warn(
      "[external-resources] request failed silently:",
      error?.message ?? error
    );
    return Promise.resolve({
      data: [],
      status: 200,
      statusText: "OK",
      headers: {},
      config: error.config ?? ({} as any),
      request: error.request,
    });
  }
);

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
