import axios from "axios";
import UserAgent from "user-agents";

export const getSteamAppAsset = (
  category: "library" | "hero" | "logo" | "icon",
  objectID: string,
  clientIcon?: string
) => {
  if (category === "library")
    return `https://steamcdn-a.akamaihd.net/steam/apps/${objectID}/header.jpg`;

  if (category === "hero")
    return `https://steamcdn-a.akamaihd.net/steam/apps/${objectID}/library_hero.jpg`;

  if (category === "logo")
    return `https://cdn.cloudflare.steamstatic.com/steam/apps/${objectID}/logo.png`;

  return `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${objectID}/${clientIcon}.ico`;
};

export const getFileBuffer = async (url: string) =>
  fetch(url, { method: "GET" }).then((response) =>
    response.arrayBuffer().then((buffer) => Buffer.from(buffer))
  );

export const getFileBase64 = async (url: string) =>
  fetch(url, { method: "GET" }).then((response) =>
    response.arrayBuffer().then((buffer) => {
      const base64 = Buffer.from(buffer).toString("base64");
      const contentType = response.headers.get("content-type");

      return `data:${contentType};base64,${base64}`;
    })
  );

export const steamUrlBuilder = {
  library: (objectID: string) =>
    `https://steamcdn-a.akamaihd.net/steam/apps/${objectID}/header.jpg`,
  libraryHero: (objectID: string) =>
    `https://steamcdn-a.akamaihd.net/steam/apps/${objectID}/library_hero.jpg`,
  logo: (objectID: string) =>
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${objectID}/logo.png`,
};

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const requestWebPage = async (url: string) => {
  const userAgent = new UserAgent();

  return axios
    .get(url, {
      headers: {
        "User-Agent": userAgent.toString(),
      },
    })
    .then((response) => response.data);
};

export * from "./download-source";
