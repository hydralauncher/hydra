import path from "node:path";
import fs from "node:fs";

import { getSteamGameClientIcon, logger } from "@main/services";
import { chunk } from "lodash-es";
import { seedsPath } from "@main/constants";

import type { SteamGame } from "@types";

const steamGamesPath = path.join(seedsPath, "steam-games.json");

const steamGames = JSON.parse(
  fs.readFileSync(steamGamesPath, "utf-8")
) as SteamGame[];

const chunks = chunk(steamGames, 1500);

for (const chunk of chunks) {
  await Promise.all(
    chunk.map(async (steamGame) => {
      if (steamGame.clientIcon) return;

      const index = steamGames.findIndex((game) => game.id === steamGame.id);

      try {
        const clientIcon = await getSteamGameClientIcon(String(steamGame.id));

        steamGames[index].clientIcon = clientIcon;

        logger.log("info", `Set ${steamGame.name} client icon`);
      } catch (err) {
        steamGames[index].clientIcon = null;
        logger.log("info", `Could not set icon for ${steamGame.name}`);
      }
    })
  );

  fs.writeFileSync(steamGamesPath, JSON.stringify(steamGames));
  logger.log("info", "Updated steam games");
}
