import { JSDOM } from "jsdom";

import { Repack } from "@main/entity";

import { requestWebPage, saveRepacks } from "./helpers";
import { logger } from "../logger";

export const getNewRepacksFromCPG = async (
  existingRepacks: Repack[] = [],
  page = 1
): Promise<void> => {
  const data = await requestWebPage(`https://cpgrepacks.site/page/${page}`);

  const { window } = new JSDOM(data);

  const repacks = [];

  try {
    Array.from(window.document.querySelectorAll(".post")).forEach(($post) => {
      const $title = $post.querySelector(".entry-title");
      const uploadDate = $post.querySelector("time")?.getAttribute("datetime");

      const $downloadInfo = Array.from(
        $post.querySelectorAll(".wp-block-heading")
      ).find(($heading) => $heading.textContent?.startsWith("Download"));

      /* Side note: CPG often misspells "Magnet" as "Magent" */
      const $magnet = Array.from($post.querySelectorAll("a")).find(
        ($a) =>
          $a.textContent?.startsWith("Magnet") ||
          $a.textContent?.startsWith("Magent")
      );

      const fileSize = $downloadInfo.textContent
        .split("Download link => ")
        .at(1);

      repacks.push({
        title: $title.textContent,
        fileSize: fileSize ?? "N/A",
        magnet: $magnet.href,
        repacker: "CPG",
        page,
        uploadDate: new Date(uploadDate),
      });
    });
  } catch (err) {
    logger.error(err.message, { method: "getNewRepacksFromCPG" });
  }

  const newRepacks = repacks.filter(
    (repack) =>
      repack.uploadDate &&
      !existingRepacks.some(
        (existingRepack) => existingRepack.title === repack.title
      )
  );

  if (!newRepacks.length) return;

  await saveRepacks(newRepacks);

  return getNewRepacksFromCPG(existingRepacks, page + 1);
};
