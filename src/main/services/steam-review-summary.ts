import axios from "axios";
import { parseSteamReviewSummary, type SteamReviewSummary } from "@shared";
import { logger } from "./logger";

const REVIEWS_URL = "https://store.steampowered.com/appreviews";
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const STEAM_APP_ID_PATTERN = /^\d+$/;

const cache = new Map<
  string,
  { value: SteamReviewSummary | null; expiresAt: number }
>();

/**
 * Fetches Steam's overall review rating for a Steam app. Results are cached
 * per app for a few hours, and failures return null so the game page simply
 * omits the rating.
 */
export const getSteamReviewSummary = async (
  steamAppId: string
): Promise<SteamReviewSummary | null> => {
  if (!STEAM_APP_ID_PATTERN.test(steamAppId)) return null;

  const cached = cache.get(steamAppId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const response = await axios.get(`${REVIEWS_URL}/${steamAppId}`, {
      params: {
        json: 1,
        num_per_page: 0,
        language: "all",
        purchase_type: "all",
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const value = parseSteamReviewSummary(response.data);
    cache.set(steamAppId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err) {
    const error = err as { message?: string; code?: string };
    logger.error("Error on getSteamReviewSummary", {
      steamAppId,
      message: error?.message,
      code: error?.code,
    });
    return null;
  }
};
