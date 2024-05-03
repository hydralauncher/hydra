import { JSDOM } from "jsdom";

import { Repack } from "@main/entity";
import { logger } from "../logger";
import { requestWebPage, savePage } from "./helpers";

import createWorker from "@main/workers/torrent-parser.worker?nodeWorker";
import { toMagnetURI } from "parse-torrent";
import type { Instance } from "parse-torrent";

const worker = createWorker({});

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

// prettier-ignore
const getXatabRepack = async (url: string) => {
  const data = await requestWebPage(url);
  const { window } = new JSDOM(data);
  const { document } = window;

  const uploadDate = document.querySelector(".entry__date")?.textContent ?? "";
  const size = document.querySelector(".entry__info-size")?.textContent ?? "";

  const $downloadButton = document.querySelector<HTMLAnchorElement>(".download-torrent[href]");
  if (!$downloadButton) throw new Error("Download button not found");

  const { promise, resolve, reject } = Promise.withResolvers<Partial<Repack>>();

  worker.once("error", reject);
  worker.once("message", (torrent: Instance) => {
    resolve({
      fileSize: formatXatabDownloadSize(size).toUpperCase(),
      magnet: toMagnetURI(torrent),
      uploadDate: formatXatabDate(uploadDate),
    });
  });

  worker.postMessage($downloadButton.href);
  return await promise;
};

export const getNewRepacksFromXatab = async (
  existingRepacks: Repack[] = [],
  page = 1,
): Promise<void> => {
  const data = await requestWebPage(`https://byxatab.com/page/${page}`);

  const { window } = new JSDOM(data);
  const { document } = window;

  const repacks: Repack[] = [];

  const entries =
    document.querySelectorAll<HTMLAnchorElement>(".entry__title a");

  for (const { textContent: title, href } of entries) {
    const repack: Partial<Repack> = {
      repacker: "Xatab",
      title: title!,
      page,
    };

    try {
      Object.assign(repack, await getXatabRepack(href));
    } catch (err: unknown) {
      let msg = "An error occurred while parsing Xatab repack";
      if (err instanceof Error) msg = err.message;

      logger.error(msg, { method: "getNewRepacksFromXatab" });
      continue;
    }

    repacks.push(<Repack>repack);
  }

  const newRepacks = repacks.filter(
    (repack) =>
      !existingRepacks.some(
        (existingRepack) => existingRepack.title === repack.title,
      ),
  );

  if (!newRepacks.length) return;

  await savePage(newRepacks);
  return getNewRepacksFromXatab(existingRepacks, page + 1);
};
