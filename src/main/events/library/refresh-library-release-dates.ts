import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopCacheSublevel, levelKeys } from "@main/level";
import { getSteamLanguage, logger } from "@main/services";
import { WindowManager } from "@main/services/window-manager";
import axios from "axios";
import { chunk } from "lodash-es";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let isFetching = false;
const RATE_LIMIT_DELAY_MS = 500;

const refreshLibraryReleaseDates = async (_event: any, language: string) => {
  if (isFetching) return;
  isFetching = true;

  try {
    const steamLanguage = getSteamLanguage(language);
    const libraryGames = await gamesSublevel.values().all();
    const shopCacheKeys = await gamesShopCacheSublevel.keys().all();

    // Quick cache lookup map
    const cacheMap = new Set<string>();
    for (const key of shopCacheKeys) {
      if (key.includes(`:${steamLanguage}`)) {
        const parts = key.split(":");
        if (parts.length >= 2) {
          cacheMap.add(`${parts[0]}:${parts[1]}`);
        }
      }
    }

    const missingSteamGames = libraryGames
      .filter((game) => !game.isDeleted && game.shop === "steam")
      .filter((game) => !cacheMap.has(`steam:${game.objectId}`));

    if (missingSteamGames.length === 0) {
      isFetching = false;
      return;
    }

    logger.info(
      `Fetching release dates for ${missingSteamGames.length} missing games...`
    );

    // Fetch in background in chunks of 50
    (async () => {
      try {
        let updatedCount = 0;
        const chunkSize = 50;

        const chunks = chunk(Array.from(missingSteamGames), chunkSize);

        for (const currentChunk of chunks) {
          const appids = currentChunk.map((game) => game.objectId).join(",");

          try {
            const searchParams = new URLSearchParams({
              appids,
              l: steamLanguage,
              cc: "us",
            });

            const response = await axios.get(
              `https://store.steampowered.com/api/appdetails?${searchParams.toString()}`
            );

            for (const game of currentChunk) {
              const result = response.data[game.objectId];
              if (result?.success && result.data) {
                const details = result.data;
                details.name = game.title;
                details.objectId = game.objectId;
                await gamesShopCacheSublevel.put(
                  levelKeys.gameShopCacheItem(
                    "steam",
                    game.objectId,
                    steamLanguage
                  ),
                  details
                );
                updatedCount++;
              }
            }

            WindowManager.mainWindow?.webContents.send(
              "on-library-batch-complete"
            );
          } catch (err) {
            logger.error(
              `Failed to fetch release dates chunk for ${appids}`,
              err
            );
          }

          await delay(RATE_LIMIT_DELAY_MS); // Prevent rate limiting between chunks
        }

        logger.info(
          `Finished fetching release dates. Updated ${updatedCount} games.`
        );
      } finally {
        isFetching = false;
      }
    })();
  } catch (err) {
    isFetching = false;
    logger.error("Error in refreshLibraryReleaseDates", err);
  }
};

registerEvent("refreshLibraryReleaseDates", refreshLibraryReleaseDates);
