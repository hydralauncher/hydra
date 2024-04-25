import axios from "axios";
import { JSDOM } from "jsdom";
import { shuffle } from "lodash-es";

export const requestSteam250 = async (path: string) => {
  return axios.get(`https://steam250.com${path}`).then((response) => {
    const { window } = new JSDOM(response.data);
    const { document } = window;

    return Array.from(document.querySelectorAll(".appline .title a"))
      .filter(($title) => Boolean(($title as HTMLAnchorElement).href))
      .map(($title) => {
        const steamGameUrl = ($title as HTMLAnchorElement).href;

        return {
          title: $title.textContent,
          objectID: steamGameUrl.split("/").pop(),
        };
      });
  });
};

const steam250Paths = [
  "/hidden_gems",
  `/${new Date().getFullYear()}`,
  "/top250",
  "/most_played",
];

export const getRandomSteam250List = async () => {
  const [path] = shuffle(steam250Paths);
  return requestSteam250(path);
};
