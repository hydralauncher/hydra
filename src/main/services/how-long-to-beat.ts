import axios from "axios";
import { requestWebPage } from "@main/helpers";
import type {
  HowLongToBeatCategory,
  HowLongToBeatSearchResponse,
} from "@types";
import { formatName } from "@shared";
import { logger } from "./logger";
import UserAgent from "user-agents";

const state = {
  apiKey: null as string | null,
};

const getHowLongToBeatSearchApiKey = async () => {
  const userAgent = new UserAgent();

  const document = await requestWebPage("https://howlongtobeat.com/");
  const scripts = Array.from(document.querySelectorAll("script"));

  const appScript = scripts.find((script) =>
    script.src.startsWith("/_next/static/chunks/pages/_app")
  );

  if (!appScript) return null;

  const response = await axios.get(
    `https://howlongtobeat.com${appScript.src}`,
    {
      headers: {
        "User-Agent": userAgent.toString(),
      },
    }
  );

  const results = /fetch\("\/api\/search\/"\.concat\("(.*?)"\)/gm.exec(
    response.data
  );

  if (!results) return null;

  return results[1];
};

export const searchHowLongToBeat = async (gameName: string) => {
  state.apiKey = state.apiKey ?? (await getHowLongToBeatSearchApiKey());
  if (!state.apiKey) return { data: [] };

  const userAgent = new UserAgent();

  const response = await axios
    .post(
      `https://howlongtobeat.com/api/search/${state.apiKey}`,
      {
        searchType: "games",
        searchTerms: formatName(gameName).split(" "),
        searchPage: 1,
        size: 20,
      },
      {
        headers: {
          "User-Agent": userAgent.toString(),
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
