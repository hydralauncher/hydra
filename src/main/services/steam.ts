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

export const getSteamAppRating = async (gameID: string) => {
  return axios
    .get(
      `http://store.steampowered.com/appreviews/${gameID}?json=1&language=all`
    )
    .then((response) => {
      if (response.data.success) {
        return response.data.query_summary;
      }
      return null;
    })
    .catch((err) => {
      logger.error(err, { method: "getSteamAppRating" });
      throw new Error(err);
    });
};

export const getSteamRecommendationsByGenreService = async (gameID: string) => {
  return axios
    .get(`https://store.steampowered.com/api/appdetails?l=en&appids=${gameID}`)
    .then(async (response) => {
      if (response.data[gameID].success) {
        const genres = response.data[gameID].data.genres;
        const recommendations: unknown[] = [];

        await Promise.all(
          genres.map(async (genre: { description: string }) => {
            try {
              const response = await axios.get(
                `https://store.steampowered.com/api/getappsingenre/?genre=${genre.description}`
              );

              if (response.data.status === 1) {
                const {
                  featured,
                  comingsoon,
                  specials,
                  topsellers,
                  newreleases,
                } = response.data.tabs || {};

                if (featured?.items) {
                  recommendations.push(...featured.items);
                }
                if (topsellers?.items) {
                  recommendations.push(...topsellers.items);
                }
                if (specials?.items) {
                  recommendations.push(...specials.items);
                }
                if (newreleases.items) {
                  recommendations.push(...newreleases.items);
                }
                if (comingsoon?.items) {
                  recommendations.push(...comingsoon.items);
                }
              }
            } catch (error) {
              logger.error(`Error fetching genre ${genre.description}:`, error);
            }
          })
        );

        return recommendations;
      }

      return null;
    })
    .catch((err) => {
      logger.error(err, { method: "getSteamAppDetails" });
      throw new Error(err);
    });
};
