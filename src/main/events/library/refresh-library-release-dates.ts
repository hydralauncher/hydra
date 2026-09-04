import { registerEvent } from "../register-event";
import {
  gamesSublevel,
  gamesShopCacheSublevel,
  levelKeys,
  db,
} from "@main/level";
import { getSteamAppDetailsWithStatus, logger } from "@main/services";
import { WindowManager } from "@main/services/window-manager";
import { parseSortableDate } from "@shared";
import type { Game } from "@types";
import { chunk } from "lodash-es";
import type { SteamAppDetailsRequestResult } from "@main/services/steam";
import { getRateLimitDelay } from "./release-date-rate-limit";
import {
  getReleaseDateNextCheckAt,
  needsReleaseDateRefresh,
} from "./release-date-refresh-policy";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let isFetching = false;
const SUB_BATCH_DELAY_MS = 1500;
const STEAM_APP_DETAILS_CONCURRENCY = 5;

interface SteamRateLimitState {
  nextSteamRequestAt: number;
}

const persistReleaseDateResult = async (
  game: Game,
  result: SteamAppDetailsRequestResult,
  checkedAt: number
) => {
  if (result.type !== "success") {
    await gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
      ...game,
      releaseDateNextCheckAt: getReleaseDateNextCheckAt({
        now: checkedAt,
        result: result.type,
        retryAfterMs:
          result.type === "rate_limited" ? result.retryAfterMs : undefined,
      }),
    });
    return false;
  }

  const detailsForGame = result.details;
  const releaseDateTimestamp = parseSortableDate(
    detailsForGame.release_date?.date
  );

  await gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
    ...game,
    releaseDateTimestamp: releaseDateTimestamp || null,
    releaseDateNextCheckAt: releaseDateTimestamp
      ? undefined
      : getReleaseDateNextCheckAt({
          now: checkedAt,
          result: detailsForGame.release_date?.coming_soon
            ? "coming_soon"
            : "not_found",
        }),
  });

  await gamesShopCacheSublevel.put(
    levelKeys.gameShopCacheItem("steam", game.objectId, "english"),
    { ...detailsForGame, name: game.title }
  );
  return true;
};

const processGamesBatch = async (gamesBatch: Game[]) => {
  const results = await Promise.all(
    gamesBatch.map((game) => getSteamAppDetailsWithStatus(game.objectId, "en"))
  );

  let updatedCount = 0;
  for (const [index, game] of gamesBatch.entries()) {
    const wasUpdated = await persistReleaseDateResult(
      game,
      results[index],
      Date.now()
    );
    updatedCount += Number(wasUpdated);
  }

  return { updatedCount, rateLimitDelay: getRateLimitDelay(results) };
};

const refreshMissingSteamGames = async (missingSteamGames: Game[]) => {
  let updatedCount = 0;
  const chunks = chunk(missingSteamGames, 50);

  for (const currentChunk of chunks) {
    try {
      for (const gamesBatch of chunk(
        currentChunk,
        STEAM_APP_DETAILS_CONCURRENCY
      )) {
        const batchResult = await processGamesBatch(gamesBatch);
        updatedCount += batchResult.updatedCount;

        if (batchResult.rateLimitDelay > 0) {
          const nextRequestAt = Date.now() + batchResult.rateLimitDelay;
          await db.put(
            levelKeys.steamRateLimitState,
            { nextSteamRequestAt: nextRequestAt },
            { valueEncoding: "json" }
          );
          logger.warn(
            `Steam rate limit reached; retrying release dates after ${batchResult.rateLimitDelay}ms`
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
};

const refreshLibraryReleaseDates = async () => {
  if (isFetching) return;

  const state = await db
    .get<
      string,
      SteamRateLimitState | null
    >(levelKeys.steamRateLimitState, { valueEncoding: "json" })
    .catch(() => null);

  if (state && Date.now() < state.nextSteamRequestAt) return;

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

    void (async () => {
      try {
        await refreshMissingSteamGames(missingSteamGames);
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
