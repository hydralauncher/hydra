import { Repack } from "@main/entity";
import { savePage } from "./helpers";
import type { GameRepackInput } from "./helpers";
import { logger } from "../logger";
import { stringify } from "qs";
import { z } from "zod";
import parseTorrent, { toMagnetURI } from "parse-torrent";
import { JSDOM } from "jsdom";
import { gotScraping } from "got-scraping";
import { CookieJar } from "tough-cookie";

import { format, parse, sub } from "date-fns";
import { ru } from "date-fns/locale";
import { decode } from "windows-1251";

const preLoginSchema = z.object({
  field: z.string(),
  value: z.string(),
});

export const getNewRepacksFromOnlineFix = async (
  existingRepacks: Repack[] = []
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
    cookieJar: new CookieJar(),
  });

  await http.get("https://online-fix.me/");
  const preLogin = await http
    .get("https://online-fix.me/engine/ajax/authtoken.php", {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://online-fix.me/",
      },
    })
    .json();

  const parsedPreLoginRes = preLoginSchema.parse(preLogin);
  const tokenField = parsedPreLoginRes.field;
  const tokenValue = parsedPreLoginRes.value;

  const login = await http
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

  const dom = new JSDOM(login);
  const document = dom.window.document;
  const repacks: GameRepackInput[] = [];
  const articles = Array.from(document.querySelectorAll(".news"));

  try {
    await Promise.all(
      articles.map(async (article) => {
        const gameName = decode(
          article.querySelector("h2.title")?.textContent?.trim()
        )
          .replace("по сети", "")
          .trim();

        const gameLink = article.querySelector("a")?.getAttribute("href");

        if (!gameLink) return;

        const gamePage = await http
          .get(gameLink, {
            encoding: "binary",
          })
          .text();

        const gameDom = new JSDOM(gamePage);
        const gameDocument = gameDom.window.document;

        const uploadDateText = gameDocument.querySelector(
          "#dle-content > div > article > div.full-story-header.wide-block.clr > div.full-story-top-panel.clr > div.date.left > time"
        ).textContent;

        let decodedDateText = decode(uploadDateText);

        // "Вчера" significa ontem.
        if (decodedDateText.includes("Вчера")) {
          const yesterday = sub(new Date(), { days: 1 });
          const formattedYesterday = format(yesterday, "d LLLL yyyy", {
            locale: ru,
          });
          decodedDateText = decodedDateText.replace(
            "Вчера",
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
};
