import axios, { AxiosError } from "axios";
import { sleep } from "@main/helpers";
import type { UnlockedAchievement } from "@types";

interface SteamPlayerAchievement {
  apiname: string;
  achieved: 0 | 1;
  unlocktime: number;
}

interface SteamPlayerAchievementsResponse {
  playerstats: {
    steamID: string;
    gameName: string;
    achievements: SteamPlayerAchievement[];
    success: boolean;
    error?: string;
  };
}

const RATE_LIMIT_BACKOFF_MS = 5000;
const MAX_RETRIES = 3;

export class SteamAchievementsApi {
  static async getPlayerAchievements(
    steamId: string,
    apiKey: string,
    appId: string,
    attempt = 0
  ): Promise<UnlockedAchievement[]> {
    try {
      const { data } = await axios.get<SteamPlayerAchievementsResponse>(
        "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/",
        {
          params: {
            steamid: steamId,
            key: apiKey,
            appid: appId,
            l: "english",
          },
        }
      );

      if (!data.playerstats?.success) {
        throw new Error(data.playerstats?.error ?? "steam_api_error");
      }

      return data.playerstats.achievements
        .filter((a) => a.achieved === 1)
        .map((a) => ({
          name: a.apiname,
          unlockTime: a.unlocktime * 1000,
        }));
    } catch (err) {
      if (
        err instanceof AxiosError &&
        err.response?.status === 429 &&
        attempt < MAX_RETRIES
      ) {
        await sleep(RATE_LIMIT_BACKOFF_MS * (attempt + 1));
        return SteamAchievementsApi.getPlayerAchievements(
          steamId,
          apiKey,
          appId,
          attempt + 1
        );
      }
      throw err;
    }
  }
}
