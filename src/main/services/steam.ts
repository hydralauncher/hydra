import axios from "axios";

import type { SteamAppDetails } from "@types";

import { logger } from "./logger";

export interface SteamAppDetailsResponse {
  [key: string]: {
    success: boolean;
    data: SteamAppDetails;
  };
}

export const getSteamAppDetails = async (
  objectId: string,
  language: string
) => {
  const searchParams = new URLSearchParams({
    appids: objectId,
    l: language,
  });

  return axios
    .get(
      `http://store.steampowered.com/api/appdetails?${searchParams.toString()}`
    )
    .then((response) => {
      if (response.data[objectId].success) return response.data[objectId].data;
      return null;
    })
    .catch((err) => {
      logger.error(err, { method: "getSteamAppDetails" });
      return null;
    });
};
