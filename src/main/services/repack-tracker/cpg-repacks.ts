import { JSDOM } from "jsdom";
import { Repack } from "@main/entity";
import { requestWebPage, savePage } from "./helpers";

export const getNewRepacksFromCPG = async (
  existingRepacks: Repack[] = [],
  page = 1,
): Promise<void> => {
  const data = await requestWebPage(`https://cpgrepacks.site/page/${page}`);

  const { window } = new JSDOM(data);
  const { document } = window;

  const repacks: Partial<Repack>[] = [];

  // prettier-ignore
  for (const $post of document.querySelectorAll(".post")) {
    const title = $post.querySelector(".entry-title")?.textContent || undefined;
    const uploadDate = $post.querySelector("time")?.getAttribute("datetime") || undefined;

    const fileSize = (Array.prototype.map<string | undefined>)
      .call(
        $post.querySelectorAll(".wp-block-heading"),
        (heading: HTMLElement) =>
        {
            const chunks = heading.textContent?.split("Download link => ");
            return chunks?.[1];
        })
      .filter(Boolean)
      .shift();

    /* Side note: CPG often misspells "Magnet" as "Magent" */
    const $magnet = Array.from($post.querySelectorAll("a")).find(
      ($a) =>
        $a.textContent?.startsWith("Magnet") ||
        $a.textContent?.startsWith("Magent"),
    );

    repacks.push({
      title,
      fileSize: fileSize ?? "N/A",
      magnet: $magnet?.href,
      repacker: "CPG",
      page,
      uploadDate: uploadDate && new Date(uploadDate),
    });
  }

  const newRepacks = repacks.filter(
    (repack) =>
      repack.uploadDate &&
      !existingRepacks.some(
        (existingRepack) => existingRepack.title === repack.title,
      ),
  );

  if (!newRepacks.length) return;

  await savePage(newRepacks);
  return getNewRepacksFromCPG(existingRepacks, page + 1);
};
