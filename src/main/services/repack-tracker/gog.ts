import { JSDOM, VirtualConsole } from "jsdom";
import { requestWebPage, savePage } from "./helpers";
import { Repack } from "@main/entity";

import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

const virtualConsole = new VirtualConsole();

const getUploadDate = (document: Document) => {
  const $modifiedTime = document.querySelector(
    '[property="article:modified_time"]'
  ) as HTMLMetaElement;
  if ($modifiedTime) return $modifiedTime.content;

  const $publishedTime = document.querySelector(
    '[property="article:published_time"]'
  ) as HTMLMetaElement;
  return $publishedTime.content;
};

const getDownloadLink = (document: Document) => {
  const $latestDownloadButton = document.querySelector(
    ".download-btn:not(.lightweight-accordion *)"
  ) as HTMLAnchorElement;
  if ($latestDownloadButton) return $latestDownloadButton.href;

  const $downloadButton = document.querySelector(
    ".download-btn"
  ) as HTMLAnchorElement;
  if (!$downloadButton) return null;

  return $downloadButton.href;
};

const getMagnet = (downloadLink: string) => {
  if (downloadLink.startsWith("http")) {
    const { searchParams } = new URL(downloadLink);
    return Buffer.from(searchParams.get("url")!, "base64").toString("utf-8");
  }

  return downloadLink;
};

const getGOGGame = async (url: string) => {
  const data = await requestWebPage(url);
  const { window } = new JSDOM(data, { virtualConsole });

  const downloadLink = getDownloadLink(window.document);
  if (!downloadLink) return null;

  const $em = window.document.querySelector("p em");
  if (!$em) return null;
  const fileSize = $em.textContent!.split("Size: ").at(1);

  return {
    fileSize: fileSize ?? "N/A",
    uploadDate: new Date(getUploadDate(window.document)),
    repacker: "GOG",
    magnet: getMagnet(downloadLink),
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

        if (game) repacks.push({ ...game, title });
      }
    }

    if (repacks.length) await savePage(repacks);
  }
};
