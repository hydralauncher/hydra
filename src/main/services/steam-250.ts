import axios from "axios";
import { JSDOM } from "jsdom";
import shuffle from "lodash/shuffle";
import { logger } from "./logger";

const requestSteam250 = async (path: string) => {
  return axios
    .get(`https://steam250.com${path}`)
    .then((response) => response.data);
};

export const getTrendingGames = async () => {
  const response = await requestSteam250("/365day").catch((err) => {
    logger.error(err.response, { method: "getTrendingGames" });
    throw new Error(err);
  });

  const { window } = new JSDOM(response);
  const { document } = window;

  return Array.from(document.querySelectorAll(".appline .title a")).map(
    ($title: HTMLAnchorElement) => {
      const steamGameUrld = $title.href;
      if (!steamGameUrld) return null;
      return {
        title: $title.textContent,
        objectID: steamGameUrld.split("/").pop(),
      };
    }
  );
};

const steam250Paths = [
  "/hidden_gems",
  `/${new Date().getFullYear()}`,
  "/top250",
  "/most_played",
];

export const getRandomSteam250List = async () => {
  const [path] = shuffle(steam250Paths);
  const response = await requestSteam250(path).catch((err) => {
    logger.error(err.response, { method: "getRandomSteam250List" });
    throw new Error(err);
  });

  const { window } = new JSDOM(response);
  const { document } = window;

  return Array.from(document.querySelectorAll(".appline .title a")).map(
    ($title) => $title.textContent!
  );
};
