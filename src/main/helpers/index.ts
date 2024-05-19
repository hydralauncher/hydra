import {
  removeReleaseYearFromName,
  removeSymbolsFromName,
  removeSpecialEditionFromName,
  empressFormatter,
  kaosKrewFormatter,
  fitGirlFormatter,
  removeDuplicateSpaces,
  dodiFormatter,
  removeTrash,
  xatabFormatter,
  tinyRepacksFormatter,
  gogFormatter,
  onlinefixFormatter,
} from "./formatters";
import { repackers } from "../constants";

export const pipe =
  <T>(...fns: ((arg: T) => any)[]) =>
  (arg: T) =>
    fns.reduce((prev, fn) => fn(prev), arg);

export const formatName = pipe<string>(
  removeTrash,
  removeReleaseYearFromName,
  removeSymbolsFromName,
  removeSpecialEditionFromName,
  removeDuplicateSpaces,
  (str) => str.trim()
);

export const repackerFormatter: Record<
  (typeof repackers)[number],
  (title: string) => string
> = {
  DODI: dodiFormatter,
  "0xEMPRESS": empressFormatter,
  KaOsKrew: kaosKrewFormatter,
  FitGirl: fitGirlFormatter,
  Xatab: xatabFormatter,
  CPG: (title: string) => title,
  TinyRepacks: tinyRepacksFormatter,
  GOG: gogFormatter,
  onlinefix: onlinefixFormatter,
};

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

export * from "./formatters";
export * from "./ps";
