import { Repack } from "@main/entity";
import { decodeNonUtf8Response, saveRepacks } from "./helpers";
import { logger } from "../logger";
import parseTorrent, {
  toMagnetURI,
  Instance as TorrentInstance,
} from "parse-torrent";
import { JSDOM } from "jsdom";

import { format, parse, sub } from "date-fns";
import { ru } from "date-fns/locale";

import { onlinefixFormatter } from "@main/helpers";
import makeFetchCookie from "fetch-cookie";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

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
    await http("https://online-fix.me/");

    const preLogin =
      ((await http("https://online-fix.me/engine/ajax/authtoken.php", {
        method: "GET",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Referer: "https://online-fix.me/",
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

    await http("https://online-fix.me/", {
      method: "POST",
      headers: {
        Referer: "https://online-fix.me",
        Origin: "https://online-fix.me",
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
        const gameText = article.querySelector("h2.title")?.textContent?.trim();
        if (!gameText) return;

        const gameName = onlinefixFormatter(gameText);

        const gameLink = article.querySelector("a")?.getAttribute("href");
        if (!gameLink) return;

        const gamePage = await http(gameLink).then((res) =>
          decodeNonUtf8Response(res)
        );
        const gameDocument = new JSDOM(gamePage).window.document;

        const uploadDateText = gameDocument.querySelector("time")?.textContent;
        if (!uploadDateText) return;

        let decodedDateText = uploadDateText;

        // "Вчера" means yesterday.
        if (decodedDateText.includes("Вчера")) {
          const yesterday = sub(new Date(), { days: 1 });
          const formattedYesterday = format(yesterday, "d LLLL yyyy", {
            locale: ru,
          });
          decodedDateText = decodedDateText.replace(
            "Вчера", // "Change yesterday to the default expected date format"
            formattedYesterday
          );
        }

        const uploadDate = parse(
          decodedDateText,
          "d LLLL yyyy, HH:mm",
          new Date(),
          {
            locale: ru,
          }
        );

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
          await http(`${torrentPrePage}/${torrentLink}`).then((res) =>
            res.arrayBuffer()
          )
        );

        const torrent = parseTorrent(torrentFile) as TorrentInstance;
        const magnetLink = toMagnetURI({
          infoHash: torrent.infoHash,
        });

        const torrentSizeInBytes = torrent.length;
        if (!torrentSizeInBytes) return;

        const fileSizeFormatted =
          torrentSizeInBytes >= 1024 ** 3
            ? `${(torrentSizeInBytes / 1024 ** 3).toFixed(1)}GBs`
            : `${(torrentSizeInBytes / 1024 ** 2).toFixed(1)}MBs`;

        repacks.push({
          fileSize: fileSizeFormatted,
          magnet: magnetLink,
          page: 1,
          repacker: "onlinefix",
          title: gameName,
          uploadDate: uploadDate,
        });
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

  await saveRepacks(newRepacks);

  return getNewRepacksFromOnlineFix(existingRepacks, page + 1, cookieJar);
};
