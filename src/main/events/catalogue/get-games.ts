import type { CatalogueEntry } from "@types";

import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { steamUrlBuilder } from "@shared";

const getGames = async (
  _event: Electron.IpcMainInvokeEvent,
  take = 12,
  skip = 0
): Promise<CatalogueEntry[]> => {
  const searchParams = new URLSearchParams({
    take: take.toString(),
    skip: skip.toString(),
  });

  const games = await HydraApi.get<CatalogueEntry[]>(
    `/games/catalogue?${searchParams.toString()}`,
    undefined,
    { needsAuth: false }
  );

  return games.map((game) => ({
    ...game,
    cover: steamUrlBuilder.library(game.objectId),
  }));
};

registerEvent("getGames", getGames);
