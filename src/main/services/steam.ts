import axios from "axios";
import { JSDOM } from "jsdom";

import type { SteamAppDetails } from "@types";

import { logger } from "./logger";

export interface SteamAppDetailsResponse {
  [key: string]: {
    success: boolean;
    data: SteamAppDetails;
  };
}

export const getSteamAppDetails = async (
  objectID: string,
  language: string
) => {
  const searchParams = new URLSearchParams({
    appids: objectID,
    l: language,
  });

  return axios
    .get(
      `http://store.steampowered.com/api/appdetails?${searchParams.toString()}`
    )
    .then((response) => {
      if (response.data[objectID].success) return response.data[objectID].data;
      return null;
    })
    .catch((err) => {
      logger.error(err, { method: "getSteamAppDetails" });
      throw new Error(err);
    });
};

export const searchSteamGame = async (term: string) => {
  const searchParams = new URLSearchParams({
    start: "0",
    count: "12",
    sort_by: "_ASC",
    /* Games only */
    category1: "998",
    term: term,
  });

  const response = await axios.get(
    `https://store.steampowered.com/search/results/?${searchParams.toString()}`
  );

  const { window } = new JSDOM(response.data);
  const { document } = window;

  const $anchors = Array.from(
    document.querySelectorAll("#search_resultsRows a")
  );

  return $anchors.reduce((prev, $a) => {
    const $title = $a.querySelector(".title");
    const objectIDs = $a.getAttribute("data-ds-appid");

    if (!objectIDs) return prev;

    const [objectID] = objectIDs.split(",");

    if (!objectID || prev.some((game) => game.objectID === objectID))
      return prev;

    return [
      ...prev,
      {
        name: $title.textContent,
        objectID,
      },
    ];
  }, []);
};
