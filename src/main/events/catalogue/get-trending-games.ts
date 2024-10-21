import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { userPreferencesRepository } from "@main/repository";
import type { TrendingGame } from "@types";

const getTrendingGames = async (_event: Electron.IpcMainInvokeEvent) => {
  const userPreferences = await userPreferencesRepository.findOne({
    where: { id: 1 },
  });

  const language = userPreferences?.language || "en";

  const trendingGames = await HydraApi.get<TrendingGame[]>(
    "/games/trending",
    { language },
    { needsAuth: false }
  ).catch(() => []);

  return trendingGames;
};

registerEvent("getTrendingGames", getTrendingGames);
