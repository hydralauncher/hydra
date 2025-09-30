import axios from "axios";
import { JSDOM } from "jsdom";

import type { Steam250Game } from "@types";

export const requestSteam250 = async (path: string) => {
  return axios
    .get(`https://steam250.com${path}`)
    .then((response) => {
      const { window } = new JSDOM(response.data);
      const { document } = window;

      return Array.from(document.querySelectorAll("a[data-title]"))
        .map(($title) => {
          const steamGameUrl = ($title as HTMLAnchorElement).href;
          if (!steamGameUrl) return null;

          return {
            title: $title.textContent,
            objectId: steamGameUrl.split("/").pop(),
          } as Steam250Game;
        })
        .filter((game) => game != null);
    })
    .catch((_) => [] as Steam250Game[]);
};

const steam250Paths = [
  "/hidden_gems",
  `/${new Date().getFullYear()}`,
  "/top250",
  "/most_played",
];

export const getSteam250List = async () => {
  const gamesList = (
    await Promise.all(steam250Paths.map((path) => requestSteam250(path)))
  ).flat();

  const gamesMap: Map<string, Steam250Game> = gamesList.reduce((map, item) => {
    if (item) map.set(item.objectId, item);

    return map;
  }, new Map());

  return [...gamesMap.values()];
};
