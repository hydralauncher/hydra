import { JSDOM, VirtualConsole } from "jsdom";
import { requestWebPage, savePage } from "./helpers";
import { Repack } from "@main/entity";
import { logger } from "../logger";

const virtualConsole = new VirtualConsole();

// prettier-ignore
const getGOGGame = async (url: string) => {
  const data = await requestWebPage(url);

  const { window } = new JSDOM(data, { virtualConsole });
  const { document } = window;

  const $modifiedTime = document.querySelector<HTMLMetaElement>('[property="article:modified_time"]');
  const $em = document.querySelector("p:not(.lightweight-accordion *) em");

  const fileSize = $em?.textContent?.split("Size: ").at(1);
  const $downloadButton = document.querySelector<HTMLAnchorElement>(".download-btn[href]:not(.lightweight-accordion *)");

  if (!$downloadButton) throw new Error("No download button found");

  const { searchParams } = new URL($downloadButton.href);
  if (!searchParams.has("url")) throw new Error("No magnet found");

  const magnet = Buffer
    .from(searchParams.get("url")!, "base64")
    .toString("utf-8");

  return <Repack>{
    fileSize: fileSize ?? "N/A",
    uploadDate: $modifiedTime && new Date($modifiedTime.content),
    repacker: "GOG",
    magnet,
    page: 1,
  };
};

export const getNewGOGGames = async (existingRepacks: Repack[] = []) => {
  const data = await requestWebPage(
    "https://freegogpcgames.com/a-z-games-list/",
  );

  const { window } = new JSDOM(data, { virtualConsole });

  const $uls = Array.from(window.document.querySelectorAll(".az-columns"));

  for (const $ul of $uls) {
    const repacks: Partial<Repack>[] = [];
    const $lis = Array.from($ul.querySelectorAll("li"));

    for (const $li of $lis) {
      const $a = $li.querySelector<HTMLAnchorElement>("a");
      if (!$a) continue;

      const { href, textContent: text } = $a;
      const title = text?.trim();

      const gameExists = existingRepacks.some(
        (existingRepack) => existingRepack.title === title,
      );

      if (!gameExists) {
        try {
          const game = await getGOGGame(href);
          repacks.push({ ...game, title });
        } catch (e) {
          let msg = `${e}`;
          if (e instanceof Error) msg = e.message;

          logger.error(`Error getting ${title} from GOG: ${msg}`);
        }
      }
    }

    if (repacks.length) await savePage(repacks);
  }
};
