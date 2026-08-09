import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopCacheSublevel, levelKeys } from "@main/level";
import { getSteamAppDetailsBatch, logger } from "@main/services";
import { WindowManager } from "@main/services/window-manager";
import { parseSortableDate } from "@shared";
import { chunk } from "lodash-es";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let isFetching = false;
const RATE_LIMIT_DELAY_MS = 500;

const refreshLibraryReleaseDates = async () => {
  if (isFetching) return;
  isFetching = true;

  try {
    const libraryGames = await gamesSublevel.values().all();

    const missingSteamGames = libraryGames
      .filter((game) => !game.isDeleted && game.shop === "steam")
      .filter((game) => game.releaseDateTimestamp === undefined);

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
          const appids = currentChunk.map((game) => game.objectId);

          try {
            const detailsById = await getSteamAppDetailsBatch(appids, "en");

            for (const game of currentChunk) {
              const details = detailsById.get(game.objectId);
              const releaseDateTimestamp = details
                ? parseSortableDate(details.release_date?.date)
                : 0;

              await gamesSublevel.put(
                levelKeys.game(game.shop, game.objectId),
                {
                  ...game,
                  releaseDateTimestamp: releaseDateTimestamp || null,
                }
              );
              updatedCount++;

              if (details) {
                await gamesShopCacheSublevel.put(
                  levelKeys.gameShopCacheItem(
                    "steam",
                    game.objectId,
                    "english"
                  ),
                  { ...details, name: game.title }
                );
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
