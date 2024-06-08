import { getSteamAppAsset } from "@main/helpers";
import type { CatalogueEntry, GameShop } from "@types";

import { registerEvent } from "../register-event";
import { RepacksManager, requestSteam250 } from "@main/services";
import { formatName } from "@shared";

const resultSize = 12;

const getCatalogue = async (_event: Electron.IpcMainInvokeEvent) => {
  const trendingGames = await requestSteam250("/90day");
  const results: CatalogueEntry[] = [];

  for (let i = 0; i < resultSize; i++) {
    if (!trendingGames[i]) {
      i++;
      continue;
    }

    const { title, objectID } = trendingGames[i]!;
    const repacks = RepacksManager.search({ query: formatName(title) });

    const catalogueEntry = {
      objectID,
      title,
      shop: "steam" as GameShop,
      cover: getSteamAppAsset("library", objectID),
    };

    results.push({ ...catalogueEntry, repacks });
  }

  return results;
};

registerEvent("getCatalogue", getCatalogue);
