import axios from "axios";
import { JSDOM } from "jsdom";
import shuffle from "lodash/shuffle";

export const requestSteam250 = async (path: string) => {
  return axios.get(`https://steam250.com${path}`).then((response) => {
    const { window } = new JSDOM(response.data);
    const { document } = window;

    return Array.from(document.querySelectorAll(".appline .title a")).map(
      ($title: HTMLAnchorElement) => {
        const steamGameUrl = $title.href;
        if (!steamGameUrl) return null;

        return {
          title: $title.textContent,
          objectID: steamGameUrl.split("/").pop(),
        };
      }
    );
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
