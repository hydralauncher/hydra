import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopCacheSublevel, levelKeys } from "@main/level";
import { getSteamAppDetailsWithStatus, logger } from "@main/services";
import { WindowManager } from "@main/services/window-manager";
import { parseSortableDate } from "@shared";
import { chunk } from "lodash-es";
import {
  getReleaseDateNextCheckAt,
  needsReleaseDateRefresh,
} from "./release-date-refresh-policy";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let isFetching = false;
let nextSteamRequestAt = 0;
const SUB_BATCH_DELAY_MS = 200;
const STEAM_APP_DETAILS_CONCURRENCY = 5;
const RATE_LIMIT_FALLBACK_DELAY_MS = 60 * 60 * 1000;

const refreshLibraryReleaseDates = async () => {
  if (isFetching) return;
  if (Date.now() < nextSteamRequestAt) return;
  isFetching = true;

  try {
    const libraryGames = await gamesSublevel.values().all();

    const missingSteamGames = libraryGames
      .filter((game) => !game.isDeleted && game.shop === "steam")
      .filter((game) => needsReleaseDateRefresh(game, Date.now()));

    if (missingSteamGames.length === 0) {
      isFetching = false;
      return;
    }

    logger.info(
      `Fetching release dates for ${missingSteamGames.length} missing games...`
    );

    (async () => {
      try {
        let updatedCount = 0;
        const chunkSize = 50;

        const chunks = chunk(Array.from(missingSteamGames), chunkSize);

        for (const currentChunk of chunks) {
          try {
            for (const gamesBatch of chunk(
              currentChunk,
              STEAM_APP_DETAILS_CONCURRENCY
            )) {
              const details = await Promise.all(
                gamesBatch.map((game) =>
                  getSteamAppDetailsWithStatus(game.objectId, "en")
                )
              );

              for (const [index, game] of gamesBatch.entries()) {
                const result = details[index];
                const checkedAt = Date.now();

                if (result.type !== "success") {
                  await gamesSublevel.put(
                    levelKeys.game(game.shop, game.objectId),
                    {
                      ...game,
                      releaseDateLastCheckedAt: checkedAt,
                      releaseDateNextCheckAt: getReleaseDateNextCheckAt({
                        now: checkedAt,
                        result: result.type,
                        retryAfterMs:
                          result.type === "rate_limited"
                            ? result.retryAfterMs
                            : undefined,
                      }),
                    }
                  );
                  continue;
                }

                const detailsForGame = result.details;

                const releaseDateTimestamp = parseSortableDate(
                  detailsForGame.release_date?.date
                );

                await gamesSublevel.put(
                  levelKeys.game(game.shop, game.objectId),
                  {
                    ...game,
                    releaseDateTimestamp: releaseDateTimestamp || null,
                    releaseDateLastCheckedAt: checkedAt,
                    releaseDateNextCheckAt: releaseDateTimestamp
                      ? undefined
                      : getReleaseDateNextCheckAt({
                          now: checkedAt,
                          result: detailsForGame.release_date?.coming_soon
                            ? "coming_soon"
                            : "not_found",
                        }),
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

              const rateLimitDelay = Math.max(
                0,
                ...details.map((result) =>
                  result.type === "rate_limited"
                    ? (result.retryAfterMs ?? RATE_LIMIT_FALLBACK_DELAY_MS)
                    : 0
                )
              );

              if (rateLimitDelay > 0) {
                nextSteamRequestAt = Date.now() + rateLimitDelay;
                logger.warn(
                  `Steam rate limit reached; retrying release dates after ${rateLimitDelay}ms`
                );
                return;
              }

              await delay(SUB_BATCH_DELAY_MS);
            }

            WindowManager.sendToAppWindows("on-library-batch-complete");
          } catch (err) {
            logger.error("Failed to fetch release dates chunk", err);
          }
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
