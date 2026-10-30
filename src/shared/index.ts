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
  el,
  vi,
  ja,
  sl,
} from "date-fns/locale";

import { isArchiveOrgFileUri } from "./archive-org";
import {
  getUriGroupParts,
  normalizeUriGroups,
  withoutMultipartHosterDownloads,
} from "./repack-uri-groups";
import { charMap } from "./char-map";
import { Downloader } from "./constants";
import { format } from "date-fns";
import { AchievementNotificationInfo, GameRepack } from "@types";

export * from "./archive-org";
export * from "./constants";
export {
  shouldAutoStartSteamSync,
  type SteamAutoStartRunStatus,
} from "./should-auto-start-steam-sync";
export * from "./steam-session";
export * from "./leaderboard-notifications";
export * from "./window-layout";
export * from "./review-translation";
export {
  getDisplayedPlayTimeInMilliseconds,
  getPlayTimeHoursAndMinutes,
  mergeLocalAndRemotePlayTime,
} from "./playtime";
export * from "./cloud-save-access";
export * from "./cloud-save-emulator-provider";
export * from "./screenshot-input";
export * from "./profile-friends";
export * from "./classics-disc-label";
export {
  MULTIPART_DOWNLOADERS,
  MULTIPART_HOSTER_DOWNLOADS_FEATURE,
} from "./repack-uri-groups";
export * from "./controller-support";
export * from "./artwork-resolver";
export * from "./library-catalogue";
export * from "./finished-download-step";
export * from "./format-bit-rate";
export * from "./library-group-actions";
export * from "./official-store-options";
export * from "./download-directories";
export * from "./comment-html-sanitizer";
export * from "./html-sanitizer";
export * from "./language-flags";
export * from "./use-hls-video";
export * from "./use-souvenir-content-warning";
export * from "./retroarch-platform";
export * from "./platform-to-system";
export * from "./classics-emulator-games";
export * from "./tracker-list";
export * from "./souvenirs";
export * from "./souvenir-sync";
export * from "./screenshot-preferences";
export * from "./screenshot-moderation";
export * from "./screenshot-upload-outcome";
export * from "./screenshots";
export * from "./screenshot-feed-writes";
export * from "./screenshot-feed-ledger";
export * from "./screenshot-image-refresh";
export * from "./screenshot-spoiler-paging";
export * from "./screenshot-write-bus";
export * from "./screenshot-settings";
export * from "./screenshot-date-groups";
export * from "./screenshot-thumb-hash";
export * from "./my-game-screenshots";
export * from "./use-screenshot-image-fallback";
export * from "./rich-text";
export * from "./local-screenshots";
export * from "./achievement-list";

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

export const parseBytes = (sizeString: string | null): number | null => {
  if (!sizeString) return null;

  const regex = /^([\d.,]+)\s*([A-Za-z]+)$/;
  const match = regex.exec(sizeString.trim());
  if (!match) return null;

  const value = Number.parseFloat(match[1].replaceAll(",", "."));
  const unit = match[2].toUpperCase();

  if (Number.isNaN(value)) return null;

  const unitIndex = FORMAT.indexOf(unit);
  if (unitIndex === -1) return null;

  const byteKBase = 1024;
  return Math.round(value * Math.pow(byteKBase, unitIndex));
};

