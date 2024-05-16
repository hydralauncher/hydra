import { Repack } from "@main/entity";
import { decodeNonUtf8Response, savePage } from "./helpers";
import { logger } from "../logger";
import { JSDOM } from "jsdom";

import createWorker from "@main/workers/torrent-parser.worker?nodeWorker";
import { toMagnetURI } from "parse-torrent";

const worker = createWorker({});

import makeFetchCookie from "fetch-cookie";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";
import { formatBytes } from "@shared";

const ONLINE_FIX_URL = "https://online-fix.me/";

export const getNewRepacksFromOnlineFix = async (
  existingRepacks: Repack[] = [],
  page = 1,
  cookieJar = new makeFetchCookie.toughCookie.CookieJar()
): Promise<void> => {
  const hasCredentials =
    import.meta.env.MAIN_VITE_ONLINEFIX_USERNAME &&
    import.meta.env.MAIN_VITE_ONLINEFIX_PASSWORD;
  if (!hasCredentials) return;

  const http = makeFetchCookie(fetch, cookieJar);

  if (page === 1) {
    await http(ONLINE_FIX_URL);

    const preLogin =
      ((await http("https://online-fix.me/engine/ajax/authtoken.php", {
        method: "GET",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Referer: ONLINE_FIX_URL,
        },
      }).then((res) => res.json())) as {
        field: string;
        value: string;
      }) || undefined;

    if (!preLogin.field || !preLogin.value) return;

    const params = new URLSearchParams({
      login_name: import.meta.env.MAIN_VITE_ONLINEFIX_USERNAME,
      login_password: import.meta.env.MAIN_VITE_ONLINEFIX_PASSWORD,
      login: "submit",
      [preLogin.field]: preLogin.value,
    });

    await http(ONLINE_FIX_URL, {
      method: "POST",
      headers: {
        Referer: ONLINE_FIX_URL,
        Origin: ONLINE_FIX_URL,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
  }

  const pageParams = page > 1 ? `${`/page/${page}`}` : "";

  const home = await http(`https://online-fix.me${pageParams}`).then((res) =>
    decodeNonUtf8Response(res)
  );
  const document = new JSDOM(home).window.document;

  const repacks: QueryDeepPartialEntity<Repack>[] = [];
  const articles = Array.from(document.querySelectorAll(".news"));
  const totalPages = Number(
    document.querySelector("nav > a:nth-child(13)")?.textContent
  );

  try {
    await Promise.all(
      articles.map(async (article) => {
        const gameLink = article.querySelector("a")?.getAttribute("href");
        if (!gameLink) return;

        const gamePage = await http(gameLink).then((res) =>
          decodeNonUtf8Response(res)
        );
        const gameDocument = new JSDOM(gamePage).window.document;

        const torrentButtons = Array.from(
          gameDocument.querySelectorAll("a")
        ).filter((a) => a.textContent?.includes("Torrent"));

        const torrentPrePage = torrentButtons[0]?.getAttribute("href");
        if (!torrentPrePage) return;

        const torrentPage = await http(torrentPrePage, {
          headers: {
            Referer: gameLink,
          },
        }).then((res) => res.text());

        const torrentDocument = new JSDOM(torrentPage).window.document;

        const torrentLink = torrentDocument
          .querySelector("a:nth-child(2)")
          ?.getAttribute("href");

        const torrentFile = Buffer.from(
          await http(`${torrentPrePage}${torrentLink}`).then((res) =>
            res.arrayBuffer()
          )
        );

        worker.once("message", (torrent) => {
          if (!torrent) return;

          const { name, created } = torrent;

          repacks.push({
            fileSize: formatBytes(torrent.length ?? 0),
            magnet: toMagnetURI(torrent),
            page: 1,
            repacker: "onlinefix",
            title: name,
            uploadDate: created,
          });
        });

        worker.postMessage(torrentFile);
      })
    );
  } catch (err: unknown) {
    logger.error((err as Error).message, {
      method: "getNewRepacksFromOnlineFix",
    });
  }

  const newRepacks = repacks.filter(
    (repack) =>
      repack.uploadDate &&
      !existingRepacks.some(
        (existingRepack) => existingRepack.title === repack.title
      )
  );

  if (!newRepacks.length) return;
  if (page === totalPages) return;

  await savePage(newRepacks);

  return getNewRepacksFromOnlineFix(existingRepacks, page + 1, cookieJar);
};
