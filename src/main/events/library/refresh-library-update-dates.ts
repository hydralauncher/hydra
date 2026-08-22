import { registerEvent } from "../register-event";
import {
  gamesSublevel,
  downloadSourcesSublevel,
  db,
  levelKeys,
} from "@main/level";
import { HydraApi } from "@main/services/hydra-api";
import { logger, WindowManager } from "@main/services";
import {
  getDownloadSourcesSignature,
  shouldRefreshDownloadSources,
} from "@main/services/download-sources-refresh-policy";
import type { GameRepack } from "@types";

import { chunk } from "lodash-es";

let isFetching = false;

interface LibraryUpdateDatesState {
  lastCheckedAt: number | null;
  lastSourceSignature: string | null;
}

const refreshLibraryUpdateDates = async () => {
  if (isFetching) return;
  isFetching = true;

  try {
    const state = await db
      .get<
        string,
        LibraryUpdateDatesState | null
      >(levelKeys.libraryUpdateDatesState, { valueEncoding: "json" })
      .catch(() => null);

    const lastCheckedAt = state?.lastCheckedAt ?? null;
    const lastSourceSignature = state?.lastSourceSignature ?? null;

    const updateState = async (checkedAt: number, signature: string) => {
      await db.put(
        levelKeys.libraryUpdateDatesState,
        { lastCheckedAt: checkedAt, lastSourceSignature: signature },
        { valueEncoding: "json" }
      );
    };

    const installedGames = await gamesSublevel.values().all();
    const nonCustomGames = installedGames.filter(
      (game) => !game.isDeleted && game.shop !== "custom"
    );

    if (nonCustomGames.length === 0) {
      isFetching = false;
      return;
    }

    const downloadSources = await downloadSourcesSublevel.values().all();
    const downloadSourceIds = downloadSources.map((source) => source.id);
    const sourceSignature = getDownloadSourcesSignature(downloadSourceIds);
    if (
      !shouldRefreshDownloadSources({
        lastCheckedAt,
        lastSourceSignature,
        sourceSignature,
        now: Date.now(),
      })
    ) {
      isFetching = false;
      return;
    }

    if (downloadSourceIds.length === 0) {
      const gamesWithStaleDates = nonCustomGames.filter(
        (game) => game.latestUpdateDate != null
      );

      for (const game of gamesWithStaleDates) {
        await gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
          ...game,
          latestUpdateDate: null,
        });
      }

      await updateState(Date.now(), sourceSignature);
      isFetching = false;
      if (gamesWithStaleDates.length > 0) {
        WindowManager.sendToAppWindows("on-library-batch-complete");
      }
      return;
    }

    logger.info("Starting refreshLibraryUpdateDates...");

    (async () => {
      try {
        const BATCH_SIZE = 5;
        const MAX_DOWNLOADS_PER_GAME = 100;
        const DOWNLOADS_SKIP_OFFSET = 0;
        let updatedCount = 0;

        const chunks = chunk(nonCustomGames, BATCH_SIZE);

        for (const currentChunk of chunks) {
          const promises = currentChunk.map(async (game) => {
            try {
              const downloads = await HydraApi.get<GameRepack[]>(
                `/games/${game.shop}/${game.objectId}/download-sources`,
                {
                  take: MAX_DOWNLOADS_PER_GAME,
                  skip: DOWNLOADS_SKIP_OFFSET,
                  downloadSourceIds,
                },
                {
                  needsAuth: false,
                }
              );

              const validDates = (downloads ?? [])
                .map((d) =>
                  d.uploadDate ? new Date(d.uploadDate).getTime() : 0
                )
                .filter((time) => time > 0);
              const latestDateIso =
                validDates.length > 0
                  ? new Date(Math.max(...validDates)).toISOString()
                  : null;

              if ((game.latestUpdateDate ?? null) !== latestDateIso) {
                await gamesSublevel.put(
                  levelKeys.game(game.shop, game.objectId),
                  {
                    ...game,
                    latestUpdateDate: latestDateIso,
                  }
                );
                return true;
              }
            } catch (err) {
              logger.error(`Failed to fetch updates for ${game.title}`, err);
            }
            return false;
          });

          const results = await Promise.all(promises);
          updatedCount += results.filter(Boolean).length;
        }

        logger.info(
          `Finished refreshLibraryUpdateDates. Updated ${updatedCount} games.`
        );

        if (updatedCount > 0) {
          WindowManager.sendToAppWindows("on-library-batch-complete");
        }
      } finally {
        await updateState(Date.now(), sourceSignature);
        isFetching = false;
      }
    })();
  } catch (error) {
    isFetching = false;
    logger.error("Error in refreshLibraryUpdateDates", error);
  }
};

registerEvent("refreshLibraryUpdateDates", refreshLibraryUpdateDates);
