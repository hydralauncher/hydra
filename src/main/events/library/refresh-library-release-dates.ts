import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopCacheSublevel, levelKeys } from "@main/level";
import { getSteamAppDetails, logger } from "@main/services";
import { WindowManager } from "@main/services/window-manager";
import { parseSortableDate } from "@shared";
import { chunk } from "lodash-es";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let isFetching = false;
const RATE_LIMIT_DELAY_MS = 500;
const STEAM_APP_DETAILS_CONCURRENCY = 5;

const refreshLibraryReleaseDates = async () => {
  if (isFetching) return;
  isFetching = true;

  try {
    const libraryGames = await gamesSublevel.values().all();

    const missingSteamGames = libraryGames
      .filter((game) => !game.isDeleted && game.shop === "steam")
      .filter((game) => game.releaseDateTimestamp == null);

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
            for (const gamesBatch of chunk(
              currentChunk,
              STEAM_APP_DETAILS_CONCURRENCY
            )) {
              const details = await Promise.all(
                gamesBatch.map((game) =>
                  getSteamAppDetails(game.objectId, "en")
                )
              );

              for (const [index, game] of gamesBatch.entries()) {
                const detailsForGame = details[index];
                if (!detailsForGame) continue;

                const releaseDateTimestamp = parseSortableDate(
                  detailsForGame.release_date?.date
                );

                await gamesSublevel.put(
                  levelKeys.game(game.shop, game.objectId),
                  {
                    ...game,
                    releaseDateTimestamp: releaseDateTimestamp || null,
                  }
                );
                updatedCount++;

                await gamesShopCacheSublevel.put(
                  levelKeys.gameShopCacheItem(
                    "steam",
                    game.objectId,
                    "english"
                  ),
                  { ...detailsForGame, name: game.title }
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
