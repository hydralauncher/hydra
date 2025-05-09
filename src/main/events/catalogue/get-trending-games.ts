import { db, levelKeys } from "@main/level";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { TrendingGame } from "@types";

const getTrendingGames = async (_event: Electron.IpcMainInvokeEvent) => {
  const language = await db
    .get<string, string>(levelKeys.language, {
      valueEncoding: "utf8",
    })
    .then((language) => language || "en");

  const trendingGames = await HydraApi.get<TrendingGame[]>(
    "/games/trending",
    { language },
    { needsAuth: false }
  ).catch(() => []);

  return trendingGames;
};

registerEvent("getTrendingGames", getTrendingGames);
