import { Repack } from "@main/entity";
import { savePage } from "./helpers";
import type { GameRepackInput } from "./helpers";
import { logger } from "../logger";
import { stringify } from "qs";
import parseTorrent, { toMagnetURI } from "parse-torrent";
import { JSDOM } from "jsdom";
import { gotScraping } from "got-scraping";
import { CookieJar } from "tough-cookie";

import { format, parse, sub } from "date-fns";
import { ru } from "date-fns/locale";
import { decode } from "windows-1251";

export const getNewRepacksFromOnlineFix = async (
  existingRepacks: Repack[] = [],
  page = 1,
  cookieJar = new CookieJar()
): Promise<void> => {
  const hasCredentials =
    process.env.ONLINEFIX_USERNAME && process.env.ONLINEFIX_PASSWORD;
  if (!hasCredentials) return;

  const http = gotScraping.extend({
    headerGeneratorOptions: {
      browsers: [
        {
          name: "chrome",
          minVersion: 87,
          maxVersion: 89,
        },
      ],
      devices: ["desktop"],
      locales: ["en-US"],
      operatingSystems: ["windows", "linux"],
    },
    cookieJar: cookieJar,
  });

  if (page === 1) {
    await http.get("https://online-fix.me/");
    const preLogin =
      ((await http
        .get("https://online-fix.me/engine/ajax/authtoken.php", {
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            Referer: "https://online-fix.me/",
          },
        })
        .json()) as {
        field: string;
        value: string;
      }) || undefined;

    if (!preLogin.field || !preLogin.value) return;

    const tokenField = preLogin.field;
    const tokenValue = preLogin.value;

    await http
      .post("https://online-fix.me/", {
        encoding: "binary",
        headers: {
          Referer: "https://online-fix.me",
          Origin: "https://online-fix.me",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: stringify({
          login_name: process.env.ONLINEFIX_USERNAME,
          login_password: process.env.ONLINEFIX_PASSWORD,
          login: "submit",
          [tokenField]: tokenValue,
        }),
      })
      .text();
  }

  const pageParams = page > 1 ? `${`/page/${page}`}` : "";

  const home = await http.get(`https://online-fix.me${pageParams}`);
  const dom = new JSDOM(home.body);
  const document = dom.window.document;
  const repacks: GameRepackInput[] = [];
  const articles = Array.from(document.querySelectorAll(".news"));

  try {
    await Promise.all(
      articles.map(async (article) => {
        const gameName = decode(
          article.querySelector("h2.title")?.textContent?.trim()
        );

        const gameLink = article.querySelector("a")?.getAttribute("href");

        if (!gameLink) return;

        const gamePage = await http
          .get(gameLink, {
            encoding: "binary",
          })
          .text();

        const gameDom = new JSDOM(gamePage);
        const gameDocument = gameDom.window.document;

        const uploadDateText = gameDocument.querySelector("time").textContent;

        let decodedDateText = decode(uploadDateText);

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

        const torrentPage = await http
          .get(torrentPrePage, {
            encoding: "binary",
            headers: {
              Referer: gameLink,
            },
          })
          .text();

        const torrentDom = new JSDOM(torrentPage);
        const torrentDocument = torrentDom.window.document;

        const torrentLink = torrentDocument
          .querySelector("a:nth-child(2)")
          ?.getAttribute("href");

        const torrentFile = Buffer.from(
          await http
            .get(`${torrentPrePage}/${torrentLink}`, {
              responseType: "buffer",
            })
            .buffer()
        );

        const torrent = parseTorrent(torrentFile);
        const magnetLink = toMagnetURI({
          infoHash: torrent.infoHash,
        });

        repacks.push({
          fileSize: "NA",
          magnet: magnetLink,
          page: 1,
          repacker: "onlinefix",
          title: gameName,
          uploadDate: uploadDate,
        });
      })
    );
  } catch (err) {
    logger.error(err.message, { method: "getNewRepacksFromOnlineFix" });
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

  return getNewRepacksFromOnlineFix(existingRepacks, page + 1, cookieJar);
};
