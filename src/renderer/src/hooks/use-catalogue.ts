import axios from "axios";
import type { AxiosError } from "axios";
import { useCallback, useEffect, useState } from "react";
import { levelDBService } from "@renderer/services/leveldb.service";
import { logger } from "@renderer/logger";
import type { DownloadSource } from "@types";
import { useAppDispatch } from "./redux";
import { setGenres, setTags } from "@renderer/features";

export const externalResourcesInstance = axios.create({
  baseURL: import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL,
});

const DEGRADABLE_STATUS_CODES = [502, 503, 504];

const isDegradableError = (error: unknown): error is AxiosError => {
  if (!axios.isAxiosError(error)) return false;

  if (error.response) {
    return DEGRADABLE_STATUS_CODES.includes(error.response.status);
  }

  return error.code === "ERR_NETWORK" || error.code === "ECONNABORTED";
};

const keepPreviousDataOnFailure = (resource: string) => (error: unknown) => {
  if (axios.isCancel(error)) return;

  if (!isDegradableError(error)) throw error;

  logger.warn(
    `[external-resources] ${resource} is unavailable, keeping the previously loaded data:`,
    error.message
  );
};

export function useCatalogue() {
  const dispatch = useAppDispatch();

  const [steamPublishers, setSteamPublishers] = useState<string[]>([]);
  const [steamDevelopers, setSteamDevelopers] = useState<string[]>([]);
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);

  const getSteamUserTags = useCallback(() => {
    externalResourcesInstance
      .get("/steam-user-tags.json")
      .then((response) => {
        dispatch(setTags(response.data));
      })
      .catch(keepPreviousDataOnFailure("steam-user-tags"));
  }, [dispatch]);

  const getSteamGenres = useCallback(() => {
    externalResourcesInstance
      .get("/steam-genres.json")
      .then((response) => {
        dispatch(setGenres(response.data));
      })
      .catch(keepPreviousDataOnFailure("steam-genres"));
  }, [dispatch]);

  const getSteamPublishers = useCallback(() => {
    externalResourcesInstance
      .get("/steam-publishers.json")
      .then((response) => {
        setSteamPublishers(response.data);
      })
      .catch(keepPreviousDataOnFailure("steam-publishers"));
  }, []);

  const getSteamDevelopers = useCallback(() => {
    externalResourcesInstance
      .get("/steam-developers.json")
      .then((response) => {
        setSteamDevelopers(response.data);
      })
      .catch(keepPreviousDataOnFailure("steam-developers"));
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
