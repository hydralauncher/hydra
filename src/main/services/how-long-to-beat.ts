import { formatName } from "@main/helpers";
import axios from "axios";
import { JSDOM } from "jsdom";
import { requestWebPage } from "./repack-tracker/helpers";

export interface HowLongToBeatResult {
  game_id: number;
  profile_steam: number;
}

export interface HowLongToBeatSearchResponse {
  data: HowLongToBeatResult[];
}

export const searchHowLongToBeat = async (gameName: string) => {
  const response = await axios.post(
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
  );

  return response.data as HowLongToBeatSearchResponse;
};

export const classNameColor = {
  time_40: "#ff3a3a",
  time_50: "#cc3b51",
  time_60: "#824985",
  time_70: "#5650a1",
  time_80: "#485cab",
  time_90: "#3a6db5",
  time_100: "#287fc2",
};

export const getHowLongToBeatGame = async (id: string) => {
  const response = await requestWebPage(`https://howlongtobeat.com/game/${id}`);

  const { window } = new JSDOM(response);
  const { document } = window;

  const $ul = document.querySelector(".shadow_shadow ul");
  const $lis = Array.from($ul.children);

  return $lis.reduce((prev, next) => {
    const name = next.querySelector("h4").textContent;
    const [, time] = Array.from((next as HTMLElement).classList);

    return {
      ...prev,
      [name]: {
        time: next.querySelector("h5").textContent,
        color: classNameColor[time as keyof typeof classNameColor],
      },
    };
  }, {});
};
