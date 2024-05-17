import { JSDOM } from "jsdom";

import { Repack } from "@main/entity";
import { logger } from "../logger";
import { requestWebPage, savePage } from "./helpers";

import createWorker from "@main/workers/torrent-parser.worker?nodeWorker";
import { toMagnetURI } from "parse-torrent";
import type { Instance } from "parse-torrent";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { formatBytes } from "@shared";
import { getFileBuffer } from "@main/helpers";

const worker = createWorker({});
worker.setMaxListeners(11);

let totalPages = 1;

const formatXatabDate = (str: string) => {
  const date = new Date();

  const [day, month, year] = str.split(".");

  date.setDate(Number(day));
  date.setMonth(Number(month) - 1);
  date.setFullYear(Number(year));
  date.setHours(0, 0, 0, 0);

  return date;
};

const getXatabRepack = (
  url: string
): Promise<{ fileSize: string; magnet: string; uploadDate: Date } | null> => {
  return new Promise((resolve) => {
    (async () => {
      const data = await requestWebPage(url);
      const { window } = new JSDOM(data);
      const { document } = window;

      const $uploadDate = document.querySelector(".entry__date");

      const $downloadButton = document.querySelector(
        ".download-torrent"
      ) as HTMLAnchorElement;

      if (!$downloadButton) return resolve(null);

      worker.once("message", (torrent: Instance | null) => {
        if (!torrent) return resolve(null);

        resolve({
          fileSize: formatBytes(torrent.length ?? 0),
          magnet: toMagnetURI(torrent),
          uploadDate: formatXatabDate($uploadDate!.textContent!),
        });
      });

      const buffer = await getFileBuffer($downloadButton.href);
      worker.postMessage(buffer);
    })();
  });
};

export const getNewRepacksFromXatab = async (
  existingRepacks: Repack[] = [],
  page = 1
): Promise<void> => {
  const data = await requestWebPage(`https://byxatab.com/page/${page}`);

  const { window } = new JSDOM(data);

  const repacks: QueryDeepPartialEntity<Repack>[] = [];

  if (page === 1) {
    totalPages = Number(
      window.document.querySelector(
        "#bottom-nav > div.pagination > a:nth-child(12)"
      )?.textContent
    );
  }

  const repacksFromPage = Array.from(
    window.document.querySelectorAll(".entry__title a")
  ).map(($a) => {
    return getXatabRepack(($a as HTMLAnchorElement).href)
      .then((repack) => {
        if (repack) {
          repacks.push({
            title: $a.textContent!,
            repacker: "Xatab",
            ...repack,
            page,
          });
        }
      })
      .catch((err: unknown) => {
        logger.error((err as Error).message, {
          method: "getNewRepacksFromXatab",
        });
      });
  });

  await Promise.all(repacksFromPage);

  const newRepacks = repacks.filter(
    (repack) =>
      !existingRepacks.some(
        (existingRepack) => existingRepack.title === repack.title
      )
  );

  if (!newRepacks.length) return;
  if (page === totalPages) return;

  await savePage(newRepacks);

  return getNewRepacksFromXatab(existingRepacks, page + 1);
};
