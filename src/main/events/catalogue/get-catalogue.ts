import type { GameShop } from "@types";

import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { CatalogueCategory, steamUrlBuilder } from "@shared";
import { steamGamesWorker } from "@main/workers";

const getCatalogue = async (
  _event: Electron.IpcMainInvokeEvent,
  category: CatalogueCategory
) => {
  const params = new URLSearchParams({
    take: "12",
    skip: "0",
  });

  const response = await HydraApi.get<{ objectId: string; shop: GameShop }[]>(
    `/games/${category}?${params.toString()}`,
    {},
    { needsAuth: false }
  );

  return Promise.all(
    response.map(async (game) => {
      const steamGame = await steamGamesWorker.run(Number(game.objectId), {
        name: "getById",
      });

      return {
        title: steamGame.name,
        shop: game.shop,
        cover: steamUrlBuilder.library(game.objectId),
        objectId: game.objectId,
      };
    })
  );
};

registerEvent("getCatalogue", getCatalogue);
