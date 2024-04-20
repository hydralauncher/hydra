import { JSDOM } from "jsdom";

import parseTorrent, { toMagnetURI } from "parse-torrent";

import { Repack } from "@main/entity";
import { logger } from "../logger";
import { requestWebPage, savePage } from "./helpers";
import type { GameRepackInput } from "./helpers";

const getTorrentBuffer = (url: string) =>
  fetch(url, { method: "GET" }).then((response) =>
    response.arrayBuffer().then((buffer) => Buffer.from(buffer))
  );

const formatXatabDate = (str: string) => {
  const date = new Date();

  const [day, month, year] = str.split(".");

  date.setDate(Number(day));
  date.setMonth(Number(month) - 1);
  date.setFullYear(Number(year));
  date.setHours(0, 0, 0, 0);

  return date;
};

const formatXatabDownloadSize = (str: string) =>
  str.replace(",", ".").replace(/Гб/g, "GB").replace(/Мб/g, "MB");

const getXatabRepack = async (url: string) => {
  const data = await requestWebPage(url);
  const { window } = new JSDOM(data);

  const $uploadDate = window.document.querySelector(".entry__date");
  const $size = window.document.querySelector(".entry__info-size");

  const $downloadButton = window.document.querySelector(
    ".download-torrent"
  ) as HTMLAnchorElement;

  if (!$downloadButton) throw new Error("Download button not found");

  const torrentBuffer = await getTorrentBuffer($downloadButton.href);
  console.log(url);
  console.log(torrentBuffer.byteLength);

  return {
    fileSize: formatXatabDownloadSize($size.textContent).toUpperCase(),
    magnet: toMagnetURI({
      infoHash: parseTorrent(torrentBuffer).infoHash,
    }),
    uploadDate: formatXatabDate($uploadDate.textContent),
  };
};

export const getNewRepacksFromXatab = async (
  existingRepacks: Repack[] = [],
  page = 1
): Promise<void> => {
  const data = await requestWebPage(`https://byxatab.com/page/${page}`);

  const { window } = new JSDOM(data);

  const repacks: GameRepackInput[] = [];

  for (const $a of Array.from(
    window.document.querySelectorAll(".entry__title a")
  )) {
    try {
      const repack = await getXatabRepack(($a as HTMLAnchorElement).href);

      repacks.push({
        title: $a.textContent,
        repacker: "Xatab",
        ...repack,
        page,
      });
    } catch (err) {
      logger.error(err.message, { method: "getNewRepacksFromXatab" });
    }
  }

  const newRepacks = repacks.filter(
    (repack) =>
      repack.uploadDate &&
      !existingRepacks.some(
        (existingRepack) => existingRepack.title === repack.title
      )
  );

  if (!newRepacks.length) return;

  await savePage(newRepacks);

  return getNewRepacksFromXatab(existingRepacks, page + 1);
};
