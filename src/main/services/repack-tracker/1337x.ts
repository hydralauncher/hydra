import { JSDOM } from "jsdom";

import { Repack } from "@main/entity";
import { requestWebPage, savePage } from "./helpers";

const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const request1337x = async (path: string) =>
  requestWebPage(`https://1337xx.to${path}`);

const formatUploadDate = (str: string) => {
  const date = new Date();

  const [month, day, year] = str.split(" ");

  date.setMonth(months.indexOf(month.replace(".", "")));
  date.setDate(Number(day.substring(0, 2)));
  date.setFullYear(Number("20" + year.replace("'", "")));
  date.setHours(0, 0, 0, 0);

  return date;
};


const getTorrentDetails = async (path: string) => {
  const response = await request1337x(path);

  const { window } = new JSDOM(response);
  const { document } = window;

  const $a = window.document.querySelector(
    ".torrentdown1"
  ) as HTMLAnchorElement;

  if(!$a) return getTorrentDetails(path)

  const $ul = Array.from(
    document.querySelectorAll(".torrent-detail-page .list")
  );
  const [$firstColumn, $secondColumn] = $ul;

  if (!$firstColumn || !$secondColumn) {
    return { magnet: $a?.href };
  }

  const [_$category, _$type, _$language, $totalSize] = $firstColumn.children;
  const [_$downloads, _$lastChecked, $dateUploaded] = $secondColumn.children;

  return {
    magnet: $a?.href,
    fileSize: $totalSize.querySelector("span")!.textContent,
    uploadDate: formatUploadDate(
      $dateUploaded.querySelector("span")!.textContent!
    ),
  };
};

export const getTorrentListLastPage = async (user: string) => {
  const response = await request1337x(`/user/${user}/1`);

  const { window } = new JSDOM(response);

  const $ul = window.document.querySelector(".pagination > ul");

  if ($ul) {
    const $li = Array.from($ul.querySelectorAll("li")).at(-1);
    const text = $li?.textContent;

    if (text === ">>") {
      const $previousLi = Array.from($ul.querySelectorAll("li")).at(-2);
      return Number($previousLi?.textContent);
    }

    return Number(text);
  }

  return -1;
};

export const extractTorrentsFromDocument = async (
  page: number,
  user: string,
  document: Document
) => {
  const $trs = Array.from(document.querySelectorAll("tbody tr"));

  return Promise.all(
    $trs.map(async ($tr) => {
      const $td = $tr.querySelector("td");

      const [, $name] = Array.from($td!.querySelectorAll("a"));
      const url = $name.href;
      const title = $name.textContent ?? "";

      const details = await getTorrentDetails(url);

      return {
        title,
        magnet: details.magnet,
        fileSize: details.fileSize ?? "N/A",
        uploadDate: details.uploadDate ?? new Date(),
        repacker: user,
        page,
      };
    })
  );
};

export const getNewRepacksFromUser = async (
  user: string,
  existingRepacks: Repack[],
  page = 1
) => {
  const response = await request1337x(`/user/${user}/${page}`);
  const { window } = new JSDOM(response);

  const repacks = await extractTorrentsFromDocument(
    page,
    user,
    window.document
  );

  const newRepacks = repacks.filter(
    (repack) =>
      !existingRepacks.some(
        (existingRepack) => existingRepack.title === repack.title
      )
  );

  if (!newRepacks.length) return;

  await savePage(newRepacks);

  return getNewRepacksFromUser(user, existingRepacks, page + 1);
};
