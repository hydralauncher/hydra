export enum Downloader {
  RealDebrid,
  Torrent,
}

export enum DownloadSourceStatus {
  UpToDate,
  Errored,
}

export class UserNotLoggedInError extends Error {
  constructor() {
    super("user not logged in");
    this.name = "UserNotLoggedInError";
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

export const pipe =
  <T>(...fns: ((arg: T) => any)[]) =>
  (arg: T) =>
    fns.reduce((prev, fn) => fn(prev), arg);

export const removeReleaseYearFromName = (name: string) =>
  name.replace(/\([0-9]{4}\)/g, "");

export const removeSymbolsFromName = (name: string) =>
  name.replace(/[^A-Za-z 0-9]/g, "");

export const removeSpecialEditionFromName = (name: string) =>
  name.replace(
    /(The |Digital )?(GOTY|Deluxe|Standard|Ultimate|Definitive|Enhanced|Collector's|Premium|Digital|Limited|Game of the Year|Reloaded|[0-9]{4}) Edition/g,
    ""
  );

export const removeDuplicateSpaces = (name: string) =>
  name.replace(/\s{2,}/g, " ");

export const formatName = pipe<string>(
  removeReleaseYearFromName,
  removeSymbolsFromName,
  removeSpecialEditionFromName,
  removeDuplicateSpaces,
  (str) => str.trim()
);
