import axios from "axios";
import { requestWebPage } from "@main/helpers";
import { HowLongToBeatCategory } from "@types";
import { formatName } from "@shared";
import { logger } from "./logger";

export interface HowLongToBeatResult {
  game_id: number;
  profile_steam: number;
}

export interface HowLongToBeatSearchResponse {
  data: HowLongToBeatResult[];
}

export const searchHowLongToBeat = async (gameName: string) => {
  const response = await axios
    .post(
      "https://howlongtobeat.com/api/search",
      {
        searchType: "games",
        searchTerms: formatName(gameName).split(" "),
        searchPage: 1,
        size: 100,
      },
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
          Referer: "https://howlongtobeat.com/",
        },
      }
    )
    .catch((error) => {
      logger.error("Error searching HowLongToBeat:", error?.response?.status);
      return { data: { data: [] } };
    });

  return response.data as HowLongToBeatSearchResponse;
};

const parseListItems = ($lis: Element[]) => {
  return $lis.map(($li) => {
    const title = $li.querySelector("h4")?.textContent;
    const [, accuracyClassName] = Array.from(($li as HTMLElement).classList);

    const accuracy = accuracyClassName.split("time_").at(1);

    return {
      title: title ?? "",
      duration: $li.querySelector("h5")?.textContent ?? "",
      accuracy: accuracy ?? "",
    };
  });
};

export const getHowLongToBeatGame = async (
  id: string
): Promise<HowLongToBeatCategory[]> => {
  const document = await requestWebPage(`https://howlongtobeat.com/game/${id}`);

  const $ul = document.querySelector(".shadow_shadow ul");
  if (!$ul) return [];

  const $lis = Array.from($ul.children);

  const [$firstLi] = $lis;

  if ($firstLi.tagName === "DIV") {
    const $pcData = $lis.find(($li) => $li.textContent?.includes("PC"));
    return parseListItems(Array.from($pcData?.querySelectorAll("li") ?? []));
  }

  return parseListItems($lis);
};
