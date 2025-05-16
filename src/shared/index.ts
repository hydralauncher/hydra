import {
  ptBR,
  enUS,
  es,
  fr,
  pl,
  hu,
  tr,
  ru,
  it,
  be,
  zhCN,
  da,
} from "date-fns/locale";

import { charMap } from "./char-map";
import { Downloader } from "./constants";
import { format } from "date-fns";
import { AchievementNotificationInfo } from "@types";

export * from "./constants";

export class UserNotLoggedInError extends Error {
  constructor() {
    super("user not logged in");
    this.name = "UserNotLoggedInError";
  }
}

export class SubscriptionRequiredError extends Error {
  constructor() {
    super("user does not have hydra cloud subscription");
    this.name = "SubscriptionRequiredError";
  }
}

const FORMAT = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || isNaN(bytes) || bytes <= 0) {
    return `0 ${FORMAT[0]}`;
  }

  const byteKBase = 1024;

  const base = Math.floor(Math.log(bytes) / Math.log(byteKBase));

  const formatedByte = bytes / byteKBase ** base;

  return `${Math.trunc(formatedByte * 10) / 10} ${FORMAT[base]}`;
};

export const formatBytesToMbps = (bytesPerSecond: number): string => {
  const bitsPerSecond = bytesPerSecond * 8;
  const mbps = bitsPerSecond / (1024 * 1024);
  return `${Math.trunc(mbps * 10) / 10} Mbps`;
};

export const pipe =
  <T>(...fns: ((arg: T) => any)[]) =>
  (arg: T) =>
    fns.reduce((prev, fn) => fn(prev), arg);

export const removeReleaseYearFromName = (name: string) =>
  name.replace(/\(\d{4}\)/g, "");

export const removeSymbolsFromName = (name: string) =>
  name.replace(/[^A-Za-z 0-9]/g, "");

export const removeSpecialEditionFromName = (name: string) =>
  name.replace(
    /(The |Digital )?(GOTY|Deluxe|Standard|Ultimate|Definitive|Enhanced|Collector's|Premium|Digital|Limited|Game of the Year|Reloaded|[0-9]{4}) Edition/gi,
    ""
  );

export const removeDuplicateSpaces = (name: string) =>
  name.replace(/\s{2,}/g, " ");

export const replaceDotsWithSpace = (name: string) => name.replace(/\./g, " ");

export const replaceNbspWithSpace = (name: string) =>
  name.replace(new RegExp(String.fromCharCode(160), "g"), " ");

export const replaceUnderscoreWithSpace = (name: string) =>
  name.replace(/_/g, " ");

export const formatName = pipe<string>(
  (str) =>
    str.replace(
      new RegExp(Object.keys(charMap).join("|"), "g"),
      (match) => charMap[match]
    ),
  (str) => str.toLowerCase(),
  removeReleaseYearFromName,
  removeSpecialEditionFromName,
  replaceUnderscoreWithSpace,
  replaceDotsWithSpace,
  replaceNbspWithSpace,
  (str) => str.replace(/DIRECTOR'S CUT/gi, ""),
  (str) => str.replace(/Friend's Pass/gi, ""),
  removeSymbolsFromName,
  removeDuplicateSpaces,
  (str) => str.trim()
);

const realDebridHosts = ["https://1fichier.com", "https://mediafire.com"];

export const getDownloadersForUri = (uri: string) => {
  if (uri.startsWith("https://gofile.io")) return [Downloader.Gofile];

  if (uri.startsWith("https://pixeldrain.com")) return [Downloader.PixelDrain];
  if (uri.startsWith("https://qiwi.gg")) return [Downloader.Qiwi];
  if (uri.startsWith("https://datanodes.to")) return [Downloader.Datanodes];
  if (uri.startsWith("https://www.mediafire.com"))
    return [Downloader.Mediafire];

  if (realDebridHosts.some((host) => uri.startsWith(host)))
    return [Downloader.RealDebrid];

  if (uri.startsWith("magnet:")) {
    return [
      Downloader.Torrent,
      Downloader.Hydra,
      Downloader.TorBox,
      Downloader.RealDebrid,
    ];
  }

  return [];
};

export const getDownloadersForUris = (uris: string[]) => {
  const downloadersSet = uris.reduce<Set<Downloader>>((prev, next) => {
    const downloaders = getDownloadersForUri(next);
    downloaders.forEach((downloader) => prev.add(downloader));

    return prev;
  }, new Set());

  return Array.from(downloadersSet);
};

export const steamUrlBuilder = {
  library: (objectId: string) =>
    `https://steamcdn-a.akamaihd.net/steam/apps/${objectId}/header.jpg`,
  libraryHero: (objectId: string) =>
    `https://steamcdn-a.akamaihd.net/steam/apps/${objectId}/library_hero.jpg`,
  logo: (objectId: string) =>
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${objectId}/logo.png`,
  cover: (objectId: string) =>
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${objectId}/library_600x900.jpg`,
  icon: (objectId: string, clientIcon: string) =>
    `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${objectId}/${clientIcon}.ico`,
};

export const getDateLocale = (language: string) => {
  if (language.startsWith("pt")) return ptBR;
  if (language.startsWith("es")) return es;
  if (language.startsWith("fr")) return fr;
  if (language.startsWith("hu")) return hu;
  if (language.startsWith("pl")) return pl;
  if (language.startsWith("tr")) return tr;
  if (language.startsWith("ru")) return ru;
  if (language.startsWith("it")) return it;
  if (language.startsWith("be")) return be;
  if (language.startsWith("zh")) return zhCN;
  if (language.startsWith("da")) return da;

  return enUS;
};

export const formatDate = (
  date: number | Date | string,
  language: string
): string => {
  if (isNaN(new Date(date).getDate())) return "N/A";
  return format(date, language == "en" ? "MM-dd-yyyy" : "dd/MM/yyyy");
};

export const generateAchievementCustomNotificationTest = (
  t: any,
  language?: string
): AchievementNotificationInfo => {
  return {
    title: t("test_achievement_notification_title", {
      ns: "notifications",
      lng: language ?? "en",
    }),
    description: t("test_achievement_notification_description", {
      ns: "notifications",
      lng: language ?? "en",
    }),
    iconUrl: "https://cdn.losbroxas.org/favicon.svg",
    points: 100,
    isHidden: false,
    isRare: false,
    isPlatinum: false,
  };
};