export const formatBytesToMbps = (bytesPerSecond: number): string => {
  const bitsPerSecond = bytesPerSecond * 8;
  const mbps = bitsPerSecond / 1e6;
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

const charMapPattern = new RegExp(Object.keys(charMap).join("|"), "g");

const COMBINING_MARKS = /[\u0300-\u036f]/g;

export const removeDiacritics = (value: string) =>
  value
    .normalize("NFC")
    .replace(charMapPattern, (match) => charMap[match])
    .normalize("NFD")
    .replace(COMBINING_MARKS, "");

export const formatName = pipe<string>(
  (str) => str.replace(charMapPattern, (match) => charMap[match]),
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
  if (uri.startsWith("https://datanodes.to")) return [Downloader.Datanodes];
  if (uri.startsWith("https://www.mediafire.com"))
    return [Downloader.Mediafire];
  if (
    uri.startsWith("https://fuckingfast.co") ||
    uri.startsWith("https://fuckingfast.net")
  ) {
    return [Downloader.FuckingFast];
  }
  if (
    uri.startsWith("https://vikingfile.com") ||
    uri.startsWith("https://vik1ngfile.site")
  ) {
    return [Downloader.VikingFile];
  }
  if (uri.startsWith("https://www.rootz.so")) {
    return [Downloader.Rootz];
  }
  if (uri.startsWith("https://filekeeper.net/")) {
    return [Downloader.FileKeeper];
  }
  if (isArchiveOrgFileUri(uri)) {
    return [Downloader.ArchiveOrg];
  }

  if (realDebridHosts.some((host) => uri.startsWith(host)))
    return [Downloader.RealDebrid];

  if (uri.startsWith("magnet:")) {
    return [
      Downloader.Torrent,
      Downloader.Hydra,
      Downloader.TorBox,
      Downloader.RealDebrid,
      Downloader.Premiumize,
      Downloader.AllDebrid,
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

export const getRepackUriParts = getUriGroupParts;

export const filterDownloadableRepacks = <
  T extends Pick<GameRepack, "uris" | "uriGroups">,
>(
  repacks: T[],
  multipartHosterDownloads: boolean
) =>
  repacks
    .map((repack) =>
      multipartHosterDownloads
        ? normalizeUriGroups(repack, getDownloadersForUri)
        : withoutMultipartHosterDownloads(repack)
    )
    .filter(
      (repack) =>
        Array.isArray(repack.uris) &&
        getDownloadersForUris(repack.uris).length > 0
    );

const AVAILABILITY_CHECK_DOWNLOADERS = new Set<Downloader>([
  Downloader.VikingFile,
]);

export const HOSTER_AVAILABILITY_MAX_URLS = 50;

export interface HosterAvailabilityResult {
  url: string;
  available: boolean;
}

export const supportsHosterAvailabilityCheck = (uri: string) =>
  getDownloadersForUri(uri).some((downloader) =>
    AVAILABILITY_CHECK_DOWNLOADERS.has(downloader)
  );

export const collectHosterAvailabilityUris = (
  repacks: Pick<GameRepack, "uris">[]
) => {
  const uris = new Set<string>();

  for (const repack of repacks) {
    if (!Array.isArray(repack.uris)) continue;

    for (const uri of repack.uris) {
      if (supportsHosterAvailabilityCheck(uri)) uris.add(uri);
    }
  }

  return Array.from(uris).slice(0, HOSTER_AVAILABILITY_MAX_URLS);
};

export const fetchHosterAvailability = async (
  repacks: Pick<GameRepack, "uris">[],
  post: <T>(url: string, data: unknown) => Promise<T>
): Promise<HosterAvailabilityResult[]> => {
  const urls = collectHosterAvailabilityUris(repacks);

  if (urls.length === 0) return [];

  try {
    const response = await post<{ results?: HosterAvailabilityResult[] }>(
      "/hosters/availability",
      { urls }
    );

    return Array.isArray(response?.results) ? response.results : [];
  } catch {
    return [];
  }
};

export const applyHosterAvailability = <
  T extends Pick<GameRepack, "uris" | "unavailableUris">,
>(
  repacks: T[],
  results: HosterAvailabilityResult[]
): T[] => {
  const unavailable = new Set(
    results.filter((result) => !result.available).map((result) => result.url)
  );

  if (unavailable.size === 0) return repacks;

  return repacks.map((repack) => {
    const extra = (Array.isArray(repack.uris) ? repack.uris : []).filter(
      (uri) => unavailable.has(uri) && !repack.unavailableUris?.includes(uri)
    );

    if (extra.length === 0) return repack;

    return {
      ...repack,
      unavailableUris: [...(repack.unavailableUris ?? []), ...extra],
    };
  });
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
  if (language.startsWith("el")) return el;
  if (language.startsWith("vi")) return vi;
  if (language.startsWith("ja")) return ja;
  if (language.startsWith("sl")) return sl;

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
  language?: string,
  options: { isHidden?: boolean; isRare?: boolean; isPlatinum?: boolean } = {}
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
    points: 2440,
    isHidden: options.isHidden ?? false,
    isRare: options.isRare ?? false,
    isPlatinum: options.isPlatinum ?? false,
  };
};
export * from "./emulator-systems";
