import axios from "axios";
import { useCallback, useEffect, useState } from "react";

export const externalResourcesInstance = axios.create({
  baseURL: import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL,
});

export function useCatalogue() {
  const [steamGenres, setSteamGenres] = useState<Record<string, string[]>>({});
  const [steamUserTags, setSteamUserTags] = useState<
    Record<string, Record<string, number>>
  >({});

  const [steamPublishers, setSteamPublishers] = useState<string[]>([]);
  const [steamDevelopers, setSteamDevelopers] = useState<string[]>([]);

  const getSteamUserTags = useCallback(() => {
    externalResourcesInstance.get("/steam-user-tags.json").then((response) => {
      setSteamUserTags(response.data);
    });
  }, []);

  const getSteamGenres = useCallback(() => {
    externalResourcesInstance.get("/steam-genres.json").then((response) => {
      setSteamGenres(response.data);
    });
  }, []);

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

  useEffect(() => {
    getSteamUserTags();
    getSteamGenres();
    getSteamPublishers();
    getSteamDevelopers();
  }, [
    getSteamUserTags,
    getSteamGenres,
    getSteamPublishers,
    getSteamDevelopers,
  ]);

  return { steamGenres, steamUserTags, steamPublishers, steamDevelopers };
}
