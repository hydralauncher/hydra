import { JSDOM, VirtualConsole } from "jsdom";
import { GameRepackInput, requestWebPage, savePage } from "./helpers";
import { Repack } from "@main/entity";
import { logger } from "../logger";

const virtualConsole = new VirtualConsole();

const getGOGGame = async (url: string) => {
  const data = await requestWebPage(url);
  const { window } = new JSDOM(data, { virtualConsole });

  const $modifiedTime = window.document.querySelector(
    '[property="article:modified_time"]'
  ) as HTMLMetaElement;

  const $em = window.document.querySelector(
    "p:not(.lightweight-accordion *) em"
  );
  const fileSize = $em.textContent.split("Size: ").at(1);
  const $downloadButton = window.document.querySelector(
    ".download-btn:not(.lightweight-accordion *)"
  ) as HTMLAnchorElement;

  const { searchParams } = new URL($downloadButton.href);
  const magnet = Buffer.from(searchParams.get("url"), "base64").toString(
    "utf-8"
  );

  return {
    fileSize: fileSize ?? "N/A",
    uploadDate: new Date($modifiedTime.content),
    repacker: "GOG",
    magnet,
    page: 1,
  };
};

export const getNewGOGGames = async (existingRepacks: Repack[] = []) => {
  try {
    const data = await requestWebPage(
      "https://freegogpcgames.com/a-z-games-list/"
    );

    const { window } = new JSDOM(data, { virtualConsole });

    const $uls = Array.from(window.document.querySelectorAll(".az-columns"));

    for (const $ul of $uls) {
      const repacks: GameRepackInput[] = [];
      const $lis = Array.from($ul.querySelectorAll("li"));

      for (const $li of $lis) {
        const $a = $li.querySelector("a");
        const href = $a.href;

        const title = $a.textContent.trim();

        const gameExists = existingRepacks.some(
          (existingRepack) => existingRepack.title === title
        );

        if (!gameExists) {
          try {
            const game = await getGOGGame(href);

            repacks.push({ ...game, title });
          } catch (err) {
            logger.error(err.message, { method: "getGOGGame", url: href });
          }
        }
      }

      if (repacks.length) await savePage(repacks);
    }
  } catch (err) {
    logger.error(err.message, { method: "getNewGOGGames" });
  }
};
