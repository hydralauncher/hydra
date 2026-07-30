import axios from "axios";
import { logger } from "../logger";
import {
  getCheckableHosterUris,
  HOSTER_AVAILABILITY_MAX_URIS_PER_REQUEST,
} from "@shared";

interface AvailabilityResult {
  url: string;
  available: boolean;
}

interface AvailabilityResponse {
  results: AvailabilityResult[];
}

const CACHE_TTL_IN_MS = 5 * 60 * 1000;

export class HosterAvailabilityApi {
  private static readonly cache = new Map<
    string,
    { available: boolean; checkedAt: number }
  >();

  private static getCached(uri: string) {
    const entry = this.cache.get(uri);

    if (!entry) return null;

    if (Date.now() - entry.checkedAt > CACHE_TTL_IN_MS) {
      this.cache.delete(uri);
      return null;
    }

    return entry.available;
  }

  public static async check(uris: string[]): Promise<Record<string, boolean>> {
    const checkableUris = getCheckableHosterUris(uris);

    if (checkableUris.length === 0) return {};

    const availability: Record<string, boolean> = {};
    const urisToCheck: string[] = [];

    for (const uri of checkableUris) {
      const cached = this.getCached(uri);

      if (cached === null) {
        urisToCheck.push(uri);
      } else {
        availability[uri] = cached;
      }
    }

    for (
      let index = 0;
      index < urisToCheck.length;
      index += HOSTER_AVAILABILITY_MAX_URIS_PER_REQUEST
    ) {
      const batch = urisToCheck.slice(
        index,
        index + HOSTER_AVAILABILITY_MAX_URIS_PER_REQUEST
      );

      try {
        const response = await axios.post<AvailabilityResponse>(
          `${import.meta.env.MAIN_VITE_NIMBUS_API_URL}/hosters/availability`,
          { urls: batch },
          { timeout: 15_000 }
        );

        for (const result of response.data?.results ?? []) {
          if (
            typeof result?.url !== "string" ||
            typeof result?.available !== "boolean"
          ) {
            continue;
          }

          availability[result.url] = result.available;
          this.cache.set(result.url, {
            available: result.available,
            checkedAt: Date.now(),
          });
        }
      } catch (error) {
        logger.error("[HosterAvailability] Failed to check batch:", error);

        if (axios.isAxiosError(error) && error.response?.status === 429) {
          break;
        }
      }
    }

    return availability;
  }
}
