import { JSDOM, VirtualConsole } from "jsdom";
import { requestWebPage, savePage } from "./helpers";
import { Repack } from "@main/entity";

import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

const virtualConsole = new VirtualConsole();

const getGOGGame = async (url: string) => {
  const data = await requestWebPage(url);
  const { window } = new JSDOM(data, { virtualConsole });

  const $modifiedTime = window.document.querySelector(
    '[property="article:modified_time"]'
  ) as HTMLMetaElement;

  const $em = window.document.querySelector(
    "p:not(.lightweight-accordion *) em"
  )!;
  const fileSize = $em.textContent!.split("Size: ").at(1);
  const $downloadButton = window.document.querySelector(
    ".download-btn:not(.lightweight-accordion *)"
  ) as HTMLAnchorElement;

  const { searchParams } = new URL($downloadButton.href);
  const magnet = Buffer.from(searchParams.get("url")!, "base64").toString(
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
  const data = await requestWebPage(
    "https://freegogpcgames.com/a-z-games-list/"
  );

  const { window } = new JSDOM(data, { virtualConsole });

  const $uls = Array.from(window.document.querySelectorAll(".az-columns"));

  for (const $ul of $uls) {
    const repacks: QueryDeepPartialEntity<Repack>[] = [];
    const $lis = Array.from($ul.querySelectorAll("li"));

    for (const $li of $lis) {
      const $a = $li.querySelector("a")!;
      const href = $a.href;

      const title = $a.textContent!.trim();

      const gameExists = existingRepacks.some(
        (existingRepack) => existingRepack.title === title
      );

      if (!gameExists) {
        const game = await getGOGGame(href);

        repacks.push({ ...game, title });
      }
    }

    if (repacks.length) await savePage(repacks);
  }
};
